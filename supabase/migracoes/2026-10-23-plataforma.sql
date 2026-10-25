-- =====================================================================
-- danova AI · Plataforma (23/10/2026)
-- Inventário, distribuição automática, visitas, vendas e comissões, cobrança
-- (R$ 199,99/mês + 1% no fechamento), investimento em mídia, documentos,
-- fila de conversões para o Meta e portal da construtora.
-- =====================================================================

-- ---------- Contas (construtoras e imobiliárias clientes) ----------
create table public.contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'construtora' check (tipo in ('construtora','imobiliaria')),
  documento text,
  email_cobranca text,
  telefone text,
  mensalidade numeric(12,2) not null default 199.99,
  moeda_mensalidade text not null default 'BRL' check (moeda_mensalidade in ('BRL','USD')),
  taxa_fechamento numeric(6,4) not null default 0.01 check (taxa_fechamento between 0 and 1),
  dia_vencimento int not null default 10 check (dia_vencimento between 1 and 28),
  inicio date not null default current_date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------- Membros: vínculo com conta e preferências de distribuição ----------
alter table public.membros
  add column conta_id uuid references public.contas(id) on delete set null,
  add column idiomas text[] not null default '{pt}',
  add column regioes text[] not null default '{}',
  add column especialidades text[] not null default '{}',   -- slugs de empreendimentos
  add column capacidade int not null default 50 check (capacidade >= 0),
  add column recebe_leads boolean not null default true,
  add column ultimo_lead_em timestamptz;

-- ---------- Inventário ----------
create table public.empreendimentos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  regiao text,                 -- brickell | beach | broward | palm
  cidade text,
  endereco text,
  conta_id uuid references public.contas(id) on delete set null,
  preco_a_partir numeric(14,2),
  entrega text,
  status text not null default 'lancamento' check (status in ('pre_lancamento','lancamento','em_obra','pronto','esgotado')),
  ativo boolean not null default true,
  apelidos text[] not null default '{}',   -- termos que identificam o projeto no texto do lead
  criado_em timestamptz not null default now()
);
insert into public.empreendimentos (slug, nome, regiao, cidade, endereco, preco_a_partir, entrega, status) values
  ('domus-brickell-park', 'Domus Brickell Park', 'brickell', 'Miami', '1611 SW 2nd Ave', 650000, 'Final de 2026', 'em_obra'),
  ('melia-brickell', 'Meliá Brickell', 'brickell', 'Miami', '1120 SW 3rd Ave', 500000, '2027', 'em_obra'),
  ('the-residences-at-1428-brickell', 'The Residences at 1428 Brickell', 'brickell', 'Miami', '1428 Brickell Ave', 2900000, null, 'lancamento'),
  ('casa-bella-residences-by-b-b-italia', 'Casa Bella Residences by B&B Italia', 'brickell', 'Miami', '1400 Biscayne Blvd', 1500000, '2027', 'em_obra'),
  ('nobu-residences-brickell', 'Nobu Residences Brickell', 'brickell', 'Miami', '619 Brickell', 2100000, null, 'lancamento'),
  ('faena-residences-miami', 'Faena Residences Miami', 'brickell', 'Miami', 'Miami River', 1300000, null, 'pre_lancamento'),
  ('continuum-club-residences', 'Continuum Club & Residences', 'beach', 'North Bay Village', '1755 79th Street Causeway', 1400000, '2º tri 2028', 'em_obra'),
  ('the-residences-at-mandarin-oriental-miami', 'The Residences at Mandarin Oriental, Miami', 'brickell', 'Miami', 'One Island Drive, Brickell Key', 3900000, '2030', 'em_obra'),
  ('mandarin-oriental-residences-west-palm-beach', 'Mandarin Oriental Residences West Palm Beach', 'palm', 'West Palm Beach', null, null, null, 'lancamento'),
  ('estates-by-turnberry', 'Estates by Turnberry', 'broward', 'Davie', 'leste de Weston', 1700000, null, 'em_obra');
update public.empreendimentos set apelidos = case slug
  when 'domus-brickell-park' then '{domus}'::text[]
  when 'melia-brickell' then '{meliá,melia}'::text[]
  when 'the-residences-at-1428-brickell' then '{1428}'::text[]
  when 'casa-bella-residences-by-b-b-italia' then '{casa bella,casabella}'::text[]
  when 'nobu-residences-brickell' then '{nobu}'::text[]
  when 'faena-residences-miami' then '{faena}'::text[]
  when 'continuum-club-residences' then '{continuum}'::text[]
  when 'the-residences-at-mandarin-oriental-miami' then '{mandarin oriental, miami,mandarin oriental miami,brickell key,mandarin miami}'::text[]
  when 'mandarin-oriental-residences-west-palm-beach' then '{west palm}'::text[]
  when 'estates-by-turnberry' then '{turnberry}'::text[] end;

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  codigo text not null,
  tipologia text,
  quartos int,
  area_pes2 numeric(10,2),
  andar int,
  vista text,
  preco numeric(14,2),
  status text not null default 'disponivel' check (status in ('disponivel','reservada','vendida','bloqueada')),
  lead_id uuid references public.leads(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  unique (empreendimento_id, codigo)
);
create index unidades_emp_idx on public.unidades(empreendimento_id, status);

-- ---------- Leads: vínculo com inventário e campanha ----------
alter table public.leads
  add column empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  add column unidade_id uuid references public.unidades(id) on delete set null,
  add column campanha text,
  add column meta_lead_id text unique;
create index leads_emp_idx on public.leads(empreendimento_id);

-- ---------- Visitas ----------
create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  corretor_id uuid references public.membros(id) on delete set null,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  inicio timestamptz not null,
  duracao_min int not null default 60,
  local text,
  formato text not null default 'presencial' check (formato in ('presencial','video')),
  status text not null default 'agendada' check (status in ('agendada','confirmada','realizada','cancelada','nao_compareceu')),
  notas text,
  criado_por uuid references public.membros(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index visitas_inicio_idx on public.visitas(inicio);
create index visitas_lead_idx on public.visitas(lead_id);

-- ---------- Vendas: propostas, contratos, fechamentos e comissões ----------
create table public.vendas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  unidade_id uuid references public.unidades(id) on delete set null,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  conta_id uuid references public.contas(id) on delete set null,
  corretor_id uuid references public.membros(id) on delete set null,
  status text not null default 'proposta' check (status in ('proposta','contrato','fechada','cancelada')),
  valor numeric(14,2) not null check (valor >= 0),
  moeda text not null default 'USD' check (moeda in ('USD','BRL')),
  data_proposta date not null default current_date,
  data_fechamento date,
  comissao_corretor_pct numeric(6,4) not null default 0 check (comissao_corretor_pct between 0 and 1),
  comissao_corretor_valor numeric(14,2) generated always as (round(valor * comissao_corretor_pct, 2)) stored,
  taxa_danova_pct numeric(6,4) not null default 0.01 check (taxa_danova_pct between 0 and 1),
  taxa_danova_valor numeric(14,2) generated always as (round(valor * taxa_danova_pct, 2)) stored,
  canal text,          -- atribuição copiada do lead no momento da proposta
  campanha text,
  corretor_pago boolean not null default false,
  notas text,
  criado_por uuid references public.membros(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index vendas_status_idx on public.vendas(status, data_fechamento);

-- ---------- Cobrança ----------
create table public.faturas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas(id) on delete cascade,
  tipo text not null check (tipo in ('mensalidade','fechamento')),
  competencia date not null,
  venda_id uuid references public.vendas(id) on delete set null,
  descricao text,
  valor numeric(14,2) not null,
  moeda text not null default 'BRL' check (moeda in ('BRL','USD')),
  vencimento date,
  status text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  pago_em date,
  criado_em timestamptz not null default now()
);
create unique index faturas_mensalidade_unica on public.faturas(conta_id, competencia) where tipo = 'mensalidade';
create unique index faturas_fechamento_unica on public.faturas(venda_id) where tipo = 'fechamento';

-- ---------- Investimento em mídia (para custo por lead e ROI) ----------
create table public.investimentos (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  canal text not null check (canal in ('meta','google','seo','outro')),
  campanha text,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  valor numeric(14,2) not null check (valor >= 0),
  moeda text not null default 'BRL' check (moeda in ('BRL','USD')),
  criado_por uuid references public.membros(id) on delete set null,
  criado_em timestamptz not null default now()
);

-- ---------- Documentos (arquivos no Storage, bucket privado "documentos") ----------
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  venda_id uuid references public.vendas(id) on delete set null,
  nome text not null,
  caminho text not null unique,          -- <lead_id>/<arquivo>
  tipo text not null default 'outro' check (tipo in ('proposta','contrato','identificacao','comprovante','outro')),
  tamanho int,
  enviado_por uuid references public.membros(id) on delete set null,
  criado_em timestamptz not null default now()
);
insert into storage.buckets (id, name, public, file_size_limit) values ('documentos', 'documentos', false, 20971520)
  on conflict (id) do nothing;

-- ---------- Distribuição automática ----------
create table public.distribuicao_config (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
insert into public.distribuicao_config(id) values (1);

-- ---------- Fila de conversões para o Meta (API de Conversões) ----------
create table public.conversoes (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  evento text not null,
  valor numeric(14,2),
  moeda text,
  status text not null default 'pendente' check (status in ('pendente','enviado','erro','ignorado')),
  tentativas int not null default 0,
  erro text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
create index conversoes_pend_idx on public.conversoes(status, criado_em);

-- =====================================================================
-- Funções auxiliares
-- =====================================================================
create or replace function privado.minha_conta() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.conta_id from public.membros m where m.id = auth.uid() and m.ativo and m.papel = 'construtora';
$$;
create or replace function privado.eh_equipe() returns boolean      -- admin ou corretor ativo
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.id = auth.uid() and m.ativo and m.papel in ('admin','corretor'));
$$;
revoke all on function privado.minha_conta() from public, anon;
revoke all on function privado.eh_equipe() from public, anon;
grant execute on function privado.minha_conta() to authenticated;
grant execute on function privado.eh_equipe() to authenticated;

-- Construtora não deve ver leads nem ser tratada como corretor: ajusta a regra de "membro ativo"
create or replace function privado.eh_membro_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.id = auth.uid() and m.ativo and m.papel in ('admin','corretor'));
$$;

-- Lead: liga o texto do empreendimento ao cadastro do inventário e guarda a campanha
create or replace function public.lead_resolver_empreendimento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.empreendimento_id is null and coalesce(new.empreendimento, '') <> '' then
    select e.id into new.empreendimento_id
      from public.empreendimentos e
      left join lateral unnest(e.apelidos) a(termo) on lower(new.empreendimento) like '%' || a.termo || '%'
     where lower(e.nome) = lower(new.empreendimento) or a.termo is not null
     order by (lower(e.nome) = lower(new.empreendimento)) desc, length(coalesce(a.termo, '')) desc
     limit 1;
  end if;
  if new.campanha is null then
    new.campanha := nullif(coalesce(new.utm->>'last_touch_campaign', new.utm->>'first_touch_campaign'), '');
  end if;
  return new;
end $$;
create trigger a_lead_resolver_empreendimento before insert or update of empreendimento, empreendimento_id on public.leads
  for each row execute function public.lead_resolver_empreendimento();

-- Distribuição: escolhe o corretor mais adequado e com menos leads abertos
create or replace function public.escolher_corretor(p_idioma text, p_emp uuid, p_regiao text) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id
  from public.membros m
  left join lateral (
    select count(*) as abertos from public.leads l
    where l.corretor_id = m.id and l.etapa in ('novo','contato','qualificado','visita','proposta','contrato')
  ) c on true
  where m.ativo and m.papel = 'corretor' and m.recebe_leads and c.abertos < m.capacidade
  order by
    (case when p_emp is not null and (select e.slug from public.empreendimentos e where e.id = p_emp) = any(m.especialidades) then 3 else 0 end
     + case when p_idioma is not null and p_idioma = any(m.idiomas) then 2 else 0 end
     + case when p_regiao is not null and p_regiao = any(m.regioes) then 1 else 0 end) desc,
    c.abertos asc,
    m.ultimo_lead_em asc nulls first
  limit 1;
$$;
revoke all on function public.escolher_corretor(text, uuid, text) from public, anon, authenticated;

create or replace function public.lead_distribuir() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if new.corretor_id is null and (select ativo from public.distribuicao_config where id = 1) then
    v := public.escolher_corretor(new.idioma, new.empreendimento_id,
           (select e.regiao from public.empreendimentos e where e.id = new.empreendimento_id));
    if v is not null then
      new.corretor_id := v;
      update public.membros set ultimo_lead_em = now() where id = v;
    end if;
  end if;
  return new;
end $$;
create trigger b_lead_distribuir before insert on public.leads for each row execute function public.lead_distribuir();

create or replace function public.lead_registrar_atribuicao_inicial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.corretor_id is not null then
    insert into public.lead_eventos(lead_id, tipo, texto)
    values (new.id, 'atribuicao', coalesce((select m.nome from public.membros m where m.id = new.corretor_id), 'Corretor') || ' (distribuição automática)');
  end if;
  return new;
end $$;
create trigger c_lead_atribuicao_inicial after insert on public.leads for each row execute function public.lead_registrar_atribuicao_inicial();

-- Admin: distribui leads abertos sem corretor
create or replace function public.distribuir_pendentes() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v uuid; n int := 0;
begin
  if not privado.eh_admin() then raise exception 'Apenas administradores'; end if;
  for r in select l.id, l.idioma, l.empreendimento_id, e.regiao from public.leads l
           left join public.empreendimentos e on e.id = l.empreendimento_id
           where l.corretor_id is null and l.etapa in ('novo','contato','qualificado','visita','proposta','contrato')
           order by l.criado_em loop
    v := public.escolher_corretor(r.idioma, r.empreendimento_id, r.regiao);
    exit when v is null;
    update public.leads set corretor_id = v where id = r.id;
    update public.membros set ultimo_lead_em = now() where id = v;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.distribuir_pendentes() from public, anon;
grant execute on function public.distribuir_pendentes() to authenticated;

-- Conversões para o Meta a cada mudança de etapa relevante
create or replace function public.lead_enfileirar_conversao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.etapa is distinct from old.etapa and new.etapa in ('qualificado','visita','proposta','contrato','fechado') then
    insert into public.conversoes(lead_id, evento, valor, moeda)
    values (new.id, new.etapa::text, case when new.etapa = 'fechado' then new.valor_estimado end, case when new.etapa = 'fechado' then 'USD' end);
  end if;
  return new;
end $$;
create trigger d_lead_conversao after update of etapa on public.leads for each row execute function public.lead_enfileirar_conversao();

-- Visitas: agenda move o lead para a etapa "visita"
create or replace function public.visita_apos_inserir() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.leads set etapa = 'visita'
   where id = new.lead_id and etapa in ('novo','contato','qualificado');
  insert into public.lead_eventos(lead_id, autor_id, tipo, texto)
  values (new.lead_id, auth.uid(), 'nota', 'Visita agendada para ' || to_char(new.inicio at time zone 'America/New_York', 'DD/MM/YYYY HH24:MI') || ' (horário de Miami)');
  return new;
end $$;
create trigger visita_inserida after insert on public.visitas for each row execute function public.visita_apos_inserir();

-- Vendas: preenche conta, taxa, corretor e atribuição
create or replace function public.venda_preencher() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  -- quem não é admin não altera taxa, conta, corretor responsável nem o pagamento da comissão
  if not coalesce(privado.eh_admin(), false) and auth.uid() is not null then
    if tg_op = 'UPDATE' then
      new.taxa_danova_pct := old.taxa_danova_pct; new.conta_id := old.conta_id;
      new.corretor_id := old.corretor_id; new.corretor_pago := old.corretor_pago;
    else
      new.corretor_pago := false; new.conta_id := null; new.corretor_id := null;
    end if;
  end if;
  if new.unidade_id is not null and new.empreendimento_id is null then
    select u.empreendimento_id into new.empreendimento_id from public.unidades u where u.id = new.unidade_id;
  end if;
  if new.lead_id is not null then
    select * into l from public.leads where id = new.lead_id;
    new.empreendimento_id := coalesce(new.empreendimento_id, l.empreendimento_id);
    new.corretor_id := coalesce(new.corretor_id, l.corretor_id);
    if tg_op = 'INSERT' then
      new.canal := coalesce(new.canal, l.canal);
      new.campanha := coalesce(new.campanha, l.campanha);
    end if;
  end if;
  if new.conta_id is null and new.empreendimento_id is not null then
    select e.conta_id into new.conta_id from public.empreendimentos e where e.id = new.empreendimento_id;
  end if;
  if tg_op = 'INSERT' and new.conta_id is not null then
    select c.taxa_fechamento into new.taxa_danova_pct from public.contas c where c.id = new.conta_id;
  end if;
  if new.status = 'fechada' and new.data_fechamento is null then new.data_fechamento := current_date; end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger a_venda_preencher before insert or update on public.vendas for each row execute function public.venda_preencher();

-- Vendas: reflete no lead, na unidade e gera a fatura de 1% no fechamento
create or replace function public.venda_refletir() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_etapa public.etapa_lead; v_unid text; c record;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_etapa := case new.status when 'proposta' then 'proposta' when 'contrato' then 'contrato' when 'fechada' then 'fechado' else null end;
  v_unid := case new.status when 'proposta' then null when 'contrato' then 'reservada' when 'fechada' then 'vendida' when 'cancelada' then 'disponivel' end;
  if v_etapa is not null and new.lead_id is not null then
    update public.leads set etapa = v_etapa, unidade_id = coalesce(new.unidade_id, unidade_id), valor_estimado = new.valor where id = new.lead_id;
  end if;
  if v_unid is not null and new.unidade_id is not null then
    update public.unidades set status = v_unid, lead_id = case when v_unid = 'disponivel' then null else new.lead_id end, atualizado_em = now() where id = new.unidade_id;
  end if;
  if new.status = 'fechada' and new.conta_id is not null then
    select * into c from public.contas where id = new.conta_id;
    insert into public.faturas(conta_id, tipo, competencia, venda_id, descricao, valor, moeda, vencimento)
    values (new.conta_id, 'fechamento', date_trunc('month', coalesce(new.data_fechamento, current_date))::date, new.id,
            'Taxa de fechamento ' || to_char(new.taxa_danova_pct * 100, 'FM990.00') || '% sobre venda de ' || new.moeda || ' ' || to_char(new.valor, 'FM999G999G999D00'),
            new.taxa_danova_valor, new.moeda, coalesce(new.data_fechamento, current_date) + 30)
    on conflict do nothing;
  elsif new.status = 'cancelada' then
    update public.faturas set status = 'cancelada' where venda_id = new.id and status = 'aberta';
  end if;
  if new.lead_id is not null then
    insert into public.lead_eventos(lead_id, autor_id, tipo, texto)
    values (new.lead_id, auth.uid(), 'nota', case new.status
      when 'proposta' then 'Proposta registrada: '
      when 'contrato' then 'Contrato em andamento: '
      when 'fechada' then 'Venda fechada: '
      else 'Negociação cancelada: ' end || new.moeda || ' ' || to_char(new.valor, 'FM999G999G999D00'));
  end if;
  return new;
end $$;
create trigger b_venda_refletir after insert or update of status on public.vendas for each row execute function public.venda_refletir();

-- Cobrança: gera as mensalidades do mês para todas as contas ativas
create or replace function public.gerar_mensalidades(p_competencia date default date_trunc('month', current_date)::date) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not privado.eh_admin() then raise exception 'Apenas administradores'; end if;
  insert into public.faturas(conta_id, tipo, competencia, descricao, valor, moeda, vencimento)
  select c.id, 'mensalidade', date_trunc('month', p_competencia)::date,
         'Mensalidade plataforma danova AI · ' || to_char(p_competencia, 'MM/YYYY'),
         c.mensalidade, c.moeda_mensalidade,
         (date_trunc('month', p_competencia) + (c.dia_vencimento - 1) * interval '1 day')::date
  from public.contas c where c.ativo
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.gerar_mensalidades(date) from public, anon;
grant execute on function public.gerar_mensalidades(date) to authenticated;

-- Membros: construtora/corretor não alteram vínculo de conta nem distribuição
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
    if (n->>'papel') is distinct from (o->>'papel') or (n->>'ativo') is distinct from (o->>'ativo') or (n->>'email') is distinct from (o->>'email')
       or (n->>'conta_id') is distinct from (o->>'conta_id') or (n->>'capacidade') is distinct from (o->>'capacidade') then
      raise exception 'Apenas administradores podem alterar papel, status, conta ou capacidade';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.lead_resolver_empreendimento() from public, anon, authenticated;
revoke all on function public.lead_distribuir() from public, anon, authenticated;
revoke all on function public.lead_registrar_atribuicao_inicial() from public, anon, authenticated;
revoke all on function public.lead_enfileirar_conversao() from public, anon, authenticated;
revoke all on function public.visita_apos_inserir() from public, anon, authenticated;
revoke all on function public.venda_preencher() from public, anon, authenticated;
revoke all on function public.venda_refletir() from public, anon, authenticated;
revoke all on function public.proteger_campos() from public, anon, authenticated;

-- =====================================================================
-- Portal da construtora: só números agregados, nunca contatos de clientes
-- =====================================================================
create or replace function public.portal_resumo(p_conta uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conta uuid; r jsonb;
begin
  v_conta := case when privado.eh_admin() then coalesce(p_conta, privado.minha_conta()) else privado.minha_conta() end;
  if v_conta is null then raise exception 'Sem conta vinculada'; end if;
  select jsonb_build_object(
    'conta', (select jsonb_build_object('id', c.id, 'nome', c.nome, 'mensalidade', c.mensalidade, 'moeda_mensalidade', c.moeda_mensalidade, 'taxa_fechamento', c.taxa_fechamento) from public.contas c where c.id = v_conta),
    'empreendimentos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'nome', e.nome, 'status', e.status, 'entrega', e.entrega,
        'unidades', (select jsonb_build_object(
            'total', count(*), 'disponivel', count(*) filter (where u.status = 'disponivel'),
            'reservada', count(*) filter (where u.status = 'reservada'), 'vendida', count(*) filter (where u.status = 'vendida'))
          from public.unidades u where u.empreendimento_id = e.id),
        'leads', (select count(*) from public.leads l where l.empreendimento_id = e.id),
        'funil', (select coalesce(jsonb_object_agg(x.etapa, x.n), '{}'::jsonb) from (select l.etapa, count(*) n from public.leads l where l.empreendimento_id = e.id group by l.etapa) x),
        'canais', (select coalesce(jsonb_object_agg(x.canal, x.n), '{}'::jsonb) from (select coalesce(l.canal, 'direto') canal, count(*) n from public.leads l where l.empreendimento_id = e.id group by 1) x),
        'visitas', (select count(*) from public.visitas v where v.empreendimento_id = e.id and v.status in ('agendada','confirmada','realizada')),
        'visitas_realizadas', (select count(*) from public.visitas v where v.empreendimento_id = e.id and v.status = 'realizada'),
        'vendas', (select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'valor', s.valor, 'moeda', s.moeda, 'data', coalesce(s.data_fechamento, s.data_proposta), 'canal', s.canal) order by s.criado_em desc), '[]'::jsonb) from public.vendas s where s.empreendimento_id = e.id and s.status <> 'cancelada'),
        'investimento', (select coalesce(jsonb_object_agg(x.chave, x.total), '{}'::jsonb) from (select i.canal || ':' || i.moeda chave, sum(i.valor) total from public.investimentos i where i.empreendimento_id = e.id group by 1) x),
        'videos', (select coalesce(jsonb_agg(jsonb_build_object('status', p.status, 'formatos', p.formatos, 'duracoes', p.duracoes, 'link', p.link_entrega, 'prazo', p.prazo, 'criado_em', p.criado_em) order by p.criado_em desc), '[]'::jsonb) from public.pedidos_video p where p.empreendimento_id = e.id)
      ) order by e.nome) from public.empreendimentos e where e.conta_id = v_conta), '[]'::jsonb),
    'faturas', coalesce((select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'competencia', f.competencia, 'descricao', f.descricao, 'valor', f.valor, 'moeda', f.moeda, 'vencimento', f.vencimento, 'status', f.status) order by f.competencia desc, f.criado_em desc) from public.faturas f where f.conta_id = v_conta), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.portal_resumo(uuid) from public, anon;
grant execute on function public.portal_resumo(uuid) to authenticated;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.contas enable row level security;
alter table public.empreendimentos enable row level security;
alter table public.unidades enable row level security;
alter table public.visitas enable row level security;
alter table public.vendas enable row level security;
alter table public.faturas enable row level security;
alter table public.investimentos enable row level security;
alter table public.documentos enable row level security;
alter table public.distribuicao_config enable row level security;
alter table public.conversoes enable row level security;

-- contas
create policy contas_admin on public.contas for all to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy contas_propria on public.contas for select to authenticated using (id = (select privado.minha_conta()));
-- empreendimentos: equipe vê todos; construtora vê os seus; só admin edita
create policy emp_ver on public.empreendimentos for select to authenticated using ((select privado.eh_equipe()) or conta_id = (select privado.minha_conta()));
create policy emp_admin on public.empreendimentos for all to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
-- unidades: equipe vê todas; construtora vê e atualiza as suas; admin tudo
create policy unid_ver on public.unidades for select to authenticated
  using ((select privado.eh_equipe()) or exists (select 1 from public.empreendimentos e where e.id = empreendimento_id and e.conta_id = (select privado.minha_conta())));
create policy unid_admin on public.unidades for all to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy unid_construtora_editar on public.unidades for update to authenticated
  using (exists (select 1 from public.empreendimentos e where e.id = empreendimento_id and e.conta_id = (select privado.minha_conta())))
  with check (exists (select 1 from public.empreendimentos e where e.id = empreendimento_id and e.conta_id = (select privado.minha_conta())));
create policy unid_construtora_criar on public.unidades for insert to authenticated
  with check (exists (select 1 from public.empreendimentos e where e.id = empreendimento_id and e.conta_id = (select privado.minha_conta())));
-- visitas: segue o acesso ao lead
create policy vis_ver on public.visitas for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));
create policy vis_criar on public.visitas for insert to authenticated with check ((select privado.eh_equipe()) and exists (select 1 from public.leads l where l.id = lead_id));
create policy vis_editar on public.visitas for update to authenticated using (exists (select 1 from public.leads l where l.id = lead_id)) with check (exists (select 1 from public.leads l where l.id = lead_id));
create policy vis_apagar on public.visitas for delete to authenticated using ((select privado.eh_admin()));
-- vendas: admin tudo; corretor as suas
create policy vendas_admin on public.vendas for all to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy vendas_corretor_ver on public.vendas for select to authenticated using (corretor_id = (select auth.uid()) and (select privado.eh_equipe()));
create policy vendas_corretor_criar on public.vendas for insert to authenticated
  with check ((select privado.eh_equipe()) and exists (select 1 from public.leads l where l.id = lead_id and l.corretor_id = (select auth.uid())));
create policy vendas_corretor_editar on public.vendas for update to authenticated
  using (corretor_id = (select auth.uid()) and (select privado.eh_equipe())) with check (corretor_id = (select auth.uid()));
-- faturas: admin tudo; construtora lê as suas
create policy fat_admin on public.faturas for all to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy fat_propria on public.faturas for select to authenticated using (conta_id = (select privado.minha_conta()));
-- investimentos: admin tudo
create policy inv_admin on public.investimentos for all to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
-- documentos: segue o acesso ao lead
create policy doc_ver on public.documentos for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));
create policy doc_criar on public.documentos for insert to authenticated with check ((select privado.eh_equipe()) and enviado_por = (select auth.uid()) and exists (select 1 from public.leads l where l.id = lead_id));
create policy doc_apagar on public.documentos for delete to authenticated using ((select privado.eh_admin()) or enviado_por = (select auth.uid()));
-- distribuição e conversões: admin
create policy dist_ver on public.distribuicao_config for select to authenticated using ((select privado.eh_equipe()));
create policy dist_admin on public.distribuicao_config for update to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy conv_admin on public.conversoes for select to authenticated using ((select privado.eh_admin()));

-- Storage: arquivos em documentos/<lead_id>/..., acessíveis a quem vê o lead
create policy "documentos_ler" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and exists (select 1 from public.leads l where l.id::text = (storage.foldername(name))[1]));
create policy "documentos_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (select privado.eh_equipe()) and exists (select 1 from public.leads l where l.id::text = (storage.foldername(name))[1]));
create policy "documentos_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (owner = (select auth.uid()) or (select privado.eh_admin())));

-- Visão do CRM com nomes do inventário (nova; a leads_resumo antiga continua existindo)
create view public.leads_painel with (security_invoker = true) as
  select l.*, m.nome as corretor_nome, e.nome as empreendimento_nome, u.codigo as unidade_codigo,
         (select c.id from public.conversas c where c.lead_id = l.id order by c.criado_em desc limit 1) as conversa_id,
         (select a.resumo from public.agente_analises a where a.lead_id = l.id order by a.criado_em desc limit 1) as ia_resumo,
         (select min(v.inicio) from public.visitas v where v.lead_id = l.id and v.status in ('agendada','confirmada') and v.inicio >= now()) as proxima_visita
  from public.leads l
  left join public.membros m on m.id = l.corretor_id
  left join public.empreendimentos e on e.id = l.empreendimento_id
  left join public.unidades u on u.id = l.unidade_id;

-- liga leads antigos ao inventário
update public.leads set empreendimento = empreendimento where empreendimento is not null;

-- =====================================================================
-- PARTE 5 — Vídeo pronto para anúncios (Meta Ads e Google Ads)
-- (aplicada junto com a parte 4; a versão de portal_resumo abaixo substitui a anterior e inclui os vídeos)
-- =====================================================================
create table if not exists public.pedidos_video (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.contas(id) on delete set null,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  empreendimento_texto text,
  solicitado_por uuid references public.membros(id) on delete set null,
  contato_nome text,
  contato_email text,
  contato_telefone text,
  formatos text[] not null default '{9:16,1:1,16:9}',
  duracoes text[] not null default '{15s,30s}',
  idiomas text[] not null default '{pt}',
  plataformas text[] not null default '{meta,google}',
  material text,
  briefing text,
  status text not null default 'solicitado' check (status in ('solicitado','em_producao','revisao','aprovado','entregue','cancelado')),
  link_entrega text,
  prazo date,
  lead_id uuid references public.leads(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.pedidos_video enable row level security;
create policy video_admin on public.pedidos_video for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy video_construtora on public.pedidos_video for select to authenticated
  using (conta_id = (select privado.minha_conta()));

-- Pedido público (site) ou da construtora logada: cria o lead no CRM e o pedido.
create or replace function public.solicitar_video(dados jsonb)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_lead uuid; v_emp uuid; v_conta uuid;
begin
  if coalesce(dados->>'website','') <> '' then return null; end if;
  if coalesce(nullif(trim(dados->>'email'),''), nullif(trim(dados->>'phone'),'')) is null then raise exception 'email_ou_telefone_obrigatorio'; end if;
  if (select count(*) from public.pedidos_video where criado_em > now() - interval '1 minute') > 10 then raise exception 'limite_excedido'; end if;
  v_conta := privado.minha_conta();
  select e.id into v_emp from public.empreendimentos e where e.id::text = dados->>'empreendimento_id';
  v_lead := public.enviar_lead(jsonb_build_object(
    'name', dados->>'name', 'email', dados->>'email', 'phone', dados->>'phone',
    'profile', coalesce(dados->>'profile', 'Construtora ou incorporadora'),
    'project', coalesce(dados->>'empreendimento', (select nome from public.empreendimentos where id = v_emp)),
    'goal', 'Vídeo pronto para anúncios', 'notes', dados->>'briefing', 'lead_page', 'video-anuncios',
    'first_touch_source', dados->>'first_touch_source', 'last_touch_source', dados->>'last_touch_source',
    'first_touch_campaign', dados->>'first_touch_campaign', 'gclid', dados->>'gclid', 'fbclid', dados->>'fbclid'));
  insert into public.pedidos_video(conta_id, empreendimento_id, empreendimento_texto, solicitado_por, contato_nome, contato_email, contato_telefone,
                                   formatos, duracoes, idiomas, plataformas, material, briefing, lead_id)
  values (v_conta, v_emp, left(dados->>'empreendimento', 200), auth.uid(), left(dados->>'name', 200), left(dados->>'email', 200), left(dados->>'phone', 60),
          coalesce((select array_agg(x) from jsonb_array_elements_text(dados->'formatos') x where x in ('9:16','1:1','16:9','4:5')), '{9:16,1:1,16:9}'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(dados->'duracoes') x where x in ('6s','15s','30s','60s')), '{15s,30s}'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(dados->'idiomas') x where x in ('pt','en','es')), '{pt}'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(dados->'plataformas') x where x in ('meta','google','youtube','tiktok')), '{meta,google}'),
          left(dados->>'material', 1000), left(dados->>'briefing', 3000), v_lead)
  returning id into v_id;
  if v_lead is not null then
    insert into public.lead_eventos(lead_id, tipo, texto) values (v_lead, 'nota', 'Pediu vídeo pronto para anúncios (Meta/Google).');
  end if;
  return v_id;
end $function$;
grant execute on function public.solicitar_video(jsonb) to anon, authenticated;

-- =====================================================================
-- PARTE 6 (24/10/2026) — Métricas de campanhas do Google Ads e do Meta Ads (importadas por CSV)
-- =====================================================================
create table if not exists public.campanhas_metricas (
  id bigserial primary key,
  data date not null,
  plataforma text not null check (plataforma in ('google','meta')),
  campanha text not null,
  conjunto text not null default '',
  impressoes bigint not null default 0 check (impressoes >= 0),
  cliques bigint not null default 0 check (cliques >= 0),
  custo numeric(14,2) not null default 0 check (custo >= 0),
  moeda text not null default 'BRL' check (moeda in ('BRL','USD')),
  conversoes numeric(12,2) not null default 0,
  valor_conversoes numeric(14,2) not null default 0,
  alcance bigint,
  origem text not null default 'csv' check (origem in ('csv','api','manual')),
  importado_por uuid references public.membros(id) on delete set null,
  importado_em timestamptz not null default now(),
  constraint campanhas_metricas_unica unique (data, plataforma, campanha, conjunto)
);
create index if not exists campanhas_metricas_data on public.campanhas_metricas(data);
alter table public.campanhas_metricas enable row level security;
create policy campanhas_admin on public.campanhas_metricas for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

-- =====================================================================
-- PARTE 7 (24/10/2026) — Contas de anúncio dos clientes (Google Ads / Meta Ads) e métricas de vídeo
-- Sincronização pela função ads-sync (supabase/functions/ads-sync)
-- =====================================================================
create table if not exists public.contas_anuncio (
  id uuid primary key default gen_random_uuid(),
  plataforma text not null check (plataforma in ('google','meta')),
  conta_externa text not null,
  nome text,
  conta_id uuid references public.contas(id) on delete set null,
  ativo boolean not null default true,
  moeda text,
  ultima_sync timestamptz,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  constraint contas_anuncio_unica unique (plataforma, conta_externa)
);
alter table public.contas_anuncio enable row level security;
create policy contas_anuncio_admin on public.contas_anuncio for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
alter table public.campanhas_metricas
  add column if not exists conta_anuncio text not null default '',
  add column if not exists visualizacoes bigint not null default 0,
  add column if not exists video_p25 bigint not null default 0,
  add column if not exists video_p50 bigint not null default 0,
  add column if not exists video_p75 bigint not null default 0,
  add column if not exists video_p100 bigint not null default 0;
create unique index if not exists campanhas_metricas_chave on public.campanhas_metricas (data, plataforma, conta_anuncio, campanha, conjunto);
alter table public.campanhas_metricas drop constraint if exists campanhas_metricas_unica;
