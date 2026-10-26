-- Integrações: landing pages e formulários externos cadastrados no CRM (tela "Integrações").
create table if not exists public.fontes_lead (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('landing','formulario')),
  nome text not null check (char_length(nome) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  url text,
  plataforma text check (plataforma is null or plataforma in ('elementor','wordpress','rdstation','typeform','google-forms','hubspot','jotform','tally','webflow','wix','outro')),
  conta_anuncio_id uuid references public.contas_anuncio(id) on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.fontes_lead enable row level security;
drop policy if exists "admin gerencia fontes" on public.fontes_lead;
create policy "admin gerencia fontes" on public.fontes_lead for all to authenticated
  using (privado.eh_admin()) with check (privado.eh_admin());
grant select, insert, update, delete on public.fontes_lead to authenticated;
