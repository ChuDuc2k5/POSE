# Báo cáo kiểm thử TERAVA/POSE

Tài liệu này tổng hợp **mọi bộ test và kết quả** từ đầu dự án tới nay, trọng tâm là trợ lý AI (M06).

- Người tổng hợp: Chu Ngọc Việt Đức (`ChuDuc2k5`).
- Cập nhật lần cuối: 27/10/2026, bản `79e5b5a` (main, đang chạy demo).
- Quy ước: mỗi hotfix AI chat sau khi qua cổng kiểm tra sẽ thêm một dòng ở mục 5 và cập nhật mục 1.

## 1. Bản đang chạy (`79e5b5a`): kết quả mới nhất

| Hạng mục | Kết quả | Mục tiêu |
|---|---|---|
| Backend `vitest` | 628 test đạt, 4 bỏ qua (64 file) | Đạt toàn bộ |
| `test-ai-agent` (M06, provider giả) | 1488 kiểm tra đạt | Đạt toàn bộ |
| `test-ai-chat-ui` (1280px và 380px) | 94 kiểm tra đạt | Đạt toàn bộ |
| `test-discovery` (M03) | 101 kiểm tra đạt | Đạt toàn bộ |
| **FLOW**, hội thoại nhiều lượt chạy thật | **85/87 lượt (97,7%)** | ≥ 85% |
| **HARD30**, 30 câu khó (101–130) chấm tay | **8,77/10**, không câu nào dưới 8,5 | 8,9–9 |
| **190 câu** chạy thật, kiểm tra tự động | **190/190 đạt** | Không lỗi cứng |
| REAL60: thẻ căn khớp tiêu chí đề | 28/32 câu có thẻ khớp hoàn toàn (xem 3.1) | |

## 2. Bộ test tự động trong repo

Các bộ này chạy **trước mỗi lần merge vào `main`**. Script frontend dùng provider AI giả (biến môi trường AI bị xoá), không gọi mô hình thật và không tạo tài khoản, email hay SMS thật.

| Bộ test | Vị trí | Phạm vi | Kết quả gần nhất |
|---|---|---|---|
| Backend | `backend/test/*.spec.ts` (65 file) | Validation, SQL chạy trên PGlite, guard AI, tìm kiếm, khu vực, định dạng giá… | 628 đạt (`79e5b5a`) |
| `test-ai-agent.mjs` | `frontend/scripts/` | Agent M06: công cụ, trích dẫn, guard, tìm kiếm có cấu trúc, các hotfix 10–31 | 1488 đạt |
| `test-ai-chat-ui.mjs` | `frontend/scripts/` | Giao diện chat, đọc chính tả, giọng nói, bàn phím, đồng ý ghi âm | 94 đạt |
| `test-discovery.mjs` | `frontend/scripts/` | Tìm kiếm, chi tiết, yêu thích, yêu cầu tư vấn (M03) | 101 đạt |
| `test-auth.mjs` | `frontend/scripts/` | Đăng nhập, Google OAuth, hồ sơ (M01) | 122 đạt (lần merge gần nhất) |
| `test-catalog.mjs` | `frontend/scripts/` | Danh mục BĐS, thùng rác (M02) | 78 đạt (mốc M02) |
| `test-sales.mjs` | `frontend/scripts/` | Quản lý Sales (M11) | 57 đạt |
| `test-campaign-*.mjs`, `test-calling-ui.mjs`, `test-automated-calling*.mjs`, `test-browser-voice*.mjs` | `frontend/scripts/` | Chiến dịch gọi (M07), cuộc gọi (M08) | Đạt ở lần merge M07–M08 |
| `test-admin-shell.mjs` | `frontend/scripts/` | Sidebar quản trị: đúng 1 sidebar, đúng thứ tự, không lỗi console | Đạt |
| `test-search-filters-*.mjs`, `test-ai-agent-sql.mjs`, `test-proxy-runtime.mjs`, `test-stack.mjs` | `frontend/scripts/` | Bộ lọc tìm kiếm, SQL của agent, proxy | Đạt |

Lệnh chạy, với AI env bị xoá:

```bash
cd backend && npx vitest run --no-file-parallelism
cd frontend && npm run build && node scripts/test-ai-agent.mjs && node scripts/test-ai-chat-ui.mjs && node scripts/test-discovery.mjs
```

## 3. Bộ câu hỏi chạy thật (AI thật, dữ liệu thật)

Tổng cộng **190 câu** do sinh viên soạn, cộng thêm kịch bản hội thoại FLOW.

| Bộ | Số câu | Nội dung |
|---|---|---|
| REAL60 | 60 | Câu hỏi thực tế của khách: tìm theo nhu cầu, chi tiết, giá, pháp lý, khu vực, khoảng cách |
| FAQ 1–50 | 50 | Câu hỏi thường gặp, 36 câu đặt trên trang chi tiết căn |
| FAQ 51–100 | 50 | Tìm mua, tìm thuê, tiện ích, tài chính, tư vấn; 21 câu trên trang chi tiết |
| HARD30 (101–130) | 30 | Câu hóc búa: giá mâu thuẫn, pháp lý, cam kết, tài chính, nhiều điều kiện |
| FLOW | 87 lượt / 31+ kịch bản | Hội thoại nhiều lượt: đổi khu vực, đổi ngân sách, đổi mua/thuê, xem thêm, so sánh, chi tiết căn, không dấu, tiếng Anh, chèn lệnh |

### 3.1 REAL60: lịch sử

| Vòng | Mô hình | Kết quả |
|---|---|---|
| 1 (trước khi sửa) | Qwen3-4B cục bộ | 13/60 |
| 3 | Qwen3-4B | 39/60 |
| cuối giai đoạn Qwen | Qwen3-4B | 51/60 (khoảng 142 giây mỗi câu) |
| chuyển mô hình | gpt-4.1-mini | 50/60 (khoảng 7 giây, 0,003 USD mỗi câu) |
| sau hotfix 5 | gpt-4.1-mini | 52/60 |
| `79e5b5a` (27/10) | gpt-4.1-mini | 60/60 qua kiểm tra tự động; 28/32 câu có thẻ khớp hoàn toàn tiêu chí đề |

Bốn câu lệch tiêu chí ở lần chạy cuối:
- **real-38, real-43, real-47** ("mua/thuê nhà" chung chung): trả cả căn hộ. Đây là chủ ý theo quy tắc hiện tại, "nhà" chung chung = nhà phố hoặc căn hộ, không bao giờ là đất. Đề cũ coi "nhà" là nhà phố.
- **real-04** ("căn chung cư gần trung tâm") có một thẻ nhà phố. Đây là lỗi thật, ghi lại để sửa.

Giá của mọi thẻ đều nằm trong ngân sách: không thẻ nào vượt quá 110% mức trần của đề.

Chi tiết từng vòng: `docs/ai-eval-history.md`.

### 3.2 FAQ 1–50 và 51–100 (chấm tay, thang 10)

| Bộ | Trước | Sau | Ghi chú |
|---|---|---|---|
| FAQ 1–50 | 5,35 | **8,90** (26/10) | Nhóm tốt nhất: pháp lý 9,13; xem nhà, liên hệ 9,10 |
| FAQ 51–100 | 5,71 | **9,40** (26/10) | 40/50 câu đạt từ 9,5 |
| Cả 100 câu trên `79e5b5a` | | 100/100 qua kiểm tra tự động | Thời gian trung bình 4,3 giây (1–50) và 5,0 giây (51–100) |

### 3.3 HARD30 (chấm tay, thang 10)

| Lần | Bản | Điểm TB | Thay đổi chính |
|---|---|---|---|
| 2 | `dd89a9e` | 6,33 | Lần chấm đầu |
| 3 | `e71e84f` | 7,05 | Guard bớt chặn nhầm |
| 4 | `3e0d890` | 8,33 | |
| 5 | `d5a1b5d` (hotfix 14) | 8,25 | |
| 6 | `fc78ddf` (hotfix 16) | 8,57 | |
| 7 | `a10015f` (hotfix 18) | 8,33 | |
| 8 | `a2d6717` (hotfix 20) | 8,13 | |
| 9 | hotfix 22 | 8,02 | |
| 10 | `52ce57c` (hotfix 24) | 8,65 | |
| 12–14 | hotfix 26–30 (chưa push) | 8,5–8,6 | Lắp câu trả lời theo thứ tự cố định, dữ liệu 168 phường |
| **15** | **`79e5b5a` (hotfix 31)** | **8,77** | Sửa 104, 120, 125, 126, 128; không câu nào dưới 8,5 |

### 3.4 FLOW (hội thoại nhiều lượt, chạy thật)

Mỗi lượt được kiểm tự động: giá trong ngân sách, mua/thuê, loại nhà, số phòng, diện tích, khu vực (theo bảng 168 phường), số thẻ, câu cấm, lỗi font.

| Lần | Bản | Kết quả | Ghi chú |
|---|---|---|---|
| run 1 | | 52/70 | Bản đầu của kịch bản |
| run 4 | | 69/70 | |
| run 6 | | 67/87 | Thêm 17 lượt nhiều khu vực (g-*) |
| run 7 | `474c2d4` (hotfix 25) | 77/87 | Lộ lỗi "quận 9" ra Phường Thủ Đức |
| gate 27 | hotfix 26–27 | 83/87 | Bảng phường từ Nghị quyết 1685 |
| gate 30 | hotfix 26–30 | 54/87 | Môi trường hỏng giữa chừng (build lúc server đang chạy), sau đó lộ lỗi tên khu vực có dấu ngoặc |
| **gate 31** | **`79e5b5a`** | **85/87 (97,7%)** | Còn trượt: "so sánh căn 1 và căn 2" (thiếu [2]) và "thế ở quận 9 đi" |
| demo 27/10 | `79e5b5a` (cổng 3000) | **85/87 (97,7%)** | Trượt: "thế ở quận 9 đi" và "ở thủ đức" trong kịch bản đổi khu vực giữa hội thoại. "So sánh căn 1 và căn 2" đạt ở lần này, nên kết quả AI có dao động giữa các lần chạy |

## 4. Quy trình kiểm tra một hotfix AI chat

1. **Codex** sửa theo brief, kèm test thất bại trước khi sửa. Codex không được sửa migration đã áp dụng và không được nới lỏng test.
2. **Review**:
   - tìm lỗi font;
   - kiểm tra `\b` cạnh chữ tiếng Việt;
   - đọc các dòng test bị xoá;
   - so số `check(` trước và sau.
3. **Chạy đủ 5 suite**: backend, build frontend, agent, chat UI, discovery. Mỗi lần chỉ một worktree, vì bộ test dùng cố định cổng 3300/3301.
4. **Cổng kiểm tra thật** trên worktree (cổng 3400/3401):
   - FLOW so với lần trước để tìm lỗi hồi quy;
   - HARD30 chấm tay;
   - khi cần, chạy lại 190 câu.
5. **Push** khi FLOW ≥ 85%, không có lỗi hồi quy nghiêm trọng và tốt hơn bản đang chạy. Sau đó cập nhật file này.

## 5. Lịch sử theo hotfix AI chat (từ hotfix 25)

| Hotfix | Commit | Nội dung | Suite | FLOW | HARD30 |
|---|---|---|---|---|---|
| 25 | `474c2d4` | Một quy tắc tìm kiếm có cấu trúc cho mọi khu vực, ngữ nghĩa ngân sách dùng chung | 550 / 1592 / 94 / 101 | 77/87 | ~8,65 |
| 26 (+b,c,d) | `ef2b139` | Câu trả lời theo thứ tự cố định; câu "còn bán" và pháp lý gọn; khôi phục 5 kiểm tra bị nới | 564 / 1592 / 94 / 101 | không hồi quy | 8,5 |
| 27 (+b) | `5b561a5`, `fc1ec56` | Bảng 168 phường từ Nghị quyết 1685; một hàm so khớp khu vực; "nhà" = nhà phố + căn hộ (migration `20261027270000`) | 568 / 1654 / 94 / 101 | 83/87 | 8,6 |
| 28 | `cc5c52e` | Đếm đúng căn tương tự; trang chi tiết không tìm mới; số phòng, ngày tháng đúng | 574 / 1358 / 94 / 101 | — | 8,5 |
| 29 (+b) | `3d5fa06` | Tên phường trùng phải ghi kèm quận; tên quận thắng tên phường; gắn tên khu vực mọi đường tìm | 615 / 1795 / 94 / 101 | (lỗi ngoặc, sửa ở 31) | — |
| 30 | `9615282` | Loại studio khỏi tìm nhiều phòng ngủ (migration `20261027280000`); lọc lại danh sách không hỏi khu vực; trả lời khi không có căn khớp | 578 / 1358 / 94 / 101 | — | 8,6 |
| **31** | **`284b5ee`** | Đưa giá trị vào truy vấn PostgREST trong ngoặc kép; trang chi tiết không tìm mới; định dạng số tiền | 628 / 1488 / 94 / 101 | **85/87** | **8,77** |

Cột "Suite" ghi theo thứ tự backend / `test-ai-agent` / chat UI / discovery. Số kiểm tra của `test-ai-agent` thay đổi theo số lần gọi mô hình trong fixture; số lệnh `check(` trong mã nguồn không giảm qua các hotfix.

## 6. Vị trí file kết quả

Kết quả thô nằm **ngoài repo**, trong thư mục làm việc `C:\Users\Admin\POSE-tasks\`:

| File | Nội dung |
|---|---|
| `RUN190/questions-190.json` | Bộ 190 câu gộp (REAL60, FAQ1-50, FAQ51-100, HARD30) |
| `RUN190/run190.mjs` | Script chạy 190 câu và kiểm tra tự động |
| `RUN190/run-79e5b5a.json`, `-summary.md` | Câu trả lời và tổng hợp lần chạy trên `79e5b5a` |
| `RUN190/flow-79e5b5a.json`, `.log` | FLOW trên `79e5b5a` |
| `HARD30-cases.json`, `HARD30-run-*.json`, `HARD30-scores-run*.md` | Đề, câu trả lời và bảng chấm HARD30 qua 16 lần chạy |
| `FAQ50-scores.md`, `FAQ100-scores.md` | Bảng chấm FAQ 1–50 và 51–100 |
| `FLOW-run-*.json`, `FLOW-gate*.json` / `.log` | Kết quả FLOW từng lần |
| `flow-run.mjs`, `hard30-run.mjs`, `gate.sh` | Script chạy FLOW, HARD30 và cổng kiểm tra |
| `HOTFIX-*-task.md`, `HOTFIX-*-report.md` | Brief và báo cáo của từng hotfix (43 brief, 41 báo cáo) |
| `NQ1685-dieu1.txt` | Toàn văn Điều 1 Nghị quyết 1685/NQ-UBTVQH15, nguồn của bảng 168 phường |

Trong repo:
- bộ test tự động: `backend/test/`, `frontend/scripts/`;
- lịch sử REAL60: `docs/ai-eval-history.md`;
- nhật ký dùng AI: `AI_USAGE.md`.
