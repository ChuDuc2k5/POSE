-- Run after ai-agent.sql and ai-agent-tools.sql in the same PGlite/real-Postgres fixture.
begin;
do $$
begin
  if to_regclass('public.ai_pending_actions') is null then raise exception 'PENDING_ACTION_TABLE_MISSING'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='ai_pending_actions' and indexname='ai_pending_actions_idempotency_key_key') then raise exception 'PENDING_ACTION_IDEMPOTENCY_MISSING'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_pending_actions' and policyname='ai_pending_owner') then raise exception 'PENDING_ACTION_RLS_MISSING'; end if;
end $$;
rollback;
