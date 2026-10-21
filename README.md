# danova AI — site + CRM

Posicionamento (21/10/2026): tráfego pago imobiliário há 10 anos — Meta Ads e Google Ads para empreendimentos de alto padrão. O topo do site tem o **Localizador de empreendimentos** (orçamento, objetivo e região → mapa e resultados por compatibilidade), que também dispara os eventos `localizador_busca` e `localizador_enviar` no dataLayer para otimizar campanhas.

Site institucional da danova AI (atualizado em 20/10/2026) com área de membros para acompanhar leads, corretores e o andamento de cada negociação.

```
public_html/        → tudo o que vai para a Hostinger (pasta public_html)
  index.html        → site
  crm/              → área de membros (https://danova-ai.com/crm/)
  api/lead.php      → recebe formulários, envia e-mail, grava CSV e encaminha ao CRM
  js/crm-config.js  → endereço do banco e chave pública
  js/danova-localizador.js → localizador de empreendimentos do topo (filtros + mapa)
  js/danova-chat.js → chat do atendente de IA
fonte/              → arquivos-fonte (build.py gera o index.html; montar-localizador.sh gera o localizador)
supabase/schema.sql → estrutura completa do banco do CRM
supabase/functions/ → atendente do site e agente do CRM (IA)
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
