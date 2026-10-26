-- danova AI — Base de conhecimento com RAG (pgvector + embeddings gte-small gerados nas Edge Functions)
create extension if not exists vector with schema extensions;

create table if not exists public.conhecimento_docs (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 1 and 200),
  categoria text not null default 'geral' check (categoria in ('geral','empreendimento','servicos','plataforma','faq','precos','outro')),
  texto text not null default '' check (char_length(texto) <= 200000),
  arquivo_nome text,
  arquivo_path text,
  ativo boolean not null default true,
  status text not null default 'pendente' check (status in ('pendente','indexando','pronto','erro')),
  erro text,
  total_trechos int not null default 0,
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.conhecimento_trechos (
  id bigint generated always as identity primary key,
  doc_id uuid not null references public.conhecimento_docs(id) on delete cascade,
  ordem int not null,
  texto text not null,
  embedding extensions.vector(384) not null
);
create index if not exists conhecimento_trechos_doc_idx on public.conhecimento_trechos(doc_id);
create index if not exists conhecimento_trechos_hnsw on public.conhecimento_trechos using hnsw (embedding extensions.vector_cosine_ops);

alter table public.conhecimento_docs enable row level security;
alter table public.conhecimento_trechos enable row level security;

drop policy if exists "admin gerencia docs" on public.conhecimento_docs;
create policy "admin gerencia docs" on public.conhecimento_docs for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
drop policy if exists "admin le trechos" on public.conhecimento_trechos;
create policy "admin le trechos" on public.conhecimento_trechos for select to authenticated
  using ((select privado.eh_admin()));

-- busca semântica: só o servidor (service_role) chama
create or replace function public.buscar_conhecimento(consulta extensions.vector(384), quantidade int default 6, distancia_max float default 0.55)
returns table (doc_id uuid, titulo text, categoria text, texto text, distancia float)
language sql stable security invoker set search_path = ''
as $$
  select t.doc_id, d.titulo, d.categoria, t.texto, (t.embedding operator(extensions.<=>) consulta)::float as distancia
  from public.conhecimento_trechos t join public.conhecimento_docs d on d.id = t.doc_id
  where d.ativo and d.status = 'pronto' and (t.embedding operator(extensions.<=>) consulta) < distancia_max
  order by t.embedding operator(extensions.<=>) consulta
  limit least(greatest(quantidade, 1), 12);
$$;
revoke all on function public.buscar_conhecimento(extensions.vector, int, float) from public, anon, authenticated;
grant execute on function public.buscar_conhecimento(extensions.vector, int, float) to service_role;

-- arquivos originais (PDF, TXT…) num bucket privado
insert into storage.buckets (id, name, public, file_size_limit)
values ('conhecimento', 'conhecimento', false, 20971520)
on conflict (id) do nothing;
drop policy if exists "admin arquivos conhecimento" on storage.objects;
create policy "admin arquivos conhecimento" on storage.objects for all to authenticated
  using (bucket_id = 'conhecimento' and (select privado.eh_admin()))
  with check (bucket_id = 'conhecimento' and (select privado.eh_admin()));
