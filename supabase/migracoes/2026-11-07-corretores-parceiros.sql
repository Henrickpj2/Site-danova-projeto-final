-- danova AI — Corretores parceiros: rede de corretores (contatos, sem login no CRM).
-- Diferente de "membros" (usuários com acesso), aqui ficam corretores com quem a danova AI se relaciona
-- para parcerias e indicações. Só administradores veem e editam.

create table if not exists public.parceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null default '' check (char_length(nome) <= 200),
  telefone text check (char_length(telefone) <= 40),
  email text check (char_length(email) <= 200),
  creci text check (char_length(creci) <= 40),
  cidade text check (char_length(cidade) <= 120),
  imobiliaria text check (char_length(imobiliaria) <= 200),
  origem text check (char_length(origem) <= 200),
  status text not null default 'novo' check (status in ('novo','em_contato','parceiro','sem_interesse')),
  observacoes text check (char_length(observacoes) <= 4000),
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint parceiro_tem_contato check (coalesce(telefone,'') <> '' or coalesce(email,'') <> '')
);
create index if not exists parceiros_status_idx on public.parceiros(status);
create index if not exists parceiros_origem_idx on public.parceiros(origem);
create unique index if not exists parceiros_telefone_unico
  on public.parceiros (right(regexp_replace(telefone, '\D', '', 'g'), 9))
  where coalesce(telefone,'') <> '';

create or replace function public.parceiros_tocar() returns trigger
language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists parceiros_tocar on public.parceiros;
create trigger parceiros_tocar before update on public.parceiros for each row execute function public.parceiros_tocar();

alter table public.parceiros enable row level security;
drop policy if exists "admin gerencia parceiros" on public.parceiros;
create policy "admin gerencia parceiros" on public.parceiros for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
