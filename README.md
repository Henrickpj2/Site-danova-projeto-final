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
- **Funil (arrasta e solta):** arraste com o mouse ou, no celular, segure e arraste; a coluna de destino acende e mostra onde o cartão vai cair, a tela rola sozinha nas bordas, aparece *Desfazer* por 6 segundos, confete ao fechar venda e o motivo é pedido ao marcar Perdido. Cartões com temperatura, valor, canal (Meta/Google/IA), próximo contato (hoje/atrasado), próximo passo, corretor e dias desde a última atualização (barra laranja quando parado há 7+ dias), botão de WhatsApp e modo compacto; colunas recolhíveis. Etapas: *Novo → Em contato → Qualificado → Visita → Proposta → Contrato → Fechado / Perdido*. Arraste o cartão para mudar a etapa.
- **Leads:** lista com busca, filtros (etapa, corretor, empreendimento, período) e exportação CSV.
- **Ficha do lead:** etapa, temperatura, corretor responsável, valor estimado, próximo passo e data, botões de WhatsApp/e-mail/ligar e histórico automático (cada mudança de etapa, atribuição, contato e anotação fica registrada com autor e data).
- **Corretores** (só administradores): aprovar acessos, definir papel, ver leads, fechados e conversão de cada um.

### Dashboard do administrador

Tela inicial de quem é admin (só admins veem). Atualiza sozinho: a cada lead novo ou alterado (tempo real) e, para vendas, visitas e eventos, a cada minuto.
- Período (hoje, 7, 30, 90 dias, 12 meses) com comparação automática com o período anterior (▲▼ %).
- Indicadores animados com minigráficos: leads novos, qualificados, taxa de qualificação, visitas, vendido e pipeline aberto (com previsão ponderada).
- Entrada de leads por dia, empilhada por canal (Meta, Google, chat de IA, SEO, direto), com detalhes ao passar o mouse.
- Origem dos leads com custo por lead (quando o investimento está lançado em Mídia), funil com a conversão entre etapas, ranking de corretores, empreendimentos mais procurados com unidades disponíveis.
- Alertas clicáveis (leads novos há 24h sem contato, sem corretor, follow-ups atrasados, quentes parados, visitas do dia, faturas vencidas), feed ao vivo das movimentações e mapa de calor de dia × hora de chegada dos leads.

### Campanhas · Google Ads e Meta Ads (só admin)

Dashboard escuro com os números das duas plataformas lado a lado e cruzados com o CRM:
- Período (7/14/30/90 dias ou datas livres) comparado com o período anterior; filtro por plataforma e campanha (clicar numa linha da tabela também filtra).
- Desempenho: impressões, cliques, CTR, investimento · Conversões: conversões, taxa, custo por conversão, valor e ROAS.
- **Do anúncio à venda:** impressões → cliques → leads no CRM → qualificados → visitas → vendas, com custo por lead e por lead qualificado *reais* (do CRM, não da plataforma).
- Evolução diária (barras + linhas), painéis Meta Ads e Google Ads com resultados por dia da semana, CPC e CPM médios, e tabela de campanhas ordenável com variação de cada métrica.
- **Como entram os números:** botão *Importar* → envie o CSV exportado do Google Ads (segmentado por Dia) ou do Meta Ads (detalhado por Dia). Reimportar o mesmo período atualiza, não duplica. Sem dados importados, a tela mostra números de exemplo com aviso.
- **Contas dos clientes (conexão direta):** botão *Contas conectadas* → cadastre o ID de cada conta do Google Ads (ex.: 123-456-7890) e do Meta (act_…), ligue ao cliente da Cobrança e clique em *Sincronizar*. A função `ads-sync` puxa os últimos 30 dias por campanha, inclusive vídeo (visualizações e retenção 25/50/75/100%). Credenciais no Supabase → Secrets:
  - Google Ads: `GOOGLE_ADS_DEVELOPER_TOKEN` (da MCC, acesso básico aprovado), `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` (gerado com o usuário da MCC), `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (ID da MCC). Opcional: `GOOGLE_ADS_API_VERSION` (padrão v21).
  - Meta Ads: `META_ADS_TOKEN` (usuário do sistema do Gerenciador de Negócios com `ads_read` nas contas dos clientes).
  - O filtro *Todos os clientes* junta as contas Google e Meta do mesmo cliente.
- **Ligação com o CRM:** pelo nome da campanha. No Google Ads use `utm_campaign={campaignname}` (ou o mesmo nome) no sufixo de URL; no Meta, `utm_campaign={{campaign.name}}`. Os leads dos formulários do Meta já chegam com o nome da campanha.

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

**Agente de voz ElevenLabs (padrão desde 25/10/2026):** o modo voz do chat conversa em tempo real com o agente **"danova AI · Atendente por voz"** (`agent_9101m5t5g6gfe0ns594fy3v2b3dn`) na conta ElevenLabs. Ele ouve, responde com Claude (claude-sonnet-5-5) e fala com voz ElevenLabs, em PT/EN/ES (troca de idioma automática). Ao receber nome + WhatsApp ou e-mail, a ferramenta `registrar_lead` grava o lead direto no CRM (RPC `enviar_lead`, origem `agente_voz_elevenlabs`). O que o cliente e a assistente falam aparece como texto no chat. O ID fica em `js/crm-config.js` (`elevenAgentId`); deixe `""` para voltar ao modo abaixo. A biblioteca (`js/vendor/elevenlabs-client-1.27.0.min.js`, ~620 KB) só é baixada quando alguém abre o modo voz. Prompt, voz e base de conhecimento se editam no painel do ElevenLabs (Agents). Se o agente não conectar, o site usa automaticamente o modo abaixo.

**Modo de voz alternativo (fala → texto → IA → fala):** no chat do site, o botão de ondas no topo abre o modo voz: o cliente toca no círculo, fala, a IA (Claude) responde e a resposta é falada; com *Conversa contínua* ligado, volta a ouvir sozinho, e tocar enquanto a IA fala interrompe. O microfone ao lado do campo de texto dita a mensagem, e cada resposta tem 🔊 para ouvir. Função `voz` (supabase/functions/voz):
- **Fala → texto:** Whisper, se houver `OPENAI_API_KEY` nos Secrets; sem ela, o reconhecimento do próprio navegador (Chrome, Edge, Safari).
- **Texto → fala:** ElevenLabs, se houver `ELEVENLABS_API_KEY` (opcional `ELEVENLABS_VOZ_ID` para escolher a voz e `ELEVENLABS_MODELO`, padrão `eleven_flash_v2_5`); sem ela, a voz do sistema do navegador.
- Limites: 40 usos de voz por IP por hora e 600 no site todo; texto falado até 700 caracteres; áudio até ~25 s.
- O microfone só funciona em site com HTTPS (Vercel/Hostinger com SSL) ou no arquivo aberto no computador; dentro do artifact o navegador pode bloquear.

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

## Publicar na Vercel

O repositório já vem pronto para a Vercel (`vercel.json`, `.vercelignore` e `api/lead.js`):

1. Em vercel.com → **Add New… → Project**, importe o repositório `Henrickpj2/Site-danova-projeto-final`.
2. Deixe *Framework Preset* em **Other** e clique em **Deploy** (não há build; o site publicado é a pasta `public_html`).
3. O receptor de leads roda como função (`api/lead.js`): encaminha ao CRM os formulários que não gravam direto (livro etc.). Para receber o aviso por e-mail, crie em *Settings → Environment Variables* a `RESEND_API_KEY` (resend.com, com o domínio danova-ai.com verificado). Opcionais: `LEAD_TO`, `LEAD_FROM`.
4. Para usar o domínio: *Settings → Domains* → `danova-ai.com` e siga os registros DNS indicados.
5. No Supabase → Authentication → URL Configuration, acrescente em **Redirect URLs** o endereço da Vercel (ex.: `https://SEU-PROJETO.vercel.app/crm/*`); se o domínio principal for a Vercel, troque também a **Site URL**.

## Publicar na Hostinger

Envie o conteúdo de `public_html/` para a pasta `public_html` do domínio (Gerenciador de Arquivos ou FTP). Se já existir um `.htaccess`, mantenha o antigo e cole o bloco novo no topo.

## Editar o site

Os textos e estilos ficam em `fonte/`. Depois de editar:

```sh
python3 fonte/build.py        # gera public_html/index.html
sh fonte/montar-localizador.sh # gera public_html/js/danova-localizador.js
```
