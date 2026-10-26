-- Hotfix 14: make the extra-cost FAQ discoverable from price-finality wording.
begin;

update public.kb_documents
set body = body || E'\nAlias: gia ban cuoi cung phat sinh them chi phi; gia ban da bao gom chua; chi phi phat sinh khi ky hop dong.'
where source_type='Faq'
  and title='Mua nhà đất thường phát sinh những chi phí nào?'
  and body not like '%Alias: gia ban cuoi cung phat sinh them chi phi%';

commit;
