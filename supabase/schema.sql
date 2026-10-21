-- =====================================================================
-- danova AI · CRM — estrutura do banco (Supabase / Postgres)
-- Estado final aplicado no projeto "danova-crm" (oeylfwasqvbnybzrwtgf) em 21/10/2026.
-- Para recriar em outro projeto: cole este arquivo no SQL Editor do Supabase e execute.
-- =====================================================================

create type public.papel_membro as enum ('admin', 'corretor');
create type public.etapa_lead as enum ('novo','contato','qualificado','visita','proposta','contrato','fechado','perdido');

-- ---------- Membros (perfil ligado ao login) ----------
create table public.membros (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null,
  telefone text,
  licenca text,
  papel public.papel_membro not null default 'corretor',
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

-- E-mails que viram administradores automaticamente ao criar a conta
create table public.convites_admin (email text primary key);
insert into public.convites_admin(email) values ('danielle@danova-ai.com'), ('gestorhenrickoliveira@gmail.com');

-- ---------- Leads ----------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  nome text not null default '',
  email text,
  telefone text,
  perfil text,
  empreendimento text,
  objetivo text,
  mensagem text,
  pais text,
  idioma text,
  orcamento text,
  origem text,
  canal text,
  utm jsonb not null default '{}'::jsonb,
  etapa public.etapa_lead not null default 'novo',
  temperatura text check (temperatura in ('frio','morno','quente')),
  valor_estimado numeric(14,2),
  proximo_passo text,
  proximo_contato date,
  motivo_perda text,
  corretor_id uuid references public.membros(id) on delete set null,
  constraint lead_tem_contato check (coalesce(email,'') <> '' or coalesce(telefone,'') <> '')
);
create index leads_etapa_idx on public.leads(etapa);
create index leads_corretor_idx on public.leads(corretor_id);
create index leads_criado_idx on public.leads(criado_em desc);

-- ---------- Histórico ----------
create table public.lead_eventos (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  autor_id uuid references public.membros(id) on delete set null,
  tipo text not null check (tipo in ('criado','nota','etapa','atribuicao','contato')),
  texto text,
  de_etapa public.etapa_lead,
  para_etapa public.etapa_lead,
  criado_em timestamptz not null default now()
);
create index lead_eventos_lead_idx on public.lead_eventos(lead_id, criado_em desc);

-- ---------- Funções auxiliares (esquema privado, fora da API pública) ----------
create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

create or replace function privado.eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.id = auth.uid() and m.papel = 'admin' and m.ativo);
$$;
create or replace function privado.eh_membro_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.id = auth.uid() and m.ativo);
$$;
revoke all on function privado.eh_admin() from public, anon;
revoke all on function privado.eh_membro_ativo() from public, anon;
grant execute on function privado.eh_admin() to authenticated;
grant execute on function privado.eh_membro_ativo() to authenticated;

-- Novo login -> perfil (admin se convidado; corretor inativo até aprovação)
create or replace function public.criar_membro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean;
begin
  select exists(select 1 from public.convites_admin c where lower(c.email) = lower(new.email)) into v_admin;
  insert into public.membros(id, email, nome, telefone, papel, ativo)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          new.raw_user_meta_data->>'telefone',
          case when v_admin then 'admin'::public.papel_membro else 'corretor'::public.papel_membro end,
          v_admin);
  return new;
end $$;
create trigger ao_criar_usuario after insert on auth.users for each row execute function public.criar_membro();

-- Histórico automático de etapa e atribuição
create or replace function public.registrar_mudancas_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.atualizado_em := now();
  if new.etapa is distinct from old.etapa then
    insert into public.lead_eventos(lead_id, autor_id, tipo, de_etapa, para_etapa)
    values (new.id, auth.uid(), 'etapa', old.etapa, new.etapa);
  end if;
  if new.corretor_id is distinct from old.corretor_id then
    insert into public.lead_eventos(lead_id, autor_id, tipo, texto)
    values (new.id, auth.uid(), 'atribuicao',
      coalesce((select m.nome from public.membros m where m.id = new.corretor_id), 'Sem corretor'));
  end if;
  return new;
end $$;
create trigger ao_atualizar_lead before update on public.leads for each row execute function public.registrar_mudancas_lead();

-- Corretor não pode reatribuir leads nem alterar papel/status
create or replace function public.proteger_campos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n jsonb := to_jsonb(new); o jsonb := to_jsonb(old);
begin
  if auth.uid() is null or privado.eh_admin() then return new; end if;
  if tg_table_name = 'leads' then
    if (n->>'corretor_id') is distinct from (o->>'corretor_id') then
      raise exception 'Apenas administradores podem reatribuir leads';
    end if;
  elsif tg_table_name = 'membros' then
    if (n->>'papel') is distinct from (o->>'papel') or (n->>'ativo') is distinct from (o->>'ativo') or (n->>'email') is distinct from (o->>'email') then
      raise exception 'Apenas administradores podem alterar papel ou status';
    end if;
  end if;
  return new;
end $$;
create trigger proteger_leads before update on public.leads for each row execute function public.proteger_campos();
create trigger proteger_membros before update on public.membros for each row execute function public.proteger_campos();

-- ---------- Entrada pública de leads (formulários do site) ----------
create or replace function public.enviar_lead(dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := nullif(left(trim(dados->>'email'), 200), '');
  v_tel text := nullif(left(trim(dados->>'phone'), 60), '');
begin
  if coalesce(dados->>'website','') <> '' then return null; end if;          -- honeypot
  if v_email is null and v_tel is null then raise exception 'email_ou_telefone_obrigatorio'; end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
  select l.id into v_id from public.leads l
   where l.criado_em > now() - interval '3 minutes'
     and ((v_email is not null and lower(l.email) = lower(v_email)) or (v_tel is not null and l.telefone = v_tel))
   limit 1;
  if v_id is not null then return v_id; end if;                                -- evita duplicata
  if (select count(*) from public.leads where criado_em > now() - interval '1 minute') > 30 then
    raise exception 'limite_excedido';
  end if;
  insert into public.leads(nome, email, telefone, perfil, empreendimento, objetivo, mensagem, pais, idioma, orcamento, origem, canal, utm)
  values (
    left(coalesce(dados->>'name',''), 200), v_email, v_tel,
    left(dados->>'profile', 120), left(dados->>'project', 200), left(coalesce(dados->>'goal', dados->>'objective'), 200),
    left(coalesce(dados->>'notes', dados->>'message'), 4000), left(dados->>'country', 80), left(dados->>'language', 10),
    left(dados->>'budget', 120), left(coalesce(dados->>'lead_page', dados->>'page', dados->>'source'), 120),
    left(coalesce(nullif(dados->>'first_touch_source',''), nullif(dados->>'last_touch_source',''), 'direto'), 120),
    jsonb_strip_nulls(jsonb_build_object(
      'first_touch_source', dados->>'first_touch_source', 'first_touch_medium', dados->>'first_touch_medium', 'first_touch_campaign', dados->>'first_touch_campaign',
      'last_touch_source', dados->>'last_touch_source', 'last_touch_medium', dados->>'last_touch_medium', 'last_touch_campaign', dados->>'last_touch_campaign',
      'gclid', dados->>'gclid', 'fbclid', dados->>'fbclid', 'landing_page', dados->>'landing_page', 'referrer', dados->>'referrer'))
  ) returning id into v_id;
  insert into public.lead_eventos(lead_id, tipo, texto, para_etapa) values (v_id, 'criado', 'Lead recebido pelo site', 'novo');
  return v_id;
end $$;

revoke all on function public.enviar_lead(jsonb) from public;
grant execute on function public.enviar_lead(jsonb) to anon, authenticated;
revoke all on function public.criar_membro() from public, anon, authenticated;
revoke all on function public.registrar_mudancas_lead() from public, anon, authenticated;
revoke all on function public.proteger_campos() from public, anon, authenticated;

-- ---------- Regras de acesso (RLS) ----------
alter table public.membros enable row level security;
alter table public.leads enable row level security;
alter table public.lead_eventos enable row level security;
alter table public.convites_admin enable row level security;

create policy membros_ver on public.membros for select to authenticated
  using (id = (select auth.uid()) or (select privado.eh_admin()) or ((select privado.eh_membro_ativo()) and ativo));
create policy membros_editar_proprio on public.membros for update to authenticated
  using (id = (select auth.uid()) or (select privado.eh_admin()))
  with check (id = (select auth.uid()) or (select privado.eh_admin()));
create policy membros_admin_apagar on public.membros for delete to authenticated using ((select privado.eh_admin()));

create policy leads_ver on public.leads for select to authenticated
  using ((select privado.eh_admin()) or ((select privado.eh_membro_ativo()) and corretor_id = (select auth.uid())));
create policy leads_editar on public.leads for update to authenticated
  using ((select privado.eh_admin()) or ((select privado.eh_membro_ativo()) and corretor_id = (select auth.uid())))
  with check ((select privado.eh_admin()) or corretor_id = (select auth.uid()));
create policy leads_criar on public.leads for insert to authenticated
  with check ((select privado.eh_admin()) or ((select privado.eh_membro_ativo()) and corretor_id = (select auth.uid())));
create policy leads_apagar on public.leads for delete to authenticated using ((select privado.eh_admin()));

create policy eventos_ver on public.lead_eventos for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy eventos_criar on public.lead_eventos for insert to authenticated
  with check (autor_id = (select auth.uid()) and tipo in ('nota','contato') and exists (select 1 from public.leads l where l.id = lead_id));

create policy convites_admin_ver on public.convites_admin for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

-- Visão usada pelo painel (respeita as regras de quem consulta)
create view public.leads_resumo with (security_invoker = true) as
  select l.*, m.nome as corretor_nome
  from public.leads l left join public.membros m on m.id = l.corretor_id;

-- Avisos em tempo real de novos leads no CRM
alter publication supabase_realtime add table public.leads;

-- =====================================================================
-- Agente de IA (21/10/2026): conversas do chat do site e análises do agente
-- =====================================================================
create table public.conversas (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  token_hash text not null,               -- sha256 do token do visitante (o token em si nunca é guardado)
  ip_hash text,
  idioma text,
  pagina text,
  status text not null default 'ia' check (status in ('ia','humano','encerrada')),
  lead_id uuid references public.leads(id) on delete set null,
  resumo text,
  total_mensagens int not null default 0
);
create index conversas_lead_idx on public.conversas(lead_id);
create index conversas_criado_idx on public.conversas(criado_em desc);
create index conversas_ip_idx on public.conversas(ip_hash, criado_em desc);

create table public.mensagens (
  id bigint generated always as identity primary key,
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  papel text not null check (papel in ('cliente','agente','sistema')),
  texto text not null,
  criado_em timestamptz not null default now()
);
create index mensagens_conversa_idx on public.mensagens(conversa_id, id);
create index mensagens_criado_idx on public.mensagens(criado_em desc);

create table public.agente_analises (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  origem text not null check (origem in ('atendente','crm')),
  pedido_por uuid references public.membros(id) on delete set null,
  resumo text,
  proximo_passo text,
  proximo_contato date,
  temperatura text check (temperatura in ('frio','morno','quente')),
  mensagem_sugerida text,
  pontos_atencao text,
  dados jsonb not null default '{}'::jsonb,
  aplicada boolean not null default false,
  criado_em timestamptz not null default now()
);
create index agente_analises_lead_idx on public.agente_analises(lead_id, criado_em desc);

alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;
alter table public.agente_analises enable row level security;

-- visitantes não leem nada direto: só as funções do servidor (service role) gravam
create policy conversas_ver on public.conversas for select to authenticated
  using ((select privado.eh_admin()) or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id)));
create policy mensagens_ver on public.mensagens for select to authenticated
  using (exists (select 1 from public.conversas c where c.id = conversa_id));
create policy analises_ver on public.agente_analises for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy analises_marcar on public.agente_analises for update to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id))
  with check (exists (select 1 from public.leads l where l.id = lead_id));

create or replace view public.leads_resumo with (security_invoker = true) as
  select l.*, m.nome as corretor_nome,
         (select c.id from public.conversas c where c.lead_id = l.id order by c.criado_em desc limit 1) as conversa_id,
         (select a.resumo from public.agente_analises a where a.lead_id = l.id order by a.criado_em desc limit 1) as ia_resumo
  from public.leads l left join public.membros m on m.id = l.corretor_id;
