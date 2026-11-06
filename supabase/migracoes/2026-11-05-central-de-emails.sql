-- Central de E-mails: modelos, envios, eventos do provedor e descadastro
alter table public.empreendimentos add column if not exists condicoes text, add column if not exists link text;
update public.empreendimentos set link = 'https://danova-ai.com/#' || slug where link is null;
update public.empreendimentos set condicoes = '20% no contrato, 10% em 60 dias, 10% no top-off e 60% no fechamento' where slug = 'melia-brickell' and condicoes is null;
update public.empreendimentos set condicoes = '20% na assinatura, 10% em 120 dias, 10% no top-off e 60% no fechamento' where slug = 'continuum-club-residences' and condicoes is null;

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  nome text not null,
  publico text,
  objetivo text,
  assunto text not null,
  corpo_html text not null,
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.membros(id) on delete set null
);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  template_id uuid references public.email_templates(id) on delete set null,
  modelo text,
  destinatario_nome text,
  destinatario_email text not null,
  assunto text not null,
  corpo_html text,
  enviado_por uuid references public.membros(id) on delete set null,
  enviado_por_nome text,
  status text not null default 'pendente' check (status in ('pendente','enviado','entregue','aberto','clicado','atrasado','rejeitado','reclamacao','falhou')),
  provedor text not null default 'resend',
  provedor_id text,
  erro text,
  chave_idempotencia text unique,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists email_sends_lead_idx on public.email_sends(lead_id, criado_em desc);
create index if not exists email_sends_provedor_idx on public.email_sends(provedor_id);

create table if not exists public.email_events (
  id bigserial primary key,
  send_id uuid references public.email_sends(id) on delete cascade,
  provedor_id text,
  tipo text not null,
  dados jsonb not null default '{}',
  criado_em timestamptz not null default now()
);
create index if not exists email_events_send_idx on public.email_events(send_id, criado_em desc);

create table if not exists public.email_descadastros (
  email text primary key,
  lead_id uuid references public.leads(id) on delete set null,
  motivo text,
  criado_em timestamptz not null default now()
);

alter table public.email_templates enable row level security;
alter table public.email_sends enable row level security;
alter table public.email_events enable row level security;
alter table public.email_descadastros enable row level security;
revoke all on public.email_templates, public.email_sends, public.email_events, public.email_descadastros from anon;
revoke insert, update, delete on public.email_sends, public.email_events, public.email_descadastros from authenticated;
grant select on public.email_templates, public.email_sends, public.email_events, public.email_descadastros to authenticated;
grant update on public.email_templates to authenticated;

drop policy if exists "modelos: equipe lê" on public.email_templates;
create policy "modelos: equipe lê" on public.email_templates for select to authenticated using (privado.eh_equipe());
drop policy if exists "modelos: admin edita" on public.email_templates;
create policy "modelos: admin edita" on public.email_templates for update to authenticated using (privado.eh_admin()) with check (privado.eh_admin());

drop policy if exists "envios: admin ou corretor do lead" on public.email_sends;
create policy "envios: admin ou corretor do lead" on public.email_sends for select to authenticated
  using (privado.eh_admin() or enviado_por = auth.uid() or exists (select 1 from public.leads l where l.id = lead_id and l.corretor_id = auth.uid()));
drop policy if exists "eventos: quem vê o envio" on public.email_events;
create policy "eventos: quem vê o envio" on public.email_events for select to authenticated
  using (exists (select 1 from public.email_sends s where s.id = send_id));
drop policy if exists "descadastros: equipe lê" on public.email_descadastros;
create policy "descadastros: equipe lê" on public.email_descadastros for select to authenticated using (privado.eh_equipe());

insert into public.email_templates (codigo, nome, publico, objetivo, assunto, corpo_html, ordem) values
('empreendimento', 'Modelo 01 · Apresentação de empreendimento', 'Clientes e investidores', 'Apresentar imóveis e oportunidades imobiliárias',
 '{{empreendimento}}: uma oportunidade em {{localizacao}}',
 '<p>Olá, {{nome_cliente}}!</p><p>Separei uma oportunidade que combina com o que conversamos: <strong>{{empreendimento}}</strong>, em {{localizacao}}.</p><ul><li><strong>Valores a partir de:</strong> {{valor}}</li><li><strong>Condições:</strong> {{condicoes}}</li></ul><p>Posso enviar as plantas, a tabela atualizada e a disponibilidade das unidades. Veja mais detalhes do projeto: <a href="{{link_empreendimento}}">{{empreendimento}}</a>.</p><p>Se fizer sentido, agendamos uma conversa rápida por WhatsApp ou Zoom para eu apresentar o empreendimento.</p><p><small>Valores e condições informados pela incorporadora, sujeitos a alteração sem aviso.</small></p>', 1),
('institucional', 'Modelo 02 · Apresentação DANOVA-AI', 'Clientes e investidores', 'Apresentar a empresa, os serviços e a plataforma',
 '{{nome_cliente}}, conheça a DANOVA-AI',
 '<p>Olá, {{nome_cliente}}!</p><p>A <strong>DANOVA-AI</strong> é uma empresa de inteligência imobiliária que conecta investidores do Brasil e da América Latina às oportunidades do mercado americano, com foco em Miami e na Flórida.</p><ul><li><strong>Curadoria de empreendimentos:</strong> pré-construção, branded residences e imóveis prontos.</li><li><strong>Assessoria completa:</strong> da escolha do imóvel ao fechamento, com apoio jurídico e uma rede de contadores, bancos e designers.</li><li><strong>Atendimento em português, inglês e espanhol</strong>, com acompanhamento de cada etapa.</li><li><strong>Tecnologia:</strong> plataforma própria que conecta marketing, CRM e inteligência artificial.</li></ul><p>Conheça a DANOVA-AI: <a href="https://danova-ai.com/">danova-ai.com</a>. Será um prazer entender seus objetivos e apresentar as oportunidades que fazem sentido para você.</p>', 2),
('parceria', 'Modelo 03 · Parceria com corretores', 'Corretores e imobiliárias', 'Prospectar parceiros comerciais',
 'Parceria DANOVA-AI: empreendimentos de Miami para os seus clientes',
 '<p>Olá, {{nome_cliente}}!</p><p>A <strong>DANOVA-AI</strong> está ampliando a rede de corretores e imobiliárias parceiras que atendem clientes interessados em investir nos Estados Unidos.</p><ul><li>Acesso a empreendimentos selecionados em Miami e na Flórida.</li><li>CRM para acompanhar cada cliente e cada negociação.</li><li>Materiais, campanhas e apoio da nossa equipe nos EUA.</li><li>Presença nos eventos e conteúdos da DANOVA-AI.</li></ul><p>Se quiser conhecer o modelo de parceria, faça seu cadastro em <a href="https://danova-ai.com/#parceiro">danova-ai.com/#parceiro</a> ou responda este e-mail para agendarmos uma conversa.</p>', 3)
on conflict (codigo) do nothing;
