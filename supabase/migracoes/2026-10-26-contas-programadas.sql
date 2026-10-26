-- Contas de anúncio com campanha programada (ainda sem ID ou ainda não iniciada)
alter table public.contas_anuncio alter column conta_externa drop not null;
alter table public.contas_anuncio add column if not exists nicho text check (nicho in ('imoveis','agro','outro'));
alter table public.contas_anuncio add column if not exists verba numeric(14,2) check (verba >= 0);
alter table public.contas_anuncio add column if not exists inicio_campanha date;
alter table public.contas_anuncio add column if not exists status text not null default 'ativa' check (status in ('programada','ativa','pausada','encerrada'));
