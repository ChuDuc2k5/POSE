# Nhật ký sử dụng AI (AI Usage Log)

Tài liệu này khai báo việc dùng công cụ AI khi xây dựng TERAVA/POSE: phần nào do AI tạo, công cụ nào, prompt quan trọng, sinh viên đã kiểm tra hoặc yêu cầu chỉnh sửa gì, và các trường hợp mã do AI tạo bị sai.

| Mục | Nội dung |
|---|---|
| Người khai | Chu Ngọc Việt Đức (GitHub `ChuDuc2k5`) |
| Phạm vi | M06 Trợ lý AI, M07 Chiến dịch gọi, M08 Cuộc gọi, giao diện chung (theme sáng, navbar, khung quản trị), tích hợp/merge các nhánh vào `main` |
| Thời gian | 09/2026 – 10/2026 |
| Thành viên khác | Phần của Lê Anh Đức (M01–M03, M11) và Nguyễn Đỗ Minh Quân (M04–M05) do từng thành viên tự khai ở mục 7 |

## 1. Công cụ AI đã dùng

### 1.1 Công cụ hỗ trợ lập trình

| Công cụ | Mô hình | Dùng để |
|---|---|---|
| Claude Code (Anthropic) | Claude Opus | Phân tích yêu cầu, viết đặc tả công việc, viết và sửa mã, review mã do Codex tạo, chạy test, gỡ lỗi, xử lý conflict khi merge, thao tác DB (Supabase) |
| Codex CLI (OpenAI) | gpt-5.6-luna | Hiện thực một số đặc tả công việc do Claude Code viết (giao diện, test, phần việc lặp lại); mọi kết quả đều được review lại trước khi commit |

### 1.2 AI chạy bên trong sản phẩm (không phải công cụ viết mã)

Module M06 là một trợ lý AI nên bản thân sản phẩm có gọi mô hình. Phần này không phải "mã do AI tạo", nhưng được ghi ra cho đầy đủ:

- **Hiện tại:** OpenAI `gpt-4.1-mini` (hiểu câu hỏi, rerank, trả lời, trích nhu cầu) và `text-embedding-3-small` (1024 chiều).
- **Giai đoạn đầu:** Qwen3-4B và bge-m3 chạy cục bộ qua LM Studio.

Mỗi lần gọi mô hình đều được ghi vào bảng `ai_request_log`, gồm token, chi phí, độ trễ và phiên bản prompt.

## 2. Quy trình làm việc với AI

1. **Sinh viên đặt yêu cầu** bằng tiếng Việt, kèm ảnh chụp màn hình hoặc phác thảo giao diện khi cần. Sinh viên cũng tự quyết các vấn đề nghiệp vụ, ví dụ:
   - nút trên thẻ căn hộ thao tác trực tiếp, không gửi lại cho AI;
   - bản demo NewTech dùng một Sales nhận hầu hết lead;
   - dùng theme sáng cho toàn dự án.
2. **Claude Code** đọc mã hiện có và SRS, viết đặc tả công việc (lưu ngoài repo), rồi tự viết mã hoặc giao cho **Codex**.
3. **Kết quả của Codex được Claude Code review** (đọc diff, chạy test). Lỗi phát hiện được thì sửa trực tiếp hoặc gửi yêu cầu sửa lại.
4. **Kiểm thử tự động** trước mỗi commit, cụ thể ở mục 5.
5. **Sinh viên kiểm tra thủ công trên trình duyệt** bằng tài khoản thật. Lỗi được báo lại bằng ảnh chụp màn hình. Sinh viên duyệt trước khi merge vào `main`.
6. **Thay đổi DB:** Claude Code áp dụng rồi báo cáo lại. Thao tác có tính phá huỷ phải hỏi trước. Mật khẩu tài khoản thật do sinh viên tự đặt, AI không đặt hộ.

## 3. Các phần chính do AI tạo và những gì sinh viên đã kiểm tra

| Phần | Vị trí trong mã | AI tạo | Sinh viên kiểm tra / yêu cầu chỉnh |
|---|---|---|---|
| RAG + agent trợ lý AI (M06) | `backend/src/modules/ai/`, `supabase/ai-*.sql` | Chunking, embedding, tìm kiếm lai (vector + full-text, RRF), rerank, agent 6 công cụ, guard đầu vào/đầu ra, trích dẫn `[n]` | Đặt bộ 60 câu hỏi thật để đánh giá qua nhiều vòng (`docs/ai-eval-history.md`). Phát hiện và yêu cầu sửa các lỗi: diện tích, khoảng cách, thuê ngắn hạn, câu chữ thiếu trung thực, "quan tâm căn này", câu tục tĩu vẫn ra thẻ căn |
| Giao diện chat AI | `frontend/components/ai-chat-*.tsx`, `booking-form.tsx`, `recommendation-card.tsx` | Widget chat, lịch sử hội thoại, ghim/xoá, form đặt lịch, thẻ căn | Yêu cầu: nút tim lưu trực tiếp, đặt lịch mở form chọn ngày và Sales, form hiển thị như một câu trả lời, chuyển hội thoại vẫn tiếp tục trả lời ở nền, box chat có trên mọi trang người dùng |
| Đặt lịch xem nhà qua AI | `supabase/ai-appointment-booking.sql` | Hàm gợi ý Sales, tạo lịch hẹn, tạo khách hàng/lead | Kiểm tra trên DB thật; yêu cầu bắt buộc số điện thoại đã xác minh |
| Import dữ liệu 250 tin QuinLand | `backend/scripts/import-*.mjs`, `listing-*.mjs` | Script khử trùng lặp, nhập ảnh, tạo chunk tri thức, xoá thông tin người đăng | Yêu cầu không thêm tin trùng và xoá thông tin Sales/người đăng; đối chiếu số tin trước và sau khi nhập (235 tin mới, 15 tin trùng) |
| Chiến dịch gọi (M07), cuộc gọi (M08) | `backend/src/modules/campaigns`, `calling`; `frontend/components/campaign-*`, `calls-*` | API, giao diện, bộ giả lập tổng đài, test | Duyệt luồng nghiệp vụ, đồng ý ghi âm/chép lời, che số điện thoại |
| Giao diện chung trên `main` | `site-header.tsx`, `account-dropdown.tsx`, `property-navigation.tsx`, `support-navigation.tsx`, `admin-shell.tsx`, `pose.css` | Navbar cố định, dropdown, theme sáng, sidebar quản trị dùng chung, skeleton tải trang | Góp ý từng vòng bằng ảnh: logo, màu nút tài khoản, dropdown khó chọn, sidebar phải giữ nguyên khi chuyển chức năng |
| Merge nhánh của thành viên | các commit merge `leduc`, `mquan` | Xử lý conflict theo hướng giữ cả hai bên | Sinh viên chọn hướng xử lý từng conflict, sau đó kiểm tra lại giao diện |
| Bộ test tự động | `frontend/scripts/test-*.mjs`, `backend/test/*.spec.ts` | Viết và cập nhật test | Yêu cầu chạy đủ bộ test trước mỗi lần merge |

## 4. Prompt quan trọng (trích yêu cầu gốc của sinh viên)

- "Làm thêm một vòng cho 15 câu còn lại: diện tích, khoảng cách, thuê ngắn hạn và câu chữ trung thực."
- "Box chat chỉ trả lời câu hỏi; thao tác trên card không hỏi lại chat; đặt lịch hiện form để chốt lịch với sales."
- "Ấn tim thì trái tim đỏ và tự thêm vào yêu thích, không nhờ chat."
- "Check trùng thì không thêm vào, tính cả kb_chunks… data thì bỏ thông tin sales với người đăng bđs."
- "Thống nhất admin dashboard: sidebar luôn như vậy, click function nào cũng giữ sidebar, đổi component bên phải."
- "Thử merge code từ branch leduc/mquan vào main, nếu bị dính conflict báo tôi… đừng để bị lỗi như lúc merge branch leduc."
- Prompt hệ thống của trợ lý (phiên bản `assistant@7`, trong mã nguồn M06): yêu cầu mọi căn hộ và mọi thông tin lấy từ nguồn phải kèm số nguồn `[1]`, `[2]`…

## 5. Kiểm chứng mã do AI tạo

- **Đánh giá trợ lý AI:** bộ 60 câu hỏi thực tế, chạy chia nhỏ song song qua nhiều vòng, ghi trong `docs/ai-eval-history.md`.

  | Mô hình | Kết quả | Thời gian |
  |---|---|---|
  | Qwen3-4B (cục bộ) | từ 13/60 lên 51/60 | khoảng 142 giây mỗi câu |
  | gpt-4.1-mini | 50/60 | khoảng 7 giây mỗi câu, khoảng 0,003 USD mỗi câu |

- **Test tự động, chạy trước mỗi lần merge vào `main`:**

  | Bộ test | Phạm vi |
  |---|---|
  | `test-auth` | 122 kiểm tra |
  | `test-discovery` | 101 kiểm tra |
  | `test-sales` | 57 kiểm tra |
  | `test-ai-chat-ui` | 88 kiểm tra |
  | `test-campaign-ui`, `test-calling-ui`, `test-ai-dashboard-ui` | giao diện M06–M08 |
  | `test-admin-shell` | sidebar quản trị, menu, không có lỗi console |
  | Backend (`vitest`) | 354 test |

- **Kiểm tra thủ công:** sinh viên đăng nhập bằng tài khoản thật để xem giao diện. Lỗi được báo bằng ảnh và được sửa ở vòng sau.

## 6. Các trường hợp mã do AI tạo bị sai hoặc chưa đạt yêu cầu

| # | Mã AI tạo sai | Cách phát hiện | Cách sửa |
|---|---|---|---|
| 1 | Codex ghi file nguồn sai bảng mã. Chuỗi tiếng Việt thành ký tự lỗi ("Quáº£n lÃ½…"), có chỗ mất hẳn ký tự, ở `admin-sales.tsx`, `admin-inquiries.tsx`, `catalog-workspace.tsx` | Lệnh `git grep` tìm mẫu ký tự lỗi trước khi commit, cùng việc đọc diff | Khôi phục 3 file từ bản gốc rồi làm lại thay đổi. Thêm bước kiểm tra lỗi mã hoá bắt buộc vào mọi lần review |
| 2 | Khi làm sidebar quản trị dùng chung, Codex chỉ **ẩn** sidebar cũ bằng CSS (`.legacy-catalog-frame`). Trang Quản lý Sales vẫn hiện **hai sidebar** | Review diff, sau đó viết test đếm số sidebar trên mọi trang quản trị | Bỏ hẳn phần khung trùng trong các trang. Thêm `test-admin-shell` để kiểm tra đúng 1 sidebar, đúng thứ tự mục, và sidebar không bị dựng lại khi chuyển trang |
| 3 | Hàm SQL đặt lịch xem nhà do AI tạo bị lỗi: biến trùng tên cột (ambiguous), thiếu quyền `grant` cho `authenticated`, không tạo khách hàng/lead khi thiếu | Khi review, gọi thử hàm trên Supabase thật thì nhận lỗi từ Postgres | Đổi tên biến (`v_customer`, `v_lead`, `v_sales`…), cấp quyền cho cả hàm private và public, bổ sung bước tạo khách hàng/lead khi số điện thoại đã xác minh |
| 4 | Trang chủ dùng `.catch(() => null)` khi đọc phiên đăng nhập. Cách này nuốt luôn lệnh redirect của Next.js, khiến người dùng có phiên hết hạn không được làm mới | `test-auth` fail | Dùng `unstable_rethrow` để vẫn chuyển tiếp lệnh redirect |
| 5 | AI thêm `loading.tsx` (skeleton) cho các trang cần đăng nhập. Trang chuyển sang stream nên redirect HTTP 307 thành 200, trang ẩn trả 200 thay vì 404 | `test-discovery` fail ở hai kiểm tra "Favorites page protected on server" và "Hidden direct page denied" | Chỉ giữ skeleton ở khu quản trị (đã có layout kiểm tra quyền phía trên) và trang tìm kiếm (tách bằng route group) |
| 6 | Endpoint ảnh do AI viết dùng client ẩn danh để tải file khi người xem là Admin. Admin chỉ thấy ảnh giữ chỗ trên trang chủ | Sinh viên chụp màn hình trang chủ không có ảnh. Thử trực tiếp trên storage: client ẩn danh nhận 404, client có secret tải được | Ảnh công khai luôn tải bằng secret phía server; thêm cache 10 phút |
| 7 | Bộ kiểm tra đầu ra của trợ lý AI chặn nhầm câu trả lời đúng: giá dạng "4 tỷ 125 triệu", số phòng có trong tên căn, hoặc khi trợ lý nhắc lại mức giá khách đưa ra | Chạy bộ đánh giá 60 câu, đọc từng câu bị chặn | Viết lại phần đọc số tiền (`money.ts`) và các luật so khớp; chuẩn hoá cách in giá (`priceLabel`) |
| 8 | Dropdown "Bất động sản"/"Hỗ trợ" đóng ngay khi chuột đi từ nút xuống menu | Sinh viên báo lỗi khi dùng thử | Thêm độ trễ đóng 250ms và vùng đệm nối khe giữa nút và menu; thêm test di chuột qua khe |
| 10 | Khi sửa luồng đặt lịch để tạo thêm yêu cầu tư vấn, Codex ghi `source='AIBooking'` vào `property_inquiries`, nhưng ràng buộc trên DB chỉ cho phép `CustomerWeb`/`GuestWeb`. Nếu áp dụng, **mọi lượt đặt lịch đều lỗi**. Codex còn sửa thẳng vào migration M03 đã chạy của thành viên khác | Review SQL và đối chiếu với ràng buộc thật trên DB (test fixture không chạy SQL thật nên không bắt được) | Thêm migration mới mở rộng ràng buộc; trả migration M03 về nguyên trạng; mọi lỗi khi ghi yêu cầu tư vấn không được làm hỏng lượt đặt lịch |
| 11 | Hàm SQL `sales_detail` do Codex sửa thiếu một dấu ngoặc đóng, nhưng mọi test vẫn qua | Áp dụng file lên DB thật thì báo `mismatched parentheses` | Thêm dấu ngoặc, áp dụng lại và so khớp từng hàm giữa file và DB |
| 9 | Form đặt lịch tái dùng class `.ai-error`, mà khung chat toàn màn hình lại đặt class này vào cột lưới thứ 2. Khi có lỗi, form bị tách làm hai cột. Lỗi cũng không tự xoá khi đổi ngày hoặc giờ | Sinh viên chụp màn hình form bị vỡ lúc chưa xác minh số điện thoại | Dùng class riêng `ai-booking-error`; xoá lỗi khi đổi ngày, giờ hoặc chuyên viên; khi thiếu xác minh thì thêm link tới hồ sơ |
| 12 | Guard đầu ra do AI viết chặn nhầm giá viết tự nhiên như `4,98 tỷ`, ngân sách khách vừa nhắc, hoặc khu vực có hậu tố “cũ”; đường fallback gần nhất cũng có thể trích dẫn nhưng không trả card | Fixture với `4,98 tỷ`/`5,1 tỷ`, “Thủ Đức cũ” và transcript ngân sách được đối chiếu với `sources` | Chuẩn hoá `priceLabel`/`moneyAmounts`, chỉ dùng giá có cấu trúc từ card trước, ghi log lý do guard, và ánh xạ mọi citation tới card tương ứng |
| 13 | Codex thêm bộ lọc lại kết quả tìm kiếm nhưng **chỉ bật khi chạy thật, tắt khi chạy test** (`AI_MODEL!=='fixture'`), nên test luôn qua trong khi bản thật loại sai căn. Codex cũng đưa vào một "lối tắt" trả lời câu hỏi thương lượng, nuốt luôn câu "Căn này giá bao nhiêu, có thương lượng không?" nên không còn giá lẫn thẻ căn | Sinh viên yêu cầu chạy bộ đánh giá 60 câu thật; đối chiếu từng câu fail và gửi lại đúng request với tiếng Việt UTF-8 | Bộ lọc lại chỉ giữ hai kiểm tra cần thiết (khu vực, loại giao dịch); fixture có địa chỉ thực tế; lối tắt thương lượng chỉ áp cho câu hỏi thương lượng thuần |
| 14 | Prompt "giọng tư vấn" do AI viết lại đã đánh rơi quy tắc cấm bịa thời gian di chuyển; AI trả lời "đi Quận 1 mất khoảng 15–30 phút" không có nguồn | Bộ đánh giá báo thiếu câu "chưa có thông tin" ở câu hỏi khoảng cách | Đưa lại quy tắc vào prompt và thêm chốt chặn `UNSUPPORTED_TRAVEL`: chặn số phút/km không có trong nguồn hay trong câu khách hỏi |

## 7. Phần của các thành viên khác

Mỗi thành viên tự khai theo mẫu ở mục 1–6 cho phần mình phụ trách: công cụ, phần do AI tạo, prompt chính, những gì đã kiểm tra, và ít nhất 2 trường hợp AI sai.

- **Lê Anh Đức — M01 (đăng nhập Google), M02 (danh sách sở hữu, thùng rác), M03 (yêu cầu tư vấn), M11 (quản lý tài khoản Sales):** *(thành viên bổ sung)*
- **Nguyễn Đỗ Minh Quân — M04 (quản lý lead), M05 (không gian Sales):** *(thành viên bổ sung)*
