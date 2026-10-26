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
| 15 | Đường trả lời nhanh do AI viết (`complete()`) chỉ gửi cho model tên, giá và vị trí của căn, **bỏ mất nội dung tin đăng** (phòng ngủ, tầng, nội thất, sổ hồng). Vì vậy AI liên tục trả lời "chưa có thông tin" dù tin đăng có ghi. Khi khách mở chat trên trang chi tiết, AI không biết khách đang xem căn nào mà liệt kê 5 căn tương tự | Sinh viên chạy bộ 50 câu hỏi thường gặp và chấm điểm từng câu (trung bình 5,4/10); hỏi trên trang chi tiết với `property_id` | Gửi nội dung tin đăng (`details`) và kiến thức FAQ vào model; khi có căn đang xem thì chỉ dùng căn đó cùng FAQ liên quan, bỏ bước rerank. Điểm sau sửa khoảng 8,9/10; bộ đánh giá 60 câu đạt 52/60 |
| 16 | Codex báo "đã sửa" lỗi hậu tố "khoản vay ngân hàng" nhưng vẫn so khớp trên chữ đã bỏ dấu, nên "vậy" vẫn bị đọc thành "vay". Codex cũng **ghi sai trong báo cáo** rằng lệnh kiểm tra mã hoá không ra kết quả, trong khi đã làm hỏng tiếng Việt ở 3 file | Review diff và tự chạy lại lệnh `git grep` kiểm tra mã hoá | So khớp từ "vay" trên chữ có dấu, sửa lại chữ bị hỏng, thêm test hồi quy `ai-faq50.spec.ts` |
| 17 | Guard do AI viết chặn nhầm câu trả lời đúng: coi "khu vực bảo đảm quốc phòng" và "để đảm bảo quyền lợi" là lời cam kết, coi "đã có sổ hồng" là bịa dù tin đăng ghi "sẵn sổ", và chặn số phòng ngủ chính khách vừa hỏi. Khi bị chặn, câu trả lời rơi về dạng liệt kê máy móc | Đọc log `guard_block` cho từng câu bị chặn trong bộ 50 câu | Chỉ cho qua khi có căn cứ: pháp lý có trong tin đăng, thông lệ chung có trong FAQ, số phòng do khách nêu. Lời hứa và yêu cầu chuyển tiền ngay vẫn bị chặn |
| 18 | Khi khách hỏi "có 2 tỷ, vay thêm thì mua được căn nào", AI coi 2 tỷ là giá tối đa và tự tính sai ra "khoảng 3 tỷ". AI cũng coi "trung tâm **mua** sắm" là dấu hiệu căn đang bán, và đọc "Tân Phú Trung" (xã ở Củ Chi) là quận Tân Phú | Đối chiếu câu trả lời với dữ liệu thật trong bộ 60 câu và log `guard_block` | Ngân sách khi vay được tính theo giả định vay 60% (2 tỷ → khoảng 5 tỷ) và đưa sẵn cho model; sửa nhận diện "mua sắm"; so khớp địa danh theo ranh giới từ; thêm test hồi quy |
| 19 | Với bộ câu hỏi 51–100, chat do AI viết hỏi lại "khu vực nào, ngân sách bao nhiêu" cho 16 câu đã có tiêu chí rõ ("máy lạnh và máy giặt", "chỗ đậu ô tô", "tầng thấp") hoặc là câu hỏi tư vấn ("mua nhà lần đầu bắt đầu từ đâu"). "Có nhà nào đang bán ở Thủ Đức" bị hiểu là chủ nhà muốn bán. Codex báo đã xử lý "giá tính bằng tỷ là mua" nhưng thực tế chưa, nên "nhà Quận 7 dưới 5 tỷ" vẫn ra nhà cho thuê | Sinh viên chạy 50 câu thật, chấm từng câu (trung bình 5,7/10) và tự kiểm tra lại từng mục Codex báo "đã xong" | Tìm kiếm theo đặc điểm, trả lời câu tư vấn bằng FAQ, hiện căn rồi mới hỏi thêm; sửa nhận diện chủ nhà, suy luận mua/thuê theo đơn vị giá, so giá với khu vực, căn tương tự. Sau sửa trung bình 9,4/10 |
| 20 | Trong chuỗi hotfix AI chat, Codex: (a) sửa thẳng vào một migration đã được áp dụng lên database thay vì tạo migration mới; (b) báo hotfix 10d "xong" nhưng **không thêm test nào** dù brief yêu cầu 4 test; (c) viết chữ tiếng Việt dạng `\u1ead` khó đọc; (d) đặt giới hạn 4 nút gợi ý trong khi bộ nút ngân sách có 5 nút. Hàm tổng hợp khu vực do AI viết gom theo tên phường mới nên "Thủ Đức" bị tách thành nhiều dòng | Sinh viên xem `git status`/diff từng hotfix, so số lượng test trước và sau, ghi nhãn từng kiểm tra để so khớp, gọi thử hàm tổng hợp trên database thật | Tách phần sửa sang migration mới; yêu cầu Codex bổ sung test; đổi chữ về tiếng Việt; nâng giới hạn lên 6 nút; gom khu vực theo quận cũ bằng bảng `hcm-wards` |

## 7. Phần của các thành viên khác

Mỗi thành viên tự khai theo mẫu ở mục 1–6 cho phần mình phụ trách: công cụ, phần do AI tạo, prompt chính, những gì đã kiểm tra, và ít nhất 2 trường hợp AI sai.

- **Lê Anh Đức — M01 (đăng nhập Google), M02 (danh sách sở hữu, thùng rác), M03 (yêu cầu tư vấn), M11 (quản lý tài khoản Sales):** *(thành viên bổ sung)*
- **Nguyễn Đỗ Minh Quân — M04 (quản lý lead), M05 (không gian Sales):** *(thành viên bổ sung)*
