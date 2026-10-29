-- General answers for first-time buyers, support services and contact requests (questions 51-100).
begin;
insert into public.kb_documents(source_type,title,body,metadata,published)
select 'Faq',v.title,v.body,'{"set":"faq100"}'::jsonb,true
from (values
('Mới tìm hiểu bất động sản thì TERAVA tư vấn thế nào?','TERAVA tư vấn miễn phí cho người mới: trước hết xác định mục đích (mua để ở, đầu tư hay thuê), khu vực mong muốn, ngân sách và số phòng cần có. Trợ lý AI gợi ý các căn phù hợp trên website; chuyên viên tư vấn có thể gọi lại để giải thích pháp lý, thủ tục và đưa khách đi xem nhà.'),
('Mua nhà lần đầu nên bắt đầu từ đâu?','Nên bắt đầu bằng việc xác định ngân sách thực tế (tiền tự có và khả năng vay), mục đích mua, khu vực và loại nhà phù hợp. Sau đó xem nhiều căn để so sánh giá, kiểm tra pháp lý (sổ hồng, quy hoạch, thế chấp), thẩm định khoản vay trước khi đặt cọc, rồi mới ký hợp đồng đặt cọc và hợp đồng mua bán có công chứng.'),
('TERAVA có hỗ trợ thủ tục mua bán nhà đất không?','Có. Chuyên viên TERAVA hỗ trợ kiểm tra hồ sơ pháp lý, soạn và rà soát hợp đồng đặt cọc, đặt lịch công chứng, hướng dẫn nộp thuế phí và làm thủ tục sang tên, đồng thời kết nối ngân hàng nếu khách cần vay. Phí dịch vụ cụ thể do chuyên viên báo khi tư vấn.'),
('Có căn hộ nào được hỗ trợ vay ngân hàng không?','Phần lớn căn hộ và nhà có sổ hồng đều có thể vay ngân hàng; căn đang thế chấp hoặc chưa có sổ cần kiểm tra kỹ hơn. Ngân hàng thường cho vay khoảng 50% đến 70% giá trị tài sản tùy hồ sơ thu nhập. Chuyên viên TERAVA có thể kết nối ngân hàng đối tác để thẩm định khoản vay cho căn khách chọn.'),
('Mua nhà trả góp thì mỗi tháng trả bao nhiêu?','Số tiền trả mỗi tháng phụ thuộc số tiền vay, lãi suất và thời hạn vay. Với cách trả gốc đều, tiền gốc mỗi tháng bằng số tiền vay chia số tháng vay, cộng thêm tiền lãi tính trên dư nợ còn lại nên tháng đầu trả cao nhất rồi giảm dần. Ngân hàng sẽ gửi bảng lịch trả nợ cụ thể khi thẩm định; chuyên viên có thể nhờ ngân hàng tính giúp theo căn khách chọn.'),
('Chưa đủ tiền có thể đặt cọc giữ căn trước không?','Có thể, nếu chủ nhà đồng ý. Khách đặt một khoản cọc để giữ căn trong thời hạn thỏa thuận (thường vài tuần đến vài tháng) để chuẩn bị tiền hoặc chờ ngân hàng giải ngân. Nên ghi rõ thời hạn, điều kiện hoàn cọc khi không vay được và nghĩa vụ hai bên trong hợp đồng đặt cọc.'),
('Thanh toán một lần có được giảm giá không?','Tùy người bán. Nhiều chủ nhà hoặc chủ đầu tư có chiết khấu khi khách thanh toán nhanh hoặc một lần, nhưng mức giảm phải thương lượng và ghi trong hợp đồng. Chuyên viên có thể đề xuất mức giảm với chủ nhà giúp khách.'),
('Làm sao để lại số điện thoại để được tư vấn?','Khách có thể đăng nhập rồi nhắn yêu cầu tư vấn trong khung chat, hoặc gửi biểu mẫu Yêu cầu tư vấn trên trang bất động sản. Số điện thoại được lưu trong hồ sơ an toàn và chỉ chuyên viên phụ trách dùng để gọi lại; khách không cần gửi số điện thoại trong khung chat công khai.'),
('Căn mình thích đã bán thì có căn tương tự không?','Khi một căn đã bán hoặc đã giữ chỗ, trợ lý có thể gợi ý các căn tương tự cùng khu vực, loại hình và mức giá; chuyên viên cũng có thể báo khi có căn mới phù hợp.'),
('Xem thêm hình ảnh căn hộ ở đâu?','Hình ảnh của căn được hiển thị trong trang chi tiết bất động sản trên TERAVA (bấm vào ảnh để xem toàn bộ). Nếu cần thêm hình hoặc video thực tế, chuyên viên phụ trách có thể xin chủ nhà và gửi cho khách.'),
('Khu vực có bị ngập nước khi mưa không?','Tình trạng ngập phụ thuộc từng tuyến đường và vị trí cụ thể. Khách nên hỏi cư dân hoặc ban quản lý, xem nhà vào ngày mưa, hoặc nhờ chuyên viên khảo sát thực tế trước khi quyết định.'),
('Tiền điện nước khi thuê nhà tính thế nào?','Thường có hai cách: theo đồng hồ riêng tính đúng giá của nhà nước (căn hộ chung cư thường áp dụng), hoặc theo giá chủ nhà quy định cho phòng trọ, nhà chia phòng. Cách tính cần ghi rõ trong hợp đồng thuê.')
) as v(title,body)
where not exists(select 1 from public.kb_documents d where d.source_type='Faq' and d.title=v.title);
commit;
