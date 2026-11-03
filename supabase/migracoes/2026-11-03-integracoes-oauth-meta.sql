-- "Conectar com Facebook" (aplicada em 03/11/2026): tokens só para o servidor + status para o admin.
create table if not exists public.integracoes (provedor text primary key, token text not null, expira_em timestamptz, usuario_nome text,
  extra jsonb not null default '{}'::jsonb, conectado_por uuid references public.membros(id) on delete set null, atualizado_em timestamptz not null default now());
create table if not exists public.meta_paginas (id text primary key, nome text, token text not null, assinada boolean not null default false, erro text, atualizado_em timestamptz not null default now());
create table if not exists public.oauth_estados (estado text primary key, usuario uuid not null, provedor text not null, criado_em timestamptz not null default now());
alter table public.integracoes enable row level security;
alter table public.meta_paginas enable row level security;
alter table public.oauth_estados enable row level security;
revoke all on public.integracoes, public.meta_paginas, public.oauth_estados from anon, authenticated;
create or replace function public.integracoes_status() returns jsonb language sql stable security definer set search_path to '' as $$
  select case when not privado.eh_admin() then null else jsonb_build_object(
    'meta', (select jsonb_build_object('conectado', true, 'nome', i.usuario_nome, 'expira_em', i.expira_em, 'atualizado_em', i.atualizado_em,
                                       'paginas', (select count(*) from public.meta_paginas), 'paginas_assinadas', (select count(*) from public.meta_paginas where assinada))
             from public.integracoes i where i.provedor = 'meta')) end $$;
revoke all on function public.integracoes_status() from public, anon;
grant execute on function public.integracoes_status() to authenticated;
