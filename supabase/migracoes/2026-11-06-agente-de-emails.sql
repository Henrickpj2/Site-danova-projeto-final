-- PENDENTE: ainda não aplicada no banco (aguardando confirmação do usuário).
-- Agente de IA de e-mails programados: rascunhos que pedem aprovação, envios agendados, regras e campanhas.
-- Fluxo: regra/campanha → rascunho (IA escreve) → corretor/admin aprova → agendado → no horário, a função
-- email-agente entrega ao servidor do site (api/email-fila.php) com um ticket de uso único → Hostinger envia.

-- 1) novos estados e campos dos envios
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.email_sends'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
  if c is not null then execute 'alter table public.email_sends drop constraint ' || quote_ident(c); end if;
end $$;
alter table public.email_sends add constraint email_sends_status_check
  check (status in ('rascunho','agendado','cancelado','pendente','enviando','enviado','entregue','aberto','clicado','atrasado','rejeitado','reclamacao','falhou'));
alter table public.email_sends
  add column if not exists origem text not null default 'manual',          -- manual | agendado | ia_followup | ia_boasvindas | ia_data | campanha
  add column if not exists passo int,                                       -- passo da sequência de boas-vindas
  add column if not exists campanha_id uuid,
  add column if not exists corpo_texto text,                                -- texto editável (o HTML final é montado a partir dele)
  add column if not exists motivo_ia text,                                  -- por que a IA sugeriu este e-mail
  add column if not exists agendado_para timestamptz,
  add column if not exists aprovado_por uuid references public.membros(id) on delete set null,
  add column if not exists aprovado_em timestamptz,
  add column if not exists tentativas int not null default 0,
  add column if not exists ticket_hash text,
  add column if not exists ticket_expira timestamptz;
create index if not exists email_sends_fila_idx on public.email_sends(status, agendado_para);
create index if not exists email_sends_lead_origem_idx on public.email_sends(lead_id, origem);

-- 2) regras do agente
create table if not exists public.email_automacoes (
  tipo text primary key check (tipo in ('followup','boasvindas','data')),
  ativo boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  ultima_execucao timestamptz,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.membros(id) on delete set null
);
insert into public.email_automacoes (tipo, ativo, config) values
  ('followup',   false, '{"dias": 5, "etapas": ["novo","contato","qualificado","visita","proposta"], "hora": 10}'),
  ('boasvindas', false, '{"passos": [1, 4, 9], "hora": 10}'),
  ('data',       false, '{"hora": 9}')
on conflict (tipo) do nothing;
alter table public.email_automacoes enable row level security;
drop policy if exists "automacoes: equipe lê" on public.email_automacoes;
create policy "automacoes: equipe lê" on public.email_automacoes for select to authenticated using (privado.eh_equipe());
drop policy if exists "automacoes: admin edita" on public.email_automacoes;
create policy "automacoes: admin edita" on public.email_automacoes for update to authenticated using (privado.eh_admin()) with check (privado.eh_admin());

-- 3) campanhas
create table if not exists public.email_campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  filtro jsonb not null default '{}'::jsonb,
  modo text not null default 'modelo' check (modo in ('modelo','ia')),
  template_id uuid references public.email_templates(id) on delete set null,
  assunto text, corpo_texto text, instrucoes text,
  agendado_para timestamptz,
  total int not null default 0,
  criado_por uuid references public.membros(id) on delete set null,
  criado_em timestamptz not null default now()
);
alter table public.email_campanhas enable row level security;
drop policy if exists "campanhas: equipe lê" on public.email_campanhas;
create policy "campanhas: equipe lê" on public.email_campanhas for select to authenticated using (privado.eh_equipe());
revoke insert, update, delete on public.email_campanhas from authenticated, anon;
revoke insert, delete on public.email_automacoes from authenticated, anon;

-- 4) token interno (Vault) e tarefas programadas
do $$ declare t text := encode(extensions.gen_random_bytes(32), 'hex'); begin
  if not exists (select 1 from privado.tokens_internos where nome = 'email-agente') then
    insert into privado.tokens_internos (nome, hash) values ('email-agente', encode(extensions.digest(t, 'sha256'), 'hex'));
    perform vault.create_secret(t, 'email_agente_token', 'Token interno da função email-agente (tarefas programadas)');
  end if;
end $$;

create or replace function privado.disparar_email_agente(p_acao text)
returns bigint language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/email-agente',
    body := jsonb_build_object('acao', p_acao),
    headers := jsonb_build_object('content-type', 'application/json',
      'x-token-interno', (select decrypted_secret from vault.decrypted_secrets where name = 'email_agente_token')),
    timeout_milliseconds := 140000);
$$;
revoke all on function privado.disparar_email_agente(text) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('email-agente-planejar', 'email-agente-despachar');
select cron.schedule('email-agente-planejar', '5 * * * *', $$select privado.disparar_email_agente('planejar')$$);
select cron.schedule('email-agente-despachar', '*/5 * * * *', $$select privado.disparar_email_agente('despachar')$$);
