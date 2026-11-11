# DANOVA Marketing Intelligence — instalação, configuração e manutenção

Plataforma própria da DANOVA que conecta contas Meta Ads de vários clientes, extrai métricas automaticamente e permite gerenciar campanhas, usando a **Meta Marketing API**.

- **Onde fica:** CRM (`danova-ai.com/crm`) → menu **◆ Marketing Intelligence**. Rota: `#marketing`.
- **Quem acessa:** o admin vê todos os clientes; o cliente (papel `construtora`) vê só a tela **Minhas contas de anúncios** e os dados dele.

## 1. Arquitetura

| Camada | O que é |
|---|---|
| Frontend | `public_html/crm/crm-marketing.js` (+ estilos `.mi-*` em `crm.css` / `crm-v1.css`) |
| Banco | migração `supabase/migracoes/2026-11-11-marketing-intelligence.sql` |
| Núcleo | Edge Function `meta-mi`: OAuth, AES-256-GCM, Graph API, sincronização, dashboard, gestão, auditoria |
| Funções públicas | `meta-oauth-start`, `meta-oauth-callback`, `meta-list-accounts`, `meta-select-account`, `meta-sync-campaigns`, `meta-sync-insights`, `meta-get-dashboard`, `meta-manage-campaign`, `meta-disconnect`, `meta-token-refresh`, `meta-sync-all`. Cada uma repassa para o `meta-mi`, que concentra toda a validação. |
| Agendamento | `pg_cron`: `meta-mi-sync` a cada 30 min e `meta-mi-tokens` todo dia às 05:15 (BRT) |

As tabelas de clientes e de papéis continuam sendo as atuais: `contas` e `membros`. Para leitura com os nomes do projeto existem as visões `danova_clients` e `danova_user_roles`.

## 2. Tabelas

- **`meta_connections`**: um Facebook autorizado.
  - O token fica **cifrado** (`token_cifrado`, AES-256-GCM). O navegador **não lê esta tabela**.
  - Os metadados ficam visíveis pela visão `meta_connections_publico`.
- **`meta_ad_accounts`**: contas de anúncios vinculadas.
  - Uma conta (`act_id`) pertence a um único cliente.
  - Tem uma trava (`sync_lock`) que impede duas sincronizações simultâneas da mesma conta.
- **`meta_campaigns`, `meta_adsets` e `meta_ads`**: estrutura e status das campanhas, com orçamentos já convertidos de centavos.
- **`meta_insights_daily`**: uma linha por dia × nível (`campaign`, `adset`, `ad`) × objeto.
  - Guarda impressões, alcance, frequência, cliques, cliques no link, investimento, CPC, CPM, CTR, leads, conversões, resultados, custo por resultado e as `acoes` brutas.
  - Os leads são contados pelo **primeiro** tipo de lead disponível, para não contar duas vezes o mesmo lead (`lead` e `offsite_conversion.fb_pixel_lead`). As conversões (compra, cadastro, agendamento, contato) ficam separadas.
  - **O alcance não é somado** entre campanhas nem entre dias.
- **`meta_sync_logs`**: cada sincronização, com status, linhas e erro.
- **`meta_audit_logs`**: toda alteração de campanha, com quem fez, o antes e depois e o resultado.

**RLS:**
- O admin lê tudo.
- O cliente lê só as linhas com `conta_id` igual à empresa dele.
- O corretor não lê nada.
- Ninguém escreve pelo navegador; só as Edge Functions gravam.
- O `conta_id` das campanhas e métricas é herdado da conta de anúncios por gatilho, sem depender do código.
- O papel do usuário fica em `membros`, que o usuário não consegue alterar.

## 3. Variáveis (Supabase → Edge Functions → Secrets)

| Nome | Obrigatória | Valor |
|---|---|---|
| `META_APP_ID` | sim | `1079543821771475` (já cadastrada) |
| `META_APP_SECRET` | sim | Chave secreta do app (já cadastrada; **redefina** se ela tiver aparecido em algum print) |
| `META_TOKEN_ENCRYPTION_KEY` | **sim (falta)** | Texto aleatório com **32 caracteres ou mais**. A chave AES-256 é derivada por SHA-256. **Não troque depois**, senão os tokens salvos deixam de abrir e todos precisam reconectar. |
| `META_GRAPH_API_VERSION` | não | Padrão `v23.0` |
| `META_REDIRECT_URI` | não | Padrão `https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/meta-oauth-callback` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | automáticas | Já existem. A chave anon é pública e respeita a RLS. **A Service Role Key nunca vai para o navegador.** |

## 4. Checklist no Meta for Developers (app DANOVA-AI → renomear para "DANOVA Marketing Intelligence")

1. **Configurações do app → Básico**
   - Nome de exibição: DANOVA Marketing Intelligence.
   - Domínios: `danova-ai.com` e `oeylfwasqvbnybzrwtgf.supabase.co`.
   - Política, termos e exclusão de dados: já preenchidos.
2. **Login do Facebook para Empresas → Configurações**
   - Adicione em **URIs de redirecionamento do OAuth válidos**: `https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/meta-oauth-callback`. Mantenha também a URI antiga do `meta-conectar`.
   - Deixe **Login no OAuth do cliente** e **Login do OAuth na Web** em **Sim**.
3. **Casos de uso → Criar e gerenciar anúncios com a API de Marketing**
   - Adicione `ads_read`, `ads_management` e `business_management`.
4. **Verificação da empresa** (Gerenciador DANOVA 1832034764582835 → Central de segurança → Iniciar verificação)
   - Sem ela, a Meta mantém **"API access blocked"**.
5. **Acesso à Marketing API**
   - Peça o **Ads Management Standard Access**.
   - Para clientes externos, envie a **Análise do App** pedindo **Advanced Access** a `ads_read`, `ads_management` e `business_management`, com vídeo de demonstração do fluxo: conectar → selecionar conta → painel → pausar campanha com confirmação.
6. Enquanto a Análise não sai, o app fica em **modo de desenvolvimento**. Só quem tem função no app (administrador, desenvolvedor ou testador) consegue conectar.

## 5. Fluxo de conexão

1. **Conectar minha conta Meta Ads**: o `meta-oauth-start` gera um state aleatório de uso único (válido por 15 min) e manda o usuário para a autorização oficial da Meta.
2. O `meta-oauth-callback` faz o seguinte:
   - valida o state;
   - troca o código por um token e depois pelo token de longa duração;
   - valida com `debug_token` (app correto, token válido, `ads_read` concedido);
   - cifra o token e salva em `meta_connections`.
3. **Selecionar conta**: o `meta-list-accounts` busca `/me/adaccounts` e as contas próprias e de clientes dos Gerenciadores. O `meta-select-account` vincula as contas escolhidas ao cliente e dispara a primeira sincronização (30 dias).
4. **Proteções:**
   - um cliente não consegue tomar para si a conta de outro;
   - o admin escolhe o cliente dono.

## 6. Sincronização

- **A cada 30 minutos:** campanhas, conjuntos e anúncios, mais as métricas de hoje e ontem nos três níveis.
- **Uma vez por dia:** reprocessa os últimos 7 dias, porque a Meta ajusta números retroativos.
- **Primeira sincronização:** 30 dias.
- **Tratamento de erros:**
  - paginação até 50 páginas;
  - retentativa progressiva (1s, 3s e 9s) para limites e erros temporários;
  - pausa quando o uso da API passa de 90%;
  - token inválido marca a conexão como **Reconectar**;
  - cada rodada respeita até 120s e continua na próxima.
- **Tokens:** verificação diária; tenta renovar quando faltam menos de 10 dias para vencer. Se a Meta não renovar, a conexão aparece como **Expirando**.

## 7. Gerenciamento de campanhas (só admin)

- Ações: **Status**, **Pausar**, **Ativar** e **Orçamento**, em campanhas e conjuntos.
- Toda ação pede confirmação, confere a permissão `ads_management` da conexão, envia à Meta, lê o estado de volta e grava em `meta_audit_logs`.
- Clientes não têm acesso a nenhuma operação de escrita.
- **Não liberar para clientes externos antes da aprovação da Meta.**

## 8. Publicação

- **Frontend:** o push no GitHub publica na Hostinger por FTP (`enviar-ftp-hostinger.yml`).
- **Banco e funções:** já aplicados no projeto `oeylfwasqvbnybzrwtgf`. Para republicar uma função, use `supabase functions deploy <nome> --no-verify-jwt`; todas validam o login por conta própria.
- **Caminho antigo:** a importação pelo **Make** e a tela **Meus anúncios** continuam funcionando, sem mudança.

## 9. Manutenção

- **Erros de sincronização:** aba Histórico de alterações → Sincronizações, ou a tabela `meta_sync_logs`.
- **Conexão "Reconectar":** o dono clica em Reconectar.
- **Nova versão da Graph API:** mude o secret `META_GRAPH_API_VERSION`.
- **Ver os agendamentos:** `select * from cron.job where jobname like 'meta-mi%';`
- **Capacidade:** planejado para 100 contas. Com mais que isso, aumente a frequência do cron ou divida as contas em lotes.

## 10. Relatório de testes (11/11/2026)

### Aprovados
| Teste | Resultado |
|---|---|
| RLS: corretor lê contas/métricas | 0 linhas ✓ |
| RLS: admin lê contas/métricas | 1 / 1 ✓ |
| RLS: navegador lê `meta_connections` (token) | bloqueado ("permission denied") ✓ |
| Gatilho herda `conta_id` da conta de anúncios | ✓ |
| `mi_dashboard` (agregados) | CPC 1, CPM 20, CTR 2%, custo/lead 20 ✓ |
| Funções sem login | 401 ✓ |
| Token interno errado | rejeitado ✓ |
| Callback com state inválido | volta ao CRM com `retorno_invalido` ✓ |
| `token_refresh` sem conexões | `verificadas: 0` ✓ |
| AES-256-GCM: cifra diferente a cada vez, sem texto aberto, decifra certo | ✓ |
| Chave errada / chave curta | rejeitada / bloqueada (`chave_cripto_ausente`) ✓ |
| Leads sem contagem dupla; conversões; custo/resultado; valor | 1 lead, 1 conversão, 8,88, 900 ✓ |
| Tela no CRM (admin e cliente), filtros, CSV, confirmação nas ações | ✓ (com dados de teste locais, nunca em produção) |
| Funcionalidades antigas (Meus anúncios, Make, Google Ads, e-mails) | sem alteração ✓ |

### Bloqueados (dependem de ação na Meta / secrets)
| Teste | Motivo |
|---|---|
| Conexão OAuth real | falta `META_TOKEN_ENCRYPTION_KEY` e a URI do callback no app |
| Listar contas e extrair métricas reais | Meta responde "API access blocked" até a verificação da empresa e o acesso à Marketing API |
| Pausar/ativar/orçamento real | exige `ads_management` aprovado |

**Status:** implementação concluída; **integração não considerada concluída** até a conexão real e a extração de métricas serem testadas com sucesso.
