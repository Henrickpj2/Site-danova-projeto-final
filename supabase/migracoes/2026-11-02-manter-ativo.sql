-- Função mínima chamada todo dia pela rotina .github/workflows/manter-supabase-ativo.yml (aplicada em 02/11/2026).
create or replace function public.manter_ativo()
returns timestamptz language sql stable security invoker set search_path to '' as $$ select now() $$;
revoke all on function public.manter_ativo() from public;
grant execute on function public.manter_ativo() to anon, authenticated;
