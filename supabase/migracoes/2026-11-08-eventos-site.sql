-- danova AI — Eventos do site ("Onde a danova AI esteve presente").
-- O administrador cria eventos e envia fotos/vídeos pelo CRM (módulo Eventos); o site lê daqui.
-- Leitura pública só dos eventos publicados; escrita só de administradores.

create table if not exists public.site_eventos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  nome text not null check (char_length(nome) between 1 and 160),
  local text check (char_length(local) <= 300),
  tag text check (char_length(tag) <= 20),
  link text check (char_length(link) <= 500),
  icone text not null default '◆' check (char_length(icone) <= 4),
  ordem int not null default 0,
  publicado boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.site_evento_midias (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.site_eventos(id) on delete cascade,
  tipo text not null check (tipo in ('foto','video')),
  url text not null check (char_length(url) <= 1000),
  caminho text check (char_length(caminho) <= 500),   -- caminho no bucket "eventos" (vazio = arquivo antigo do site ou link externo)
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists site_evento_midias_evento_idx on public.site_evento_midias(evento_id, tipo, ordem);

create or replace function public.site_eventos_tocar() returns trigger
language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists site_eventos_tocar on public.site_eventos;
create trigger site_eventos_tocar before update on public.site_eventos for each row execute function public.site_eventos_tocar();

alter table public.site_eventos enable row level security;
alter table public.site_evento_midias enable row level security;

drop policy if exists "publico le eventos publicados" on public.site_eventos;
create policy "publico le eventos publicados" on public.site_eventos for select to anon, authenticated
  using (publicado);
drop policy if exists "admin gerencia eventos" on public.site_eventos;
create policy "admin gerencia eventos" on public.site_eventos for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

drop policy if exists "publico le midias publicadas" on public.site_evento_midias;
create policy "publico le midias publicadas" on public.site_evento_midias for select to anon, authenticated
  using (exists (select 1 from public.site_eventos e where e.id = evento_id and e.publicado));
drop policy if exists "admin gerencia midias" on public.site_evento_midias;
create policy "admin gerencia midias" on public.site_evento_midias for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

grant select on public.site_eventos, public.site_evento_midias to anon;
grant select, insert, update, delete on public.site_eventos, public.site_evento_midias to authenticated;

-- Bucket público para as fotos e vídeos (até 50 MB por arquivo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eventos', 'eventos', true, 52428800, array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin le midias de eventos" on storage.objects;
create policy "admin le midias de eventos" on storage.objects for select to authenticated
  using (bucket_id = 'eventos' and (select privado.eh_admin()));
drop policy if exists "admin envia midias de eventos" on storage.objects;
create policy "admin envia midias de eventos" on storage.objects for insert to authenticated
  with check (bucket_id = 'eventos' and (select privado.eh_admin()));
drop policy if exists "admin altera midias de eventos" on storage.objects;
create policy "admin altera midias de eventos" on storage.objects for update to authenticated
  using (bucket_id = 'eventos' and (select privado.eh_admin()));
drop policy if exists "admin apaga midias de eventos" on storage.objects;
create policy "admin apaga midias de eventos" on storage.objects for delete to authenticated
  using (bucket_id = 'eventos' and (select privado.eh_admin()));

-- Eventos que já estavam no site (arquivos continuam em public_html/img/eventos)
insert into public.site_eventos (slug, nome, local, tag, link, icone, ordem) values
  ('sinal-junho-fifa-2026', 'Sinal Junho FIFA 2026', 'Miami Beach · Flórida', '2026', null, '◎', 1),
  ('cmi-rio-2026', 'CMI Rio 2026', 'Rio de Janeiro · Brasil', '2026', 'https://www.cmi2026brazil.org/', '◈', 2),
  ('global-family-office-2026', 'Global Family Office 2026', 'Global Family Office Investment Summit · Miami, Sunny Isles', '2026', null, '◆', 3)
on conflict (slug) do nothing;

insert into public.site_evento_midias (evento_id, tipo, url, ordem)
select e.id, m.tipo, m.url, m.ordem
from (values
  ('sinal-junho-fifa-2026','foto',12), ('cmi-rio-2026','foto',6), ('global-family-office-2026','foto',5)
) as s(slug, tipo, n)
join public.site_eventos e on e.slug = s.slug
cross join lateral (select s.tipo as tipo, 'img/eventos/' || s.slug || '/' || lpad(i::text, 2, '0') || '.webp' as url, i as ordem from generate_series(1, s.n) i) m
where not exists (select 1 from public.site_evento_midias x where x.evento_id = e.id);

insert into public.site_evento_midias (evento_id, tipo, url, ordem)
select e.id, 'video', 'img/eventos/cmi-rio-2026/video-01.mp4#t=0.1', 100
from public.site_eventos e
where e.slug = 'cmi-rio-2026' and not exists (select 1 from public.site_evento_midias x where x.evento_id = e.id and x.tipo = 'video');
