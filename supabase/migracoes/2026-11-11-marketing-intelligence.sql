-- DANOVA Marketing Intelligence — integração própria com a Meta Marketing API (multi-cliente).
-- Clientes = public.contas (visão danova_clients); papéis = public.membros (visão danova_user_roles).
-- Tokens ficam CIFRADOS (AES-256-GCM, chave só nas Secrets: META_TOKEN_ENCRYPTION_KEY) e só o servidor lê.
-- Leitura: admin vê tudo; cliente (papel construtora) só o que tem conta_id = a conta dele. Escrita: só Edge Functions.

-- ---------- visões de nomes do projeto ----------
create or replace view public.danova_clients with (security_invoker = true) as
  select id, nome, tipo, documento, email_cobranca as email, telefone, ativo, criado_em from public.contas;
create or replace view public.danova_user_roles with (security_invoker = true) as
  select id as user_id, nome, email, papel::text as papel, conta_id as client_id, ativo from public.membros;

-- state OAuth guarda o cliente de destino
alter table public.oauth_estados add column if not exists dados jsonb not null default '{}'::jsonb;

-- ---------- conexões (um Facebook autorizado) ----------
create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.contas(id) on delete cascade,           -- cliente dono (null = agência DANOVA)
  membro_id uuid not null references public.membros(id) on delete cascade, -- quem autorizou
  meta_user_id text not null,
  meta_user_name text,
  token_cifrado text not null,                                            -- base64(iv|ciphertext|tag)
  escopos text[] not null default '{}',
  expira_em timestamptz,
  status text not null default 'ativa' check (status in ('ativa','expirando','reautorizar','erro','desconectada')),
  ultimo_erro text,
  verificada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (membro_id, meta_user_id)
);

-- ---------- contas de anúncios vinculadas ----------
create table if not exists public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.contas(id) on delete cascade,
  connection_id uuid references public.meta_connections(id) on delete set null,
  act_id text not null unique check (act_id ~ '^[0-9]{5,20}$'),
  nome text not null,
  moeda text, fuso text, empresa text,
  status_meta text,
  ativo boolean not null default true,
  primeira_sync_feita boolean not null default false,
  ultima_sync timestamptz, ultima_sync_campanhas timestamptz, ultima_consolidacao date,
  ultimo_erro text,
  sync_lock timestamptz,                                                  -- evita sincronizações simultâneas da mesma conta
  criado_em timestamptz not null default now()
);
create index if not exists meta_ad_accounts_conta_idx on public.meta_ad_accounts(conta_id);

create table if not exists public.meta_campaigns (
  id text primary key,                                                    -- id da campanha na Meta
  ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,
  conta_id uuid references public.contas(id) on delete cascade,
  nome text, status text, effective_status text, objetivo text,
  orcamento_diario numeric, orcamento_total numeric, inicio timestamptz, fim timestamptz,
  atualizado_meta timestamptz, sincronizado_em timestamptz not null default now()
);
create index if not exists meta_campaigns_conta_idx on public.meta_campaigns(ad_account_id, effective_status);

create table if not exists public.meta_adsets (
  id text primary key,
  ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,
  conta_id uuid references public.contas(id) on delete cascade,
  campaign_id text, nome text, status text, effective_status text,
  orcamento_diario numeric, orcamento_total numeric, otimizacao text,
  atualizado_meta timestamptz, sincronizado_em timestamptz not null default now()
);
create index if not exists meta_adsets_camp_idx on public.meta_adsets(campaign_id);

create table if not exists public.meta_ads (
  id text primary key,
  ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,
  conta_id uuid references public.contas(id) on delete cascade,
  campaign_id text, adset_id text, nome text, status text, effective_status text,
  atualizado_meta timestamptz, sincronizado_em timestamptz not null default now()
);
create index if not exists meta_ads_adset_idx on public.meta_ads(adset_id);

-- ---------- métricas diárias nos três níveis ----------
create table if not exists public.meta_insights_daily (
  id bigint generated always as identity primary key,
  ad_account_id uuid not null references public.meta_ad_accounts(id) on delete cascade,
  conta_id uuid references public.contas(id) on delete cascade,
  nivel text not null check (nivel in ('campaign','adset','ad')),
  objeto_id text not null, data date not null,
  campaign_id text, adset_id text, ad_id text, nome text, moeda text,
  impressoes bigint not null default 0, alcance bigint, frequencia numeric,
  cliques bigint not null default 0, cliques_link bigint not null default 0,
  custo numeric(14,2) not null default 0, cpc numeric, cpm numeric, ctr numeric,
  leads numeric not null default 0, conversoes numeric not null default 0,
  resultados numeric not null default 0, custo_resultado numeric, valor_conversoes numeric not null default 0,
  acoes jsonb not null default '[]'::jsonb,                               -- actions brutas (atribuição da conta)
  atualizado_em timestamptz not null default now(),
  unique (nivel, objeto_id, data)
);
create index if not exists meta_insights_daily_idx on public.meta_insights_daily(ad_account_id, nivel, data);
create index if not exists meta_insights_daily_conta_idx on public.meta_insights_daily(conta_id, data);

-- ---------- logs ----------
create table if not exists public.meta_sync_logs (
  id bigint generated always as identity primary key,
  ad_account_id uuid references public.meta_ad_accounts(id) on delete cascade,
  connection_id uuid references public.meta_connections(id) on delete cascade,
  tipo text not null, status text not null default 'ok', linhas int not null default 0,
  detalhe text, inicio timestamptz not null default now(), fim timestamptz
);
create index if not exists meta_sync_logs_idx on public.meta_sync_logs(ad_account_id, inicio desc);

create table if not exists public.meta_audit_logs (
  id bigint generated always as identity primary key,
  membro_id uuid references public.membros(id) on delete set null,
  membro_nome text,
  conta_id uuid references public.contas(id) on delete set null,
  ad_account_id uuid references public.meta_ad_accounts(id) on delete set null,
  objeto_tipo text, objeto_id text, objeto_nome text, acao text not null,
  antes jsonb, depois jsonb, sucesso boolean not null default false, erro text,
  criado_em timestamptz not null default now()
);
create index if not exists meta_audit_logs_idx on public.meta_audit_logs(criado_em desc);

-- ---------- RLS ----------
do $$ declare t text; begin
  foreach t in array array['meta_connections','meta_ad_accounts','meta_campaigns','meta_adsets','meta_ads','meta_insights_daily','meta_sync_logs','meta_audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('drop policy if exists "mi: leitura" on public.%I', t);
  end loop;
end $$;
-- conexões: nunca expor o token; o cliente vê metadados da própria conexão por esta visão
revoke select on public.meta_connections from anon, authenticated;
create policy "mi: leitura" on public.meta_connections for select to authenticated using (false);
create or replace view public.meta_connections_publico with (security_invoker = false) as
  select c.id, c.conta_id, c.membro_id, c.meta_user_name, c.escopos, c.expira_em, c.status, c.ultimo_erro, c.verificada_em, c.criado_em
    from public.meta_connections c
   where privado.eh_admin() or (c.conta_id is not null and c.conta_id = privado.minha_conta()) or c.membro_id = auth.uid();
revoke all on public.meta_connections_publico from anon;
grant select on public.meta_connections_publico to authenticated;

create policy "mi: leitura" on public.meta_ad_accounts for select to authenticated using (privado.eh_admin() or (conta_id is not null and conta_id = privado.minha_conta()));
create policy "mi: leitura" on public.meta_campaigns for select to authenticated using (privado.eh_admin() or (conta_id is not null and conta_id = privado.minha_conta()));
create policy "mi: leitura" on public.meta_adsets for select to authenticated using (privado.eh_admin() or (conta_id is not null and conta_id = privado.minha_conta()));
create policy "mi: leitura" on public.meta_ads for select to authenticated using (privado.eh_admin() or (conta_id is not null and conta_id = privado.minha_conta()));
create policy "mi: leitura" on public.meta_insights_daily for select to authenticated using (privado.eh_admin() or (conta_id is not null and conta_id = privado.minha_conta()));
create policy "mi: leitura" on public.meta_sync_logs for select to authenticated using (privado.eh_admin());
create policy "mi: leitura" on public.meta_audit_logs for select to authenticated using (privado.eh_admin());

-- conta_id dos filhos sempre igual ao da conta de anúncios (não depende do código)
create or replace function privado.mi_herdar_conta() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  select a.conta_id into new.conta_id from public.meta_ad_accounts a where a.id = new.ad_account_id;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['meta_campaigns','meta_adsets','meta_ads','meta_insights_daily'] loop
    execute format('drop trigger if exists mi_herdar_conta on public.%I', t);
    execute format('create trigger mi_herdar_conta before insert or update on public.%I for each row execute function privado.mi_herdar_conta()', t);
  end loop;
end $$;
-- se a conta de anúncios mudar de cliente, propaga para o histórico
create or replace function privado.mi_propagar_conta() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.conta_id is distinct from old.conta_id then
    update public.meta_campaigns set conta_id = new.conta_id where ad_account_id = new.id;
    update public.meta_adsets set conta_id = new.conta_id where ad_account_id = new.id;
    update public.meta_ads set conta_id = new.conta_id where ad_account_id = new.id;
    update public.meta_insights_daily set conta_id = new.conta_id where ad_account_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists mi_propagar_conta on public.meta_ad_accounts;
create trigger mi_propagar_conta after update of conta_id on public.meta_ad_accounts for each row execute function privado.mi_propagar_conta();

-- ---------- dashboard (calculado no banco, respeitando a RLS de quem pergunta) ----------
create or replace function public.mi_dashboard(p_desde date, p_ate date, p_conta uuid default null, p_ad_account uuid default null, p_campanha text default null, p_status text default null)
returns jsonb language sql stable security invoker set search_path to '' as $$
  with camp as (
    select c.id, c.nome, c.effective_status, c.ad_account_id, c.conta_id, c.orcamento_diario
      from public.meta_campaigns c
     where (p_conta is null or c.conta_id = p_conta) and (p_ad_account is null or c.ad_account_id = p_ad_account)
       and (p_campanha is null or c.id = p_campanha) and (p_status is null or c.effective_status = p_status)
  ), ins as (
    select i.* from public.meta_insights_daily i
     where i.nivel = 'campaign' and i.data between p_desde and p_ate
       and (p_conta is null or i.conta_id = p_conta) and (p_ad_account is null or i.ad_account_id = p_ad_account)
       and (p_campanha is null or i.objeto_id = p_campanha)
       and (p_status is null or i.objeto_id in (select id from camp))
  ), tot as (
    select coalesce(sum(custo),0) custo, coalesce(sum(impressoes),0) imp, coalesce(sum(cliques),0) cli, coalesce(sum(cliques_link),0) cli_link,
           coalesce(sum(leads),0) leads, coalesce(sum(conversoes),0) conv, coalesce(sum(resultados),0) res, coalesce(sum(valor_conversoes),0) valor
      from ins
  )
  select jsonb_build_object(
    'totais', (select jsonb_build_object('investimento', custo, 'impressoes', imp, 'cliques', cli, 'cliques_link', cli_link, 'leads', leads, 'conversoes', conv, 'resultados', res, 'valor_conversoes', valor,
               'cpc', case when cli > 0 then round(custo / cli, 2) end, 'cpm', case when imp > 0 then round(custo * 1000 / imp, 2) end,
               'ctr', case when imp > 0 then round(cli * 100.0 / imp, 2) end, 'custo_lead', case when leads > 0 then round(custo / leads, 2) end) from tot),
    'clientes_conectados', (select count(distinct a.conta_id) from public.meta_ad_accounts a where a.ativo and a.conta_id is not null and a.ultima_sync is not null),
    'contas_conectadas', (select count(*) from public.meta_ad_accounts a where a.ativo and (p_conta is null or a.conta_id = p_conta)),
    'campanhas_ativas', (select count(*) from camp where effective_status = 'ACTIVE'),
    'moedas', (select coalesce(jsonb_agg(distinct moeda), '[]'::jsonb) from ins where moeda is not null),
    'diario', (select coalesce(jsonb_agg(d order by d.data), '[]'::jsonb) from (select data, sum(custo) custo, sum(impressoes) impressoes, sum(cliques) cliques, sum(leads) leads from ins group by data) d),
    'campanhas', (select coalesce(jsonb_agg(r order by r.custo desc), '[]'::jsonb) from (
        select i.objeto_id id, max(i.nome) nome, max(c.effective_status) status, i.ad_account_id, max(c.orcamento_diario) orcamento_diario,
               sum(i.custo) custo, sum(i.impressoes) impressoes, sum(i.cliques) cliques, sum(i.leads) leads, sum(i.resultados) resultados,
               case when sum(i.cliques) > 0 then round(sum(i.custo) / sum(i.cliques), 2) end cpc,
               case when sum(i.impressoes) > 0 then round(sum(i.cliques) * 100.0 / sum(i.impressoes), 2) end ctr,
               case when sum(i.leads) > 0 then round(sum(i.custo) / sum(i.leads), 2) end custo_lead
          from ins i left join camp c on c.id = i.objeto_id group by i.objeto_id, i.ad_account_id limit 200) r),
    'clientes', (select coalesce(jsonb_agg(r order by r.custo desc), '[]'::jsonb) from (
        select i.conta_id, (select k.nome from public.contas k where k.id = i.conta_id) nome, sum(i.custo) custo, sum(i.leads) leads, sum(i.cliques) cliques, sum(i.impressoes) impressoes,
               case when sum(i.leads) > 0 then round(sum(i.custo) / sum(i.leads), 2) end custo_lead
          from ins i group by i.conta_id) r)
  );
$$;
revoke all on function public.mi_dashboard(date, date, uuid, uuid, text, text) from public, anon;
grant execute on function public.mi_dashboard(date, date, uuid, uuid, text, text) to authenticated;

-- ---------- tarefas programadas ----------
do $$ declare t text := encode(extensions.gen_random_bytes(32), 'hex'); begin
  if not exists (select 1 from privado.tokens_internos where nome = 'meta-mi') then
    insert into privado.tokens_internos (nome, hash) values ('meta-mi', encode(extensions.digest(t, 'sha256'), 'hex'));
    perform vault.create_secret(t, 'meta_mi_token', 'Token interno da DANOVA Marketing Intelligence (tarefas programadas)');
  end if;
end $$;
create or replace function privado.disparar_meta_mi(p_acao text) returns bigint language sql security definer set search_path to '' as $$
  select net.http_post(
    url := 'https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/meta-mi',
    body := jsonb_build_object('acao', p_acao),
    headers := jsonb_build_object('content-type', 'application/json',
      'x-token-interno', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_mi_token')),
    timeout_milliseconds := 150000);
$$;
revoke all on function privado.disparar_meta_mi(text) from public, anon, authenticated;
select cron.unschedule(jobname) from cron.job where jobname in ('meta-mi-sync', 'meta-mi-tokens');
select cron.schedule('meta-mi-sync', '*/30 * * * *', $$select privado.disparar_meta_mi('sync_all')$$);
select cron.schedule('meta-mi-tokens', '15 8 * * *', $$select privado.disparar_meta_mi('token_refresh')$$);
