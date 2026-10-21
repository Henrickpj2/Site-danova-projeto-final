# danova AI — site + CRM

Site institucional da danova AI (atualizado em 20/10/2026) com área de membros para acompanhar leads, corretores e o andamento de cada negociação.

```
public_html/        → tudo o que vai para a Hostinger (pasta public_html)
  index.html        → site
  crm/              → área de membros (https://danova-ai.com/crm/)
  api/lead.php      → recebe formulários, envia e-mail, grava CSV e encaminha ao CRM
  js/crm-config.js  → endereço do banco e chave pública
  js/danova-globe.js→ globo interativo do topo
fonte/              → arquivos-fonte usados para gerar index.html e o globo
supabase/schema.sql → estrutura completa do banco do CRM
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
sh fonte/montar-globo.sh      # gera public_html/js/danova-globe.js
```
