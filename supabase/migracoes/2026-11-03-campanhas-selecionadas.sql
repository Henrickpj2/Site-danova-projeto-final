-- Campanhas escolhidas pelo admin em cada conta de anúncio (vazio = todas). Aplicada em 03/11/2026.
alter table public.contas_anuncio add column if not exists campanhas_sel jsonb not null default '[]'::jsonb;
alter table public.contas_anuncio drop constraint if exists contas_anuncio_campanhas_sel_array;
alter table public.contas_anuncio add constraint contas_anuncio_campanhas_sel_array check (jsonb_typeof(campanhas_sel) = 'array' and jsonb_array_length(campanhas_sel) <= 300);
