# M06 — Trợ lý AI TERAVA: thiết kế, kiểm soát và bằng chứng

Tài liệu đối chiếu từng yêu cầu của môn học với chỗ hiện thực trong mã nguồn và bằng chứng kiểm thử.
Mã: `backend/src/modules/ai/` (NestJS), `frontend/components/ai-*` (Next.js), SQL: `supabase/ai-*.sql`.

## Kiến trúc một lượt hỏi

```
Khách hỏi ──► Guard đầu vào (injection, PII, giới hạn độ dài)
          ──► Bước hiểu câu hỏi (LLM, JSON Zod: topic, câu hỏi độc lập, bộ lọc, từ khoá, tham chiếu)
               ├─ topic = out_of_scope ──► từ chối lịch sự, không tìm, không công cụ
               └─ real_estate ──► Truy hồi lai: vector bge-m3 + full-text (RRF) trên Supabase pgvector
                                 ──► Rerank (LLM, JSON Zod: has_answer + relevance 0–3)
          ──► Agent (≤ 4 bước, 6 công cụ) ──► công cụ ghi tạo "đề nghị" chờ khách xác nhận
          ──► Kiểm tra câu trả lời (LLM, JSON Zod AnswerMeta + guard xác định) ──► trích dẫn [n] + thẻ căn
          ──► Trích nhu cầu (LLM, JSON Zod) ──► chấm điểm lead (xác định, BR-04)
Mỗi lần gọi mô hình ──► ai_request_log (prompt version, công cụ, token, chi phí, độ trễ, trạng thái)
```

## A. RAG — truy hồi có trích dẫn

| Thành phần | Hiện thực |
|---|---|
| Chunking | `chunking.ts`: tin ≤ 1.200 ký tự giữ 1 chunk; dài hơn chia 800 ký tự, chồng lấp 150 theo câu. Mỗi chunk có header `Mã · Tên · khu vực · loại · Bán/Cho thuê` + bí danh quận. Loại bỏ SĐT/email/link, câu môi giới và mọi câu có giá (giá luôn lấy trực tiếp từ catalogue khi trả lời). |
| Embedding | bge-m3 (1024 chiều) qua LM Studio; `text-embedding-3-small` (`dimensions=1024`) khi dùng OpenAI. |
| Tìm kiếm | `pose_private.kb_search`: vector cosine (HNSW) + full-text không dấu, mỗi nhánh 60 ứng viên, gộp RRF; ngữ cảnh phiên chỉ **cộng điểm**, không lọc. |
| Rerank | `rerank.ts`: LLM chấm 20 ứng viên (lô 10), JSON `{has_answer, ranked[{n, relevance}]}`; lỗi/timeout → quay về ngưỡng. |
| "Không biết" | Không ứng viên đạt ngưỡng hoặc rerank `has_answer=false` → trả lời thật là chưa có dữ liệu, không thẻ căn. |
| Trích dẫn | Nguồn đánh số `[n]` theo căn; thẻ căn hiển thị đúng thứ tự xếp hạng. |
| Tri thức | 297 tin đăng + 25 FAQ đã duyệt = 322 chunk; kiểm toán: 0 chunk chứa giá. |

## B. Agent ≥ 3 công cụ, xác nhận trước khi ghi

| Công cụ | Loại | Ghi chú |
|---|---|---|
| `search_properties` | đọc | bộ lọc được Zod + guard kiểm tra |
| `get_property_detail` | đọc | chỉ tin đã công bố |
| `list_my_appointments` | đọc | chỉ của chính khách |
| `save_favorite` | ghi | tạo `ai_pending_actions`, khách bấm xác nhận |
| `propose_appointment` | ghi | như trên; chuyên viên xác nhận lịch |
| `request_handoff` | ghi | như trên; cần đồng ý liên hệ |

Mọi công cụ ghi đi qua `ai_pending_actions` → `POST /api/ai/actions/:id/confirm` (idempotent, hết hạn 10 phút).
Khách vãng lai bị yêu cầu đăng nhập; công cụ lạ hoặc tham số lạ bị chặn và ghi `ai_action_log`.

## C. JSON có schema (Zod) dùng trong logic

| Schema | Dùng để |
|---|---|
| `SearchQuerySchema` (topic, standalone_question, filters, keywords, refers_to_previous) | quyết định từ chối/tìm kiếm, bộ lọc SQL, xác định "căn thứ hai" |
| `RerankEnvelope` | xếp hạng lại và phân loại có/không có dữ liệu |
| `AnswerMetaSchema` (grounding, cited, claims) | chặn câu trả lời không có căn cứ hoặc trích dẫn sai |
| `NeedsV1` (ngân sách, khu vực, loại hình, thời gian, ý định…) | điền nhu cầu lead và chấm điểm Hot/Warm/Cold |

Đầu ra sai schema bị loại (ví dụ Qwen sinh giá 10¹⁸ cho "dưới 5 tỷ" → Zod chặn → dùng suy luận dự phòng).

## 2. Quản lý prompt

Toàn bộ prompt nằm trong `backend/src/modules/ai/prompts/*.md`, phiên bản ở `prompts/index.json`
(`assistant@5`, `query@3`, `rerank.user@3`…); không còn chuỗi prompt trong mã `.ts`. Lịch sử Git là lịch sử
phiên bản; mỗi dòng `ai_request_log` ghi phiên bản prompt đã dùng.

## 3. Guardrails

| Rủi ro | Xử lý | Bằng chứng |
|---|---|---|
| Prompt injection | Regex nhận diện + đánh dấu `injection_suspected`; dữ liệu truy hồi bọc `BEGIN/END_UNTRUSTED_DATA`; dữ liệu chứa bí mật bị lọc (`UNSAFE_RETRIEVED_DATA`); công cụ/tham số ngoài danh sách bị chặn | 4/4 ca injection live; check HTTP "Injection flagged as DATA…" |
| Ngoài phạm vi | `topic=out_of_scope` từ bước hiểu câu hỏi (Zod) → `scope:'out_of_scope'`, không tìm, không công cụ; danh sách từ khoá chỉ là dự phòng; chào hỏi/câu tiếp nối không bị từ chối | 6/6 ca từ chối, 4 ca chào hỏi/tiếp nối đều qua |
| AI lỗi | Timeout, JSON sai (thử lại 1 lần), nội dung rỗng (thử lại rồi báo lỗi), 5xx → HTTP 503 `AI_UNAVAILABLE` kèm link tìm căn và gửi yêu cầu; không ghi dữ liệu dở | 4 ca lỗi `--fake`; check "Unconfigured LLM no writes" |

## 4. Bộ kiểm thử

Xem `docs/ai-eval-history.md`: 36 ca đầu cuối (live Qwen **87,5% → 96,9%** sau cải tiến prompt) và 40 câu
truy hồi trên dữ liệu thật (recall@5 0,500 → 0,567). Kiểm thử tự động: 681 check HTTP chat, 47 check UI chat,
dashboard UI 1280/380, 6 nhóm SQL (PGlite), 178 unit test backend.

## 5. Ghi log và chi phí

`public.ai_request_log` (một dòng mỗi lần gọi mô hình): `kind`, `model`, `prompt_name`, `prompt_version`,
`tools_called`, token vào/ra, `estimated_cost_usd` (chốt tại thời điểm gọi theo bảng giá trong `request-log.ts`;
mô hình cục bộ = 0), `latency_ms`, `status`, `turn_id` + `question_preview` (đã xoá SĐT/email). Chỉ Admin đọc.

**AI Platform Dashboard** (`/admin/ai-dashboard`): token/chi phí/số câu hỏi/độ trễ hôm nay–tuần–tháng, biểu đồ
ngày/tuần/tháng, bảng theo loại gọi, bảng từng câu hỏi bấm xem từng lần gọi.

Số đo thực tế (Qwen3-4B, 56 phiên): trung bình **5.473 token/câu hỏi** (5.055 vào, 418 ra), 6 lần gọi mô hình.
Quy đổi giá gpt-4.1-mini (0,40/1,60 USD mỗi 1M token): ≈ **0,0027 USD ≈ 70 đ/câu hỏi**.

| Bước | Token vào / ra TB | Độ trễ TB (Qwen3-4B, RTX 3050 4 GB) |
|---|---|---|
| Hiểu câu hỏi | 262 / 117 | 9,7 s |
| Rerank (mỗi lô 10) | 1.344 / 92 | 12,2 s |
| Trả lời (agent) | 1.647 / 112 | 15,3 s |
| Kiểm tra trích dẫn | 536 / 43 | 6,4 s |
| Trích nhu cầu | 182 / 34 | 2,7 s |

## 6. Phương án dự phòng

AI không cấu hình/lỗi → 503 với thông báo rõ và liên kết `/properties`, `/customer/inquiries/new`; tìm kiếm,
xem chi tiết, yêu thích, gửi yêu cầu không phụ thuộc AI. Truy hồi lỗi → tìm theo catalogue (log `retrieval_fallback`);
rerank lỗi → ngưỡng (log `rerank_fallback`).

## Chuyển sang OpenAI

Chỉ đổi `backend/.env`: `AI_API_URL=https://api.openai.com/v1`, `AI_API_KEY`, `AI_MODEL=gpt-4.1-mini`,
`AI_EMBED_MODEL=text-embedding-3-small`, `AI_EMBED_DIMENSIONS=1024`, sau đó `node backend/scripts/kb-reindex.mjs`.

## Giới hạn hiện tại

- Qwen3-4B cục bộ chậm (≈ 40–100 s/câu trên GPU 4 GB) và rerank đôi khi loại ứng viên đúng; recall@5 mục tiêu 0,75
  chưa đạt — cần đo lại với gpt-4.1-mini.
- 5/40 câu truy hồi trượt vì căn đúng không nằm trong ứng viên của cả vector lẫn full-text.
