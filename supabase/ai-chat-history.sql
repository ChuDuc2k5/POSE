-- M06: owner-scoped chat history for signed-in customers.
-- Apply after supabase/ai-agent.sql.
create or replace function public.pose_ai_mask_chat_title(p_text text)
returns text language sql immutable security definer set search_path='' as $$
  select left(regexp_replace(pose_private.ai_strip_phones(coalesce(p_text,'')), '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[email đã ẩn]', 'gi'), 80);
$$;
revoke all on function public.pose_ai_mask_chat_title(text) from public, anon, authenticated;

create or replace function pose_private.ai_list_sessions(p_page integer default 1)
returns table(id uuid, title text, updated_at timestamptz, message_count integer)
language sql security definer set search_path='' as $$
  select s.id, public.pose_ai_mask_chat_title(coalesce((select m.content from public.ai_chat_messages m where m.session_id=s.id and m.role='user' order by m.created_at, m.id limit 1), 'Cuộc trò chuyện mới')), coalesce(s.last_message_at, s.created_at), s.message_count
  from public.ai_chat_sessions s
  where s.user_id=pose_private.require_account() and s.store_transcript and s.status<>'Closed'
  order by coalesce(s.last_message_at, s.created_at) desc, s.id desc
  offset greatest(coalesce(p_page,1)-1,0)*20 limit 20;
$$;
revoke all on function pose_private.ai_list_sessions(integer) from public, anon, authenticated;

create or replace function public.pose_ai_list_sessions(p_page integer default 1)
returns table(id uuid, title text, updated_at timestamptz, message_count integer)
language sql security invoker set search_path='' as $$ select * from pose_private.ai_list_sessions(p_page); $$;
revoke all on function public.pose_ai_list_sessions(integer) from public, anon;
grant execute on function public.pose_ai_list_sessions(integer) to authenticated;
