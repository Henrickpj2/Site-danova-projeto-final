# danova AI — site + CRM

Posicionamento (21/10/2026): tráfego pago imobiliário há 10 anos — Meta Ads e Google Ads para empreendimentos de alto padrão. O topo do site tem o **Localizador de empreendimentos** (orçamento, objetivo e região → mapa e resultados por compatibilidade), que também dispara os eventos `localizador_busca` e `localizador_enviar` no dataLayer para otimizar campanhas.

Atualização 23/10/2026 — **plataforma completa**: o site ganhou as seções *Plataforma* (diagrama Clientes → Canais → núcleo danova AI → Operação → Resultados), *SEO + IA* como terceiro canal, *Vídeo pronto para anúncios* (formulário que grava o pedido no CRM), *Planos* (R$ 199,99/mês + 1% sobre venda fechada) e *Perguntas frequentes* com dados estruturados (JSON-LD), `llms.txt` e `robots.txt` liberando os buscadores de IA. A área de membros ganhou inventário, visitas, vendas e comissões, desempenho e previsão, mídia, cobrança, vídeos, distribuição inteligente e o portal da construtora.

Site institucional da danova AI com área de membros para acompanhar leads, corretores e o andamento de cada negociação.

```
public_html/        → tudo o que vai para a Hostinger (pasta public_html)
  index.html        → site
  crm/              → área de membros (https://danova-ai.com/crm/)
  api/lead.php      → recebe formulários, envia e-mail, grava CSV e encaminha ao CRM
  js/crm-config.js  → endereço do banco e chave pública
  js/danova-localizador.js → localizador de empreendimentos do topo (filtros + mapa)
  js/danova-chat.js → chat do atendente de IA
  crm/crm-modulos.js → telas da plataforma (inventário, vendas, cobrança, portal…)
  llms.txt          → resumo da danova AI para assistentes de IA (ChatGPT, Claude, Perplexity)
fonte/              → arquivos-fonte (build.py gera o index.html; montar-localizador.sh gera o localizador)
supabase/schema.sql → estrutura base do banco do CRM
supabase/migracoes/ → plataforma (construtoras, inventário, vendas, cobrança, vídeos…)
supabase/functions/ → atendente do site, agente do CRM, leads do Meta e conversões do Meta
```

## Como o lead chega ao CRM

1. O visitante preenche o formulário do site.
2. O navegador envia o lead estruturado ao banco (função `enviar_lead`) e abre a conversa no WhatsApp.
3. Em paralelo, `api/lead.php` envia o e-mail de aviso para danielle@danova-ai.com. Os outros formulários (por exemplo, a página do livro) entram no CRM pelo próprio `lead.php`.
4. O lead aparece no CRM como **Novo**, em tempo real, com origem (UTM, Google, Instagram…).

## Área de membros (`/crm/`)

- **Painel:** total de leads, em negociação, fechados e conversão, valor do pipeline, leads por dia, funil por etapa, empreendimentos mais procurados, próximos contatos (com atrasados em vermelho), origem e perfil.
- **Funil:** quadro com as etapas *Novo → Em contato → Qualificado → Visita → Proposta → Contrato → Fechado / Perdido*. Arraste o cartão para mudar a etapa.
- **Leads:** lista com busca, filtros (etapa, corretor, empreendimento, período) e exportação CSV.
- **Ficha do lead:** etapa, temperatura, corretor responsável, valor estimado, próximo passo e data, botões de WhatsApp/e-mail/ligar e histórico automático (cada mudança de etapa, atribuição, contato e anotação fica registrada com autor e data).
- **Corretores** (só administradores): aprovar acessos, definir papel, ver leads, fechados e conversão de cada um.

### Telas da plataforma

| Tela | Quem vê | O que faz |
|---|---|---|
| **Inventário** | admin, corretor | Unidades por empreendimento (disponível / reservada / vendida / bloqueada); o admin cola a tabela de unidades, muda status e vincula o empreendimento à construtora. |
| **Visitas** | admin, corretor | Agenda dos próximos dias; agendar pela ficha do lead. |
| **Vendas** | admin, corretor | Propostas, contratos e vendas, com comissão do corretor, taxa danova (1%), canal e campanha de origem; exporta CSV. |
| **Desempenho** | admin, corretor | Previsão ponderada por etapa, conversões, resultado por canal (CPL, custo por lead qualificado, ROAS) e envio de conversões ao Meta / exportação CSV para o Google Ads. |
| **Mídia** | admin | Investimento mensal por canal, campanha e empreendimento. |
| **Cobrança** | admin | Clientes (construtoras/imobiliárias), plano R$ 199,99/mês + 1%, gerar mensalidades do mês (não duplica) e baixar faturas. A fatura de 1% nasce sozinha quando a venda é marcada como **Fechada** e é cancelada se a venda for cancelada. |
| **Vídeos** | admin | Pedidos de vídeo para anúncios (site, portal ou CRM): status, prazo e link de entrega. |
| **Distribuição** | admin | Liga/desliga a distribuição automática e define, por corretor, idiomas, regiões, empreendimentos de especialidade e capacidade. |
| **Portal** | construtora (e admin, para conferir) | Unidades, funil, origem, visitas, negociações sem nomes, investimento, vídeos e faturas. **Nunca mostra nome, e-mail ou telefone de clientes.** |

Na **ficha do lead** apareceram três blocos: *Visitas* (agendar e marcar comparecimento), *Negociação* (proposta ligada à unidade; Contrato reserva a unidade, Fechada vende, leva o lead a Fechado e fatura 1%) e *Documentos* (arquivos privados no Storage, até 20 MB).

**Distribuição automática:** todo lead novo vai para o corretor ativo com maior pontuação — especialista no empreendimento (+3), fala o idioma do cliente (+2), atende a região (+1) — e, no empate, para quem tem menos leads abertos. Corretores no limite de capacidade ou com "Recebe" desligado ficam de fora.

**Acesso de construtora:** a construtora se cadastra em `/crm/` como qualquer membro; o admin, na aba Corretores, ativa o acesso e muda o papel para *Construtora*; em Cobrança, na coluna *Acesso ao portal* do cliente, escolhe esse usuário. Depois, vincule os empreendimentos dela em Inventário.

### Permissões
| | Administrador | Corretor |
|---|---|---|
| Vê leads | todos | só os atribuídos a ele |
| Atribui / reatribui leads | sim | não |
| Muda etapa, anota, agenda | sim | nos seus leads |
| Aprova corretores e muda papéis | sim | não |
| Exclui leads | sim | não |

Essas regras ficam no próprio banco (Row Level Security): mesmo que alguém altere o código da página, o banco não entrega dados de outro corretor.

## Agente de IA

Dois papéis, ambos usando Claude (Anthropic) por funções no Supabase (`supabase/functions/`):

- **Atendente do site** (`atendente`): chat no canto da página, em português, inglês e espanhol. Responde só com a base de conhecimento (`conhecimento.ts`: os 10 empreendimentos, serviços e contatos), qualifica o cliente, cria o lead no CRM com resumo e temperatura e, quando o cliente pede uma pessoa ou demonstra alta intenção, mostra o botão para continuar no WhatsApp da Danielle. Avisa que é um assistente virtual e não promete preço final, retorno ou visto.
- **Agente do CRM** (`agente-crm`): botão **Analisar com IA** na ficha do lead. Lê os dados, o histórico e a conversa do chat e sugere resumo, próximo passo, data de follow-up, temperatura e uma mensagem pronta para WhatsApp. Nada muda no lead até o corretor clicar em **Aplicar sugestão**. Cada corretor só consegue analisar os próprios leads.

**Ligar a IA:** no Supabase (projeto `danova-crm`) → **Edge Functions → Secrets**, crie `ANTHROPIC_API_KEY` com a sua chave da Anthropic (console.anthropic.com). Sem a chave, o chat continua aparecendo e encaminha o cliente para o WhatsApp.
Opcional: `ATENDENTE_MODELO` e `AGENTE_MODELO` (padrão `claude-sonnet-5-5`).

**Limites contra abuso e custo:** 30 mensagens por conversa, 6 conversas novas por IP por hora, 60 mensagens por minuto no site todo, 20 análises por membro por hora.

**Atualizar preços e projetos:** edite `supabase/functions/atendente/conhecimento.ts` (e a cópia em `agente-crm/`) e publique as funções de novo.

## Meta Ads e Google Ads (conversões)

**Leads dos formulários do Meta → CRM** (função `meta-leads`):
1. No app do Meta (developers.facebook.com) → Webhooks → *Page* → assine o campo `leadgen` com a URL `https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/meta-leads` e um token de verificação que você inventar.
2. No Supabase → Edge Functions → Secrets: `META_VERIFY_TOKEN` (o mesmo token), `META_APP_SECRET` (chave secreta do app) e `META_PAGE_TOKEN` (token de página com `leads_retrieval`).

**CRM → Meta** (função `meta-capi`, API de Conversões): crie `META_PIXEL_ID` (conjunto de dados) e `META_CAPI_TOKEN`. Cada mudança para Qualificado, Visita, Proposta, Contrato e Fechado entra numa fila; o botão **Enviar ao Meta agora** (Desempenho) envia. Para testar, use `META_TEST_EVENT_CODE`.

**CRM → Google Ads:** o GCLID de cada lead fica salvo. Em Desempenho, **Exportar para Google Ads (CSV)** gera o arquivo de conversões offline (Lead qualificado, Visita, Proposta, Contrato, Venda). Crie essas ações de conversão com esses nomes no Google Ads (tipo *Importar → cliques*) e importe o CSV.

## Vídeo pronto para anúncios

Formulário na seção `#video` do site → função `solicitar_video` → cria o lead (objetivo "Vídeo pronto para anúncios") e o pedido, que aparece em CRM → Vídeos. A construtora logada também pede pelo Portal. O preço não está publicado no site ("orçamento por projeto").

## Primeiro acesso

1. Abra `https://danova-ai.com/crm/` e clique em **Sou corretor · solicitar acesso**.
2. Cadastre-se com **danielle@danova-ai.com** ou **gestorhenrickoliveira@gmail.com**: esses dois e-mails viram administradores automaticamente.
3. Confirme o e-mail pelo link recebido e entre.
4. Para cada corretor: envie o link `/crm/`, peça o cadastro e ative a chave **Acesso** na aba Corretores.

## Ajustes no painel do Supabase (projeto `danova-crm`)

Authentication → URL Configuration:
- **Site URL:** `https://danova-ai.com/crm/`
- **Redirect URLs:** `https://danova-ai.com/crm/` e `https://danova-ai.com/crm/*`

Sem isso, os links de confirmação de e-mail e de nova senha apontam para `localhost`.

O envio de e-mails padrão do Supabase tem limite baixo por hora. Para volume real, configure um SMTP próprio (Authentication → Emails → SMTP), por exemplo o e-mail da Hostinger.

## Publicar na Hostinger

Envie o conteúdo de `public_html/` para a pasta `public_html` do domínio (Gerenciador de Arquivos ou FTP). Se já existir um `.htaccess`, mantenha o antigo e cole o bloco novo no topo.

## Editar o site

Os textos e estilos ficam em `fonte/`. Depois de editar:

```sh
python3 fonte/build.py        # gera public_html/index.html
sh fonte/montar-localizador.sh # gera public_html/js/danova-localizador.js
```
