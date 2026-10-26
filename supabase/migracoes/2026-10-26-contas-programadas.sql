-- Contas de anúncio com campanha programada (ainda sem ID ou ainda não iniciada)
alter table public.contas_anuncio alter column conta_externa drop not null;
alter table public.contas_anuncio add column if not exists nicho text check (nicho in ('imoveis','agro','outro'));
alter table public.contas_anuncio add column if not exists verba numeric(14,2) check (verba >= 0);
alter table public.contas_anuncio add column if not exists inicio_campanha date;
alter table public.contas_anuncio add column if not exists status text not null default 'ativa' check (status in ('programada','ativa','pausada','encerrada'));

-- Totais acumulados por cliente (informados manualmente até a sincronização) e código interno DNV-0001…
alter table public.contas_anuncio add column if not exists codigo text unique;
alter table public.contas_anuncio add column if not exists investido numeric(14,2) check (investido >= 0);
alter table public.contas_anuncio add column if not exists leads int check (leads >= 0);
alter table public.contas_anuncio add column if not exists cliques int check (cliques >= 0);
alter table public.contas_anuncio add column if not exists vendas int check (vendas >= 0);
alter table public.contas_anuncio add column if not exists valor_vendas numeric(16,2) check (valor_vendas >= 0);
create sequence if not exists public.contas_anuncio_codigo_seq;
create or replace function public.contas_anuncio_codigo() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.codigo is null then new.codigo := 'DNV-' || lpad(nextval('public.contas_anuncio_codigo_seq')::text, 4, '0'); end if;
  return new;
end $$;
drop trigger if exists contas_anuncio_codigo on public.contas_anuncio;
create trigger contas_anuncio_codigo before insert on public.contas_anuncio for each row execute function public.contas_anuncio_codigo();

-- Campos preenchidos por estimativa (some ao informar o real)
alter table public.contas_anuncio add column if not exists estimados text[] not null default '{}';
