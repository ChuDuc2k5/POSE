-- Orientation and sunlight, so answers about "nắng chiều" do not guess (question 79).
begin;
insert into public.kb_documents(source_type,title,body,metadata,published)
select 'Faq',v.title,v.body,'{"set":"faq100"}'::jsonb,true
from (values
('Hướng căn hộ ảnh hưởng nắng chiều thế nào?','Ở TP. Hồ Chí Minh, mặt trời buổi sáng ở phía Đông và buổi chiều ở phía Tây. Căn có ban công hoặc cửa sổ hướng Tây, Tây Nam, Tây Bắc thường nhận nắng chiều gay gắt; căn hướng Đông, Đông Nam, Đông Bắc chủ yếu nhận nắng sáng và mát hơn vào buổi chiều; hướng Nam và Bắc ít bị nắng chiếu trực tiếp. Mức nắng thực tế còn phụ thuộc tầng, công trình xung quanh và rèm che, nên khách nên xem nhà vào buổi chiều để kiểm tra.')
) as v(title,body)
where not exists(select 1 from public.kb_documents d where d.source_type='Faq' and d.title=v.title);
commit;
