-- Catalogue text must be Unicode NFC so that searches such as "Gò Vấp" match.
-- 76 imported listings stored `location` in decomposed form (NFD), which made
-- ilike/alias matching miss them in the catalogue, the AI search and the overview counts.
begin;

create or replace function pose_private.property_text_nfc()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.location is not null then new.location := normalize(new.location, NFC); end if;
  if new.name is not null then new.name := normalize(new.name, NFC); end if;
  return new;
end $$;

drop trigger if exists property_text_nfc on public.property_products;
create trigger property_text_nfc
  before insert or update of location, name on public.property_products
  for each row execute function pose_private.property_text_nfc();

update public.property_products
set location = normalize(location, NFC)
where deleted_at is null
  and location is not null
  and location <> normalize(location, NFC);

commit;
