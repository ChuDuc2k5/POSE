# Lịch sử đánh giá AI (M06)

Hai bộ đánh giá, chạy lại được bằng lệnh ở cuối trang.

## 1. Bộ kiểm thử đầu cuối (`backend/scripts/ai-eval.mjs`)

36 ca gọi API chat thật (`POST /api/ai/chat`, 2 ca qua `/chat/stream`) và chấm **chỉ trên phản hồi**
(`reply`, `sources`, `scope`, mã HTTP) cùng các dòng `ai_request_log` của lượt đó (tool đã gọi):
12 thường, 10 biên (gồm chào hỏi, cảm ơn, câu hỏi tiếp nối không có từ khoá), 6 phải từ chối,
4 prompt injection, 4 lỗi nhà cung cấp (timeout, JSON sai, nội dung rỗng, 503).

- `--fake`: stack thật + nhà cung cấp/Supabase giả (CI). Lỗi nhà cung cấp chỉ tạo được ở chế độ này.
- live: backend thật + Supabase thật + LM Studio `qwen3-4b-instruct-2507`; ca lỗi nhà cung cấp được bỏ qua
  (không thể ép mô hình thật lỗi), các ca dùng mã căn thật trong `ai-eval.live.json`.

| Ngày | Commit | Chế độ / mô hình | Prompt | Kết quả |
|---|---|---|---|---|
| 2026-10-24 | `bdf4161` | live · Qwen3-4B | assistant@4, query@3, rerank.user@2 | **28/32 (87,5%)** — thường 9/12, biên 9/10, từ chối 6/6, injection 4/4 |
| 2026-10-24 | `5975ea1` | live · Qwen3-4B | **assistant@5**, query@3, rerank.user@2 | **31/32 (96,9%)** — thường 11/12, biên 10/10, từ chối 6/6, injection 4/4 |
| 2026-10-25 | `df662bb` | `--fake` | assistant@5, rerank.user@3 | 36/36 (100%) |

Cải tiến giữa hai lần chạy live: prompt `assistant@5` yêu cầu gọi đúng công cụ ghi (lưu yêu thích,
đề nghị lịch xem, gặp chuyên viên) khi khách yêu cầu; tên thành phố (TP.HCM…) không còn là bộ lọc khu vực;
giá "khoảng X" (min = max) được nới ±20%. Ca còn trượt (n02, thuê căn hộ Phú Mỹ Hưng): mô hình 4B
chấm `has_answer=false` cho cả 6 ứng viên đúng — giới hạn của mô hình nhỏ.

## 2. Bộ đánh giá truy hồi trên dữ liệu thật (`backend/scripts/rag-eval-real.mjs`)

40 câu hỏi tiếng Việt viết theo 297 tin đăng thật (≥ 8 câu không có đáp án, ≥ 8 câu thuê, ≥ 6 câu hỏi tiếp nối).

| Ngày | Thay đổi | recall@5 | MRR | Nhận ra "không có dữ liệu" (F1) |
|---|---|---|---|---|
| 2026-10-24 | bge-m3, ngưỡng mặc định ban đầu | 0,500 | 0,376 | 0,00 |
| 2026-10-24 | ngữ cảnh phiên chỉ cộng điểm, khớp quận trong header, 40 ứng viên, hiệu chỉnh ngưỡng | **0,567** | **0,443** | **0,30** |
| 2026-10-24 | + rerank bằng Qwen3-4B (20 ứng viên, lô 10) | 0,533 | 0,465 | 0,30 |
| 2026-10-25 | + `AI_RAG_RERANK_KEEP_SIM=0.65` (giữ truy hồi khi rerank loại hết) | 0,533 | 0,465 | 0,30 — không câu nào kích hoạt; để tắt mặc định |

Rerank tăng MRR (căn đúng lên cao hơn) nhưng mô hình 4B đôi khi loại cả ứng viên đúng; mục tiêu
recall@5 ≥ 0,75 sẽ đo lại khi có `gpt-4.1-mini` (chỉ đổi biến môi trường).

## 60 câu hỏi thật của khách (Qwen3-4B, `--set real-questions`)

| Lần | Thay đổi | Tìm theo nhu cầu | Giá | Pháp lý | Vị trí | Thuê | Dự án | Mẫu mua | Mẫu thuê | Mẫu bán | Tổng |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | trước khi sửa | 1/5 | 0/5 | 0/5 | 0/5 | 1/5 | 0/5 | 3/10 | 2/10 | 6/10 | 13/60 |
| 2 | hiểu "căn này" theo mã ở lượt trước, suy ra mua/thuê, chặn công cụ ghi khi khách không yêu cầu | 1/5 | 3/5 | 3/5 | 3/5 | 1/5 | 2/5 | 5/10 | 6/10 | 7/10 | 31/60 |
| 3 | câu hỏi ngay sau khi xem một căn là hỏi về căn đó | 0/5 | 4/5 | 5/5 | 5/5 | 4/5 | 3/5 | 5/10 | 5/10 | 8/10 | 39/60 |
| 4 | guard đọc giá ghép ("4 tỷ 100 triệu"), số phòng trong tên ("2PN"); sửa 2 đáp án sai trong bộ đề; gửi yêu cầu chuyên viên khi khách nói rõ | 2/5 | 4/5 | 5/5 | 5/5 | 5/5 | 4/5 | 5/10 | 7/10 | 8/10 | 45/60 |
| 5 | đưa giá đã viết sẵn ("4,1 tỷ đồng") vào ngữ cảnh | 2/5 | 4/5 | 5/5 | 5/5 | 4/5 | 4/5 | 5/10 | 7/10 | 7/10 | 43/60 |
| 6 | guard cho phép nhắc lại mức giá khách nêu ("dưới 15 triệu/tháng") | 4/5 | 3/5 | 5/5 | 5/5 | 4/5 | 4/5 | 5/10 | 7/10 | 8/10 | **45/60** |

Còn lại: tiêu chí dữ liệu không có (diện tích, khoảng cách km, thuê ngắn hạn), và vài câu trả lời đúng ý nhưng
không dùng cụm "chưa có thông tin" hoặc không đề nghị chuyên viên.

## Chạy lại

```bash
node backend/scripts/ai-eval.mjs --fake
AI_EVAL_BASE_URL=http://localhost:3011 node --env-file=backend/.env --env-file=frontend/.env.local backend/scripts/ai-eval.mjs
cd backend && node scripts/rag-eval-real.mjs [--rerank]
AI_EVAL_BASE_URL=http://localhost:3012 node --env-file=backend/.env --env-file=frontend/.env.local backend/scripts/ai-eval.mjs --set real-questions
```
