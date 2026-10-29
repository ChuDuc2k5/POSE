# Nhật ký sử dụng AI của Nguyễn Đỗ Minh Quân

## 1. Người khai và phạm vi

| Mục | Nội dung |
| --- | --- |
| Người khai | Nguyễn Đỗ Minh Quân |
| Tên tác giả xuất hiện trong Git | `mQnaz` |
| Nhánh làm việc | `mquan` |
| Dự án | POSE, giao diện thương hiệu TERAVA |
| Phạm vi khai báo | M04 Lead Management, M05 Sales Management, M09 Appointment Management và M10 Lead Reporting |
| Công cụ hỗ trợ | OpenAI Codex |
| Thời gian thực hiện | Tháng 10/2026 |
| Ngày tổng hợp | 27/10/2026 |

Tôi sử dụng Codex để thảo luận yêu cầu, đọc cấu trúc dự án và schema được cung cấp, đề xuất phương án, hỗ trợ viết code, SQL, giao diện và kiểm thử cho bốn module trên. Tôi quyết định phạm vi và quy tắc nghiệp vụ, phản hồi kết quả khi dùng thử và yêu cầu điều chỉnh trước khi tiếp tục.

Nhật ký này khai báo việc sử dụng AI hỗ trợ phát triển phần mềm. Việc module của tôi đọc dữ liệu hoặc điểm Lead do hệ thống hiện có cung cấp không có nghĩa tôi xây dựng mô hình chấm điểm hay chatbot.

File này là phần khai báo cá nhân, bổ sung cho nhật ký chung `AI_USAGE.md`. Nội dung không thay thế hoặc sửa phần khai của thành viên khác.

## 2. Cách tôi làm việc với AI

1. Tôi yêu cầu brainstorm trước khi implementation. Những lựa chọn nghiệp vụ được trao đổi và chốt từng vấn đề.
2. Tôi cung cấp phản hồi giao diện, yêu cầu phân công module và kết quả truy vấn schema Supabase để Codex đối chiếu với cấu trúc hiện có.
3. Tôi giới hạn việc implementation trong module đang thực hiện và các điểm tích hợp cần thiết, như đăng ký module hoặc mục điều hướng vào màn hình tương ứng.
4. Codex hỗ trợ tạo API, validator, RPC SQL, component giao diện và các bộ kiểm thử. Tôi yêu cầu dùng lại dữ liệu và cơ chế có sẵn khi phù hợp.
5. Tôi chạy ứng dụng, xem giao diện và gửi ảnh hoặc thông báo lỗi để thảo luận, sửa hoặc khôi phục thay đổi khi cần. Việc xem UI được phân biệt với việc kiểm thử đầy đủ luồng tích hợp.
6. Tôi thực hiện các bước Git trên nhánh `mquan` theo hướng dẫn, kiểm tra trạng thái, commit và push phần việc của mình.

## 3. Các phần AI hỗ trợ và quyết định của tôi

### 3.1. M04 Lead Management

**Phần Codex hỗ trợ**

- API danh sách, chi tiết, cập nhật hồ sơ, trạng thái, lưu trữ và tiếp nhận Lead.
- Kiểm tra tham số, trường được phép sửa, phiên bản dữ liệu và phạm vi truy cập.
- Giao diện danh sách, bộ lọc, hồ sơ Lead và quan hệ Sales phụ trách BĐS.
- SQL hỗ trợ quản lý, phân công theo BĐS và hàng đợi xử lý phân bổ.
- Kiểm thử validator và HTTP của module.

**Các quyết định tôi đã chốt hoặc yêu cầu sửa**

- Định danh khách hàng được liên kết qua `customer_id`; không tạo thêm bản sao thông tin khách khi chưa cần thiết.
- Dùng điểm và cơ chế chấm điểm hiện có; không cho người dùng sửa trực tiếp điểm hoặc nhiệt độ Lead.
- Khi khách đủ điều kiện ghi nhận nhu cầu nhưng chưa có BĐS phù hợp, vẫn cần giữ Lead chưa phân công Sales.
- Xây dựng quan hệ Sales với BĐS để làm căn cứ phân công.
- Bỏ quy trình chờ xét duyệt chuyển Sales và các thao tác chuyển giao đã loại khỏi phạm vi brainstorm.
- Đổi tên bảng hoặc file mang tên module sang tên theo nghiệp vụ, như `lead_routing_queue` và `lead-management.sql`.
- Trong giai đoạn chờ phần tạo Lead từ hệ thống bên ngoài hoàn thành, tôi yêu cầu không thêm mock data vào dữ liệu ứng dụng để giả lập luồng đã hoàn tất.

**Vị trí hiện thực chính**

- Backend: `backend/src/modules/leads/`.
- Frontend: `frontend/components/leads/`, `frontend/lib/leads.ts`, trang Lead trong `frontend/app/`.
- Database: `supabase/lead-management.sql`.
- Kiểm thử: `backend/test/leads.spec.ts`, `backend/test/leads-http.spec.ts`.

### 3.2. M05 Sales Management

**Phần Codex hỗ trợ**

- Không gian làm việc cho Sales với danh sách Lead được giao và hồ sơ liên quan.
- Hoạt động tư vấn, ghi chú, phản hồi, xác nhận nhu cầu và ghi nhận kết quả.
- Danh sách và chi tiết BĐS Sales đang phụ trách theo quyền.
- Kiểm tra dữ liệu ghi, phiên bản, lý do thay đổi và quyền truy cập.
- SQL, component giao diện và kiểm thử của module.

**Các quyết định tôi đã chốt hoặc yêu cầu sửa**

- Bỏ phần bàn giao khỏi phạm vi M05 đã thống nhất.
- BĐS trong M05 phục vụ xem thông tin; quản lý và chỉnh sửa BĐS không thuộc công việc này.
- Sales làm việc trong phạm vi được giao, không tùy ý ghi đè người phụ trách hay điểm Lead.
- Khi Lead đã `CONVERTED` hoặc `LOST`, khóa chỉnh sửa đối với Sales; giữ khả năng xử lý ngoại lệ theo quyền Admin và quy tắc của hệ thống.
- Thống nhất khung điều hướng giữa M04 và M05, giảm việc dựng lại toàn trang khi chuyển chức năng và giữ trạng thái làm việc phù hợp.

**Vị trí hiện thực chính**

- Backend: `backend/src/modules/sales/`.
- Frontend: `frontend/components/sales/`, `frontend/lib/sales.ts`.
- Phần dùng chung phục vụ không gian các module: `frontend/components/crm/`, `frontend/lib/crm-store.ts`.
- Database: `supabase/sales-management.sql`.
- Kiểm thử: `backend/test/sales.spec.ts`, `backend/test/sales-http.spec.ts`.

### 3.3. M09 Appointment Management

**Phần Codex hỗ trợ**

- API danh sách, chi tiết, lựa chọn dữ liệu, tạo và cập nhật lịch hẹn.
- Form tạo, sửa, đổi lịch, hoàn thành hoặc hủy; giao diện chi tiết và lịch sử thay đổi.
- Kiểm tra thời gian, kết quả, lý do, phiên bản, Lead và phạm vi Sales.
- SQL quản lý lịch hẹn, sự kiện thay đổi và kiểm soát lịch chồng lấn trên bảng hiện có.
- Kiểm thử validator và hợp đồng HTTP.

**Các quyết định tôi đã chốt hoặc yêu cầu sửa**

- Bỏ công việc chăm sóc, không triển khai nhắc hẹn trong giai đoạn này.
- Chỉ cung cấp ba trạng thái cho quy trình mới: `SCHEDULED`, `COMPLETED`, `CANCELLED`; bỏ lựa chọn khách không tham gia khỏi quy trình mới.
- Tôi dừng việc chọn mô hình dữ liệu mới để cung cấp schema Supabase vì project đã có `public.appointments`, sau đó đồng ý tái sử dụng bảng này.
- Lịch hẹn gắn với Lead; BĐS là thông tin liên quan tùy chọn theo nghiệp vụ.
- Sales bị giới hạn theo Lead được giao; Admin có phạm vi xử lý rộng hơn và các thao tác cần lý do được ghi lịch sử.
- Hoàn thành lịch hẹn không tự đồng nghĩa Lead đã mua BĐS, không tự thay đổi điểm hoặc kết quả của Lead.
- Tôi đã phản hồi về form và thông tin người tư vấn. Các thay đổi đặt lịch từ chatbot, gợi ý Sales theo địa bàn và tích hợp tiếp theo do thành viên khác thực hiện không được nhận là phần tôi tự xây dựng trong bản khai này.

**Vị trí hiện thực chính**

- Backend: `backend/src/modules/appointments/`, chủ yếu controller, handler và validator cho quản lý lịch.
- Frontend: `frontend/components/appointments/`, `frontend/lib/appointments.ts`.
- Database: `supabase/appointment-management.sql`, sử dụng `public.appointments`.
- Kiểm thử: `backend/test/appointments.spec.ts`, `backend/test/appointments-http.spec.ts`.

### 3.4. M10 Lead Reporting

**Phần Codex hỗ trợ**

- API dữ liệu báo cáo Lead và danh mục bộ lọc theo quyền.
- RPC chỉ đọc phục vụ thống kê và biểu đồ.
- Dashboard báo cáo Lead với khoảng thời gian, trạng thái, nhiệt độ, lưu trữ và bộ lọc Sales dành cho Admin.
- Biểu đồ trạng thái, nhiệt độ và xu hướng phát sinh Lead.
- Xử lý ngày theo giờ Việt Nam, thay đổi bộ lọc và làm mới dữ liệu.
- Kiểm thử phạm vi truy cập, hợp đồng HTTP và các trường hợp biên về ngày tháng.

**Các quyết định tôi đã chốt hoặc yêu cầu sửa**

- Tập trung vào Lead và kết quả nghiệp vụ trong phạm vi đã thống nhất.
- Bỏ báo cáo cuộc gọi và hiệu suất Sales khỏi phạm vi implementation M10 này.
- Bỏ tỷ lệ chuyển đổi và số chuyển đổi phát sinh trong kỳ.
- Giữ chỉ số Lead phát sinh trong kỳ, số Lead trong tập đó hiện đã chuyển đổi; Admin có thêm số Lead chưa phân công theo phạm vi báo cáo.
- Dữ liệu tính theo tập Lead được tạo trong khoảng thời gian đã chọn và trạng thái hiện tại, không diễn giải thành số sự kiện chuyển đổi xảy ra trong kỳ.
- Xuất báo cáo tạm để giao diện hoặc thông báo phạm vi; chưa nhận là chức năng tải file đã hoàn chỉnh.

**Vị trí hiện thực chính**

- Backend: `backend/src/modules/reports/`.
- Frontend: `frontend/components/reports/`, `frontend/lib/reports.ts`.
- Database: `supabase/lead-reporting.sql`.
- Kiểm thử: `backend/test/reports.spec.ts`, `backend/test/reports-http.spec.ts`.

## 4. Các yêu cầu chính tôi đã gửi cho AI

Các trích đoạn dưới đây lấy từ trao đổi khi thực hiện phần việc; cách viết được giữ theo yêu cầu đã gửi.

| Phạm vi | Yêu cầu tiêu biểu | Điều tôi muốn kiểm soát |
| --- | --- | --- |
| M04 | “xử lí M04 trước đã, nếu đã có bộ chấm điểm thì sử dụng bộ đó” | Tái sử dụng cơ chế có sẵn, không tự tạo bộ chấm điểm mới. |
| M04 | “không sửa, điểm được tính ra thì để như vậy” | Không cho sửa trực tiếp điểm Lead. |
| M04 | “bỏ phần chuyển sang sale khác với chờ xét duyệt đi” | Loại quy trình chưa cần thiết khỏi phạm vi. |
| M05 | “triển khai implementation cho M05 nhưng không đụng tới các MODULE khác, nhớ theo phương án đã chốt của t với m trong brainstorm” | Implementation theo thỏa thuận và giới hạn module. |
| M05 | “trong module này thì chỉ xem các thông tin về BDS thôi còn chỉnh sửa quản lí thì để module khác” | Không mở rộng M05 thành quản lý danh mục BĐS. |
| M09 | “bỏ công việc chăm sóc đi, chỉ giữ lại lịch hẹn thôi” | Thu hẹp chức năng vào lịch hẹn. |
| M09 | “tạm thời chưa thực hiện chức năng nhắc hẹn” | Không tạo nhắc hẹn ngoài phạm vi đã chốt. |
| M09 | “khoan đã, đưa t câu truy vấn lấy thông tin về db đi, trên supabase của t đã có appoinment rồi” | Kiểm tra schema thật trước khi chọn mô hình dữ liệu. |
| M10 | “bỏ tỷ lệ chuyển đổi và chuyển đổi phát sinh trong kì đi” | Thống kê đúng định nghĩa nghiệp vụ đã chọn. |
| M10 | “phần xuất báo cáo tạm thời chỉ để như vậy chưa cần ưu tiên hoàn chỉnh chức năng” | Phân biệt UI dự kiến với tính năng đã hoàn thiện. |

## 5. Kiểm tra và xác minh kết quả AI tạo

### 5.1. Kiểm tra nghiệp vụ và giao diện

- Tôi đối chiếu lựa chọn AI đề xuất với các quyết định đã chốt trong brainstorm, như điểm chỉ đọc, bỏ bàn giao, bỏ nhắc hẹn và định nghĩa tập Lead trong báo cáo.
- Tôi chạy ứng dụng để xem UI; gửi ảnh hoặc mô tả các điểm chưa phù hợp như thanh điều hướng không thống nhất, chuyển trang thiếu mượt và các thành phần không cần thiết trong dashboard.
- Tôi phân biệt xem giao diện với kiểm thử toàn bộ luồng. Khi phần tích hợp chưa sẵn sàng, tôi yêu cầu chờ thay vì thêm dữ liệu giả vào ứng dụng để trình bày như đã hoàn tất.
- Schema Supabase tôi cung cấp được dùng để kiểm tra quan hệ và tái sử dụng dữ liệu, đặc biệt là `customers`, `leads` và `appointments`.

### 5.2. Kiểm thử tự động của bốn module

| Module | File kiểm thử | Nội dung kiểm tra tiêu biểu |
| --- | --- | --- |
| M04 | `backend/test/leads.spec.ts`; `backend/test/leads-http.spec.ts` | Trường được sửa, ngân sách, lý do đổi trạng thái, dữ liệu mua khi chuyển đổi, phân quyền và từ chối thao tác đã loại khỏi phạm vi. |
| M05 | `backend/test/sales.spec.ts`; `backend/test/sales-http.spec.ts` | Hoạt động tư vấn, thời gian, lý do chỉnh sửa, không cho ghi đè điểm hoặc tác giả, hợp đồng API và quyền truy cập. |
| M09 | `backend/test/appointments.spec.ts`; `backend/test/appointments-http.spec.ts` | Ngày giờ, hình thức và địa điểm, kết quả, lý do đổi/hủy, request key, lỗi chồng lịch và xung đột phiên bản. |
| M10 | `backend/test/reports.spec.ts`; `backend/test/reports-http.spec.ts` | Khoảng ngày, ngày không hợp lệ, bộ lọc theo vai trò, thời điểm qua ngày tại Việt Nam và hợp đồng API báo cáo. |

Các file trên là bằng chứng kiểm thử hiện có trong repository; nội dung có thể đã được cập nhật thêm sau khi tích hợp. Bản khai này không gán số lượng test hay kết quả chạy mới nhất khi không kèm đầu ra của lần chạy tương ứng.

Có thể chạy lại riêng các bộ kiểm thử này từ thư mục `backend`:

```sh
npm run test -- test/leads.spec.ts test/leads-http.spec.ts test/sales.spec.ts test/sales-http.spec.ts test/appointments.spec.ts test/appointments-http.spec.ts test/reports.spec.ts test/reports-http.spec.ts
```

SQL nghiệp vụ cũng được chuẩn bị và kiểm tra trong quá trình phát triển. Tuy nhiên, file SQL trong Git và test với dữ liệu cô lập không thay thế việc xác minh migration đã áp dụng đúng trên môi trường Supabase dùng để chạy ứng dụng.

## 6. Các trường hợp kết quả AI chưa đúng hoặc chưa đạt yêu cầu

### Trường hợp 1 — Chọn bảng lịch hẹn mới trước khi kiểm tra schema hiện có

- **Kết quả ban đầu:** phương án M09 ban đầu sử dụng nơi lưu lịch hẹn riêng trước khi đối chiếu đầy đủ database hiện có.
- **Tôi phát hiện bằng cách:** dừng việc triển khai và thông báo Supabase đã có bảng appointment; yêu cầu truy vấn thông tin DB và cung cấp schema thực tế.
- **Điều chỉnh:** thống nhất dùng lại `public.appointments`, chuẩn bị `appointment-management.sql` để bổ sung phần quản lý cần thiết và lịch sử thay đổi thay vì tạo kho lịch hẹn trùng.
- **Bài học:** phải đọc schema và các luồng đang sử dụng bảng trước khi để AI thiết kế thêm cấu trúc dữ liệu.

### Trường hợp 2 — Giao diện M04 và M05 chưa thống nhất

- **Kết quả ban đầu:** hai màn hình có thanh điều hướng khác nhau; khi chuyển chức năng, tôi thấy toàn trang dựng lại và thao tác chưa mượt.
- **Tôi phát hiện bằng cách:** chạy giao diện, chụp hai thanh điều hướng và phản hồi trực tiếp trong cuộc trao đổi.
- **Điều chỉnh:** yêu cầu dùng khung điều hướng chung phục vụ M04 và M05, điều hướng phía client và giữ trạng thái làm việc phù hợp. Phần này thể hiện trong commit `aa836ec`.
- **Bài học:** component hoạt động riêng chưa đủ; cần kiểm tra trải nghiệm chuyển qua lại giữa những module liên quan.

### Trường hợp 3 — Tên bảng và file chưa theo quy ước mong muốn

- **Kết quả ban đầu:** một số tên trong bản SQL hoặc file ban đầu mang tiền tố M04, khiến tên thiên về mã phân công hơn là ý nghĩa nghiệp vụ.
- **Tôi phát hiện bằng cách:** đọc và hỏi lại tên bảng, mục đích lưu trữ, đồng thời yêu cầu bỏ tên module khỏi các tên đó.
- **Điều chỉnh:** dùng tên theo nghiệp vụ như `lead_routing_queue` và `lead-management.sql`, làm rõ đây là nơi phục vụ định tuyến Lead, không phải bước chờ duyệt chuyển Sales.
- **Bài học:** cần kiểm tra cả ý nghĩa tên và trách nhiệm của cấu trúc AI tạo, tránh để tên gây hiểu nhầm quy trình.

## 7. Dấu vết đóng góp trong Git

| Commit | Ngày | Tác giả trong Git | Phạm vi đóng góp |
| --- | --- | --- | --- |
| `ec6c07b` | 24/10/2026 | `mQnaz` | M04 quản lý Lead và phân công dựa trên BĐS. |
| `aa836ec` | 25/10/2026 | `mQnaz` | M05 và thống nhất điều hướng M04–M05. |
| `3907ff5` | 26/10/2026 | `mQnaz` | M09 quản lý lịch hẹn và M10 báo cáo Lead. |

Các commit này xác định phần implementation tôi đưa vào lịch sử dự án. Việc file hiện tại chứa thêm thay đổi của thành viên khác sau merge không đồng nghĩa toàn bộ nội dung mới đều do tôi thực hiện.

## 8. Giới hạn của bản khai

- Chỉ khai phần phát triển liên quan đến M04, M05, M09 và M10 cùng điều hướng hoặc trạng thái dùng chung phục vụ các màn hình đó.
- Không nhận phần chatbot, prompt, RAG, mô hình AI, chiến dịch, tổng đài hoặc các module do thành viên khác phụ trách.
- Không nhận riêng phần tích hợp booking từ AI và gợi ý Sales theo địa bàn do thành viên khác bổ sung về sau.
- Các chức năng đã chủ động hoãn như nhắc hẹn và xuất báo cáo đầy đủ không được ghi là đã hoàn tất.
- Những thay đổi UI đã yêu cầu khôi phục trong quá trình trao đổi không được dùng làm bằng chứng cho hiện thực cuối cùng.
