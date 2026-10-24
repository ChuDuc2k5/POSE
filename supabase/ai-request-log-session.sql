-- M06 governance: model calls are logged during the turn, before a new guest session row is
-- committed, so a foreign key to ai_chat_sessions rejected those rows. Keep session_id as a
-- plain indexed reference (no data is removed).
begin;
alter table public.ai_request_log drop constraint if exists ai_request_log_session_id_fkey;
create index if not exists ai_request_log_session_idx on public.ai_request_log(session_id);
commit;
