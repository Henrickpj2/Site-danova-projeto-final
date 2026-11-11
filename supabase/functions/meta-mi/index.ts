// DANOVA Marketing Intelligence — núcleo da integração própria com a Meta Marketing API.
// As 11 funções públicas (meta-oauth-start, meta-oauth-callback, meta-list-accounts, meta-select-account,
// meta-sync-campaigns, meta-sync-insights, meta-get-dashboard, meta-manage-campaign, meta-disconnect,
// meta-token-refresh, meta-sync-all) repassam para cá com { acao }. Um só código = uma só regra de segurança.
//
// Secrets: META_APP_ID, META_APP_SECRET, META_TOKEN_ENCRYPTION_KEY (obrigatória para guardar tokens),
//          META_GRAPH_API_VERSION (padrão v23.0), META_REDIRECT_URI (padrão .../functions/v1/meta-oauth-callback).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// deno-lint-ignore no-explicit-any
type Db = any; type Row = Record<string, any>;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token-interno, x-mi-acao" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const VER = () => env("META_GRAPH_API_VERSION") || env("META_GRAPH_VERSION") || "v23.0";
const BASE = () => env("SUPABASE_URL");
const REDIRECT = () => env("META_REDIRECT_URI") || BASE() + "/functions/v1/meta-oauth-callback";
const CRM = "https://danova-ai.com/crm/";
const ESC_LEITURA = ["ads_read", "business_management"];
const ESC_GESTAO = ["ads_read", "ads_management", "business_management"];
const agoraISO = () => new Date().toISOString();
const segundoPlano = (p: Promise<unknown>) => { try { if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p); else p.catch(() => {}); } catch { p.catch(() => {}); } };

// ---------- AES-256-GCM ----------
async function chave() {
  const s = env("META_TOKEN_ENCRYPTION_KEY");
  if (s.length < 32) throw new Error("chave_cripto_ausente");
  const bruto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.importKey("raw", bruto, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function cifrar(texto: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), new TextEncoder().encode(texto)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return "v1:" + b64(out);
}
async function decifrar(c: string) {
  const u = deB64(String(c).replace(/^v1:/, ""));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, await chave(), u.slice(12)));
}

// ---------- Graph API: retentativa progressiva, limites e paginação ----------
class ErroMeta extends Error { codigo: number; token: boolean; constructor(m: string, c = 0) { super(m); this.codigo = c; this.token = c === 190 || c === 102 || c === 463 || c === 467; } }
const TRANSITORIOS = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
async function graph(caminho: string, token: string, params: Record<string, unknown> = {}, metodo = "GET"): Promise<Row> {
  const url = caminho.startsWith("http") ? new URL(caminho) : new URL(`https://graph.facebook.com/${VER()}/${caminho.replace(/^\//, "")}`);
  const corpo = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) (metodo === "GET" ? url.searchParams : corpo).set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  if (!url.searchParams.has("access_token")) (metodo === "GET" ? url.searchParams : corpo).set("access_token", token);
  let ultimo: ErroMeta | null = null;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    if (tentativa) await new Promise((r) => setTimeout(r, 1000 * Math.pow(3, tentativa - 1)));
    let r: Response;
    try { r = await fetch(url, metodo === "GET" ? { signal: AbortSignal.timeout(30000) } : { method: metodo, body: corpo, signal: AbortSignal.timeout(30000) }); }
    catch (e) { ultimo = new ErroMeta("rede: " + String((e as Error).message || e)); continue; }
    const j = await r.json().catch(() => ({}));
    const uso = r.headers.get("x-business-use-case-usage") || r.headers.get("x-ad-account-usage") || "";
    if (r.ok && !j.error) { if (/"(call_count|total_cputime|total_time|acc_id_util_pct)":(9\d|100)/.test(uso)) j.__limite = true; return j; }
    const e = j.error || {};
    ultimo = new ErroMeta(String(e.error_user_msg || e.message || "HTTP " + r.status).slice(0, 400), Number(e.code) || 0);
    if (ultimo.token || !(TRANSITORIOS.has(ultimo.codigo) || r.status >= 500)) break;
  }
  throw ultimo || new ErroMeta("falha");
}
async function paginar(caminho: string, token: string, params: Record<string, unknown>, maxPaginas = 50) {
  const itens: Row[] = []; let j = await graph(caminho, token, params);
  for (let p = 0; p < maxPaginas; p++) {
    itens.push(...(j.data || []));
    const prox = j.paging?.next; if (!prox || j.__limite) break;
    j = await graph(prox, token);
  }
  return itens;
}
const appToken = () => `${env("META_APP_ID")}|${env("META_APP_SECRET")}`;

// ---------- autenticação ----------
async function usuario(req: Request, db: Db) {
  const cli = createClient(BASE(), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await cli.auth.getUser();
  if (!u?.user) return null;
  const { data: m } = await db.from("membros").select("id, nome, papel, conta_id, ativo").eq("id", u.user.id).maybeSingle();
  if (!m?.ativo) return null;
  return { id: m.id as string, nome: m.nome as string, admin: m.papel === "admin", cliente: m.papel === "construtora" ? (m.conta_id as string | null) : null, papel: m.papel as string, cli };
}
type Quem = NonNullable<Awaited<ReturnType<typeof usuario>>>;
const podeConexao = (q: Quem, c: Row) => q.admin || c.membro_id === q.id || (q.cliente && c.conta_id === q.cliente);
const podeConta = (q: Quem, a: Row) => q.admin || (q.cliente && a.conta_id === q.cliente);

async function tokenDaConexao(db: Db, connectionId: string) {
  const { data: c } = await db.from("meta_connections").select("*").eq("id", connectionId).maybeSingle();
  if (!c) throw new Error("conexao_nao_encontrada");
  if (c.status === "desconectada") throw new Error("conexao_desconectada");
  return { c, token: await decifrar(c.token_cifrado) };
}
async function marcarTokenInvalido(db: Db, connectionId: string, msg: string) {
  await db.from("meta_connections").update({ status: "reautorizar", ultimo_erro: msg.slice(0, 300), atualizado_em: agoraISO() }).eq("id", connectionId);
}

// ---------- conversão das métricas ----------
const TIPOS_LEAD = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d"];
const TIPOS_CONV = ["offsite_conversion.fb_pixel_purchase", "purchase", "onsite_web_purchase", "offsite_conversion.fb_pixel_complete_registration", "complete_registration", "offsite_conversion.fb_pixel_schedule", "schedule", "submit_application", "offsite_conversion.fb_pixel_contact", "contact_total"];
const TIPOS_VALOR = ["offsite_conversion.fb_pixel_purchase", "purchase", "onsite_web_purchase"];
const soma = (lista: Row[] | undefined, tipos: string[]) => (lista || []).filter((a) => tipos.includes(a.action_type)).reduce((t, a) => t + Number(a.value || 0), 0);
const primeiro = (lista: Row[] | undefined, tipos: string[]) => { for (const t of tipos) { const v = soma(lista, [t]); if (v) return v; } return 0; };
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const dinheiro = (v: unknown) => v === undefined || v === null || v === "" ? null : Math.round(n(v)) / 100; // orçamentos vêm em centavos

function linhaInsight(r: Row, nivel: string, accId: string) {
  const leads = primeiro(r.actions, TIPOS_LEAD), conv = soma(r.actions, TIPOS_CONV), custo = Math.round(n(r.spend) * 100) / 100;
  const objeto = nivel === "campaign" ? r.campaign_id : nivel === "adset" ? r.adset_id : r.ad_id;
  const nome = nivel === "campaign" ? r.campaign_name : nivel === "adset" ? r.adset_name : r.ad_name;
  const resultados = leads + conv;
  return {
    ad_account_id: accId, nivel, objeto_id: String(objeto || ""), data: String(r.date_start).slice(0, 10),
    campaign_id: r.campaign_id || null, adset_id: r.adset_id || null, ad_id: r.ad_id || null, nome: String(nome || "Sem nome").slice(0, 300), moeda: r.account_currency || null,
    impressoes: n(r.impressions), alcance: r.reach != null ? n(r.reach) : null, frequencia: r.frequency != null ? n(r.frequency) : null,
    cliques: n(r.clicks), cliques_link: n(r.inline_link_clicks), custo, cpc: r.cpc != null ? n(r.cpc) : null, cpm: r.cpm != null ? n(r.cpm) : null, ctr: r.ctr != null ? n(r.ctr) : null,
    leads, conversoes: conv, resultados, custo_resultado: resultados ? Math.round(custo / resultados * 100) / 100 : null,
    valor_conversoes: Math.round(soma(r.action_values, TIPOS_VALOR) * 100) / 100, acoes: r.actions || [], atualizado_em: agoraISO(),
  };
}
const diaBRT = (deslocDias = 0) => new Date(Date.now() - 3 * 3600e3 + deslocDias * 864e5).toISOString().slice(0, 10);

// ---------- sincronização de uma conta ----------
async function sincronizar(db: Db, accId: string, opcoes: { campanhas?: boolean; insights?: boolean; dias?: number }) {
  const limiteLock = new Date(Date.now() - 10 * 60e3).toISOString();
  const { data: acc } = await db.from("meta_ad_accounts").update({ sync_lock: agoraISO() }).eq("id", accId).eq("ativo", true)
    .or(`sync_lock.is.null,sync_lock.lt.${limiteLock}`).select("*").maybeSingle();
  if (!acc) return { ignorada: true, motivo: "em_andamento_ou_inativa" };
  const res: Row = { campanhas: 0, conjuntos: 0, anuncios: 0, insights: 0 };
  let log: Row | null = null;
  try {
    if (!acc.connection_id) throw new Error("sem_conexao");
    const { token } = await tokenDaConexao(db, acc.connection_id);
    const act = "act_" + acc.act_id;
    const { data: lg } = await db.from("meta_sync_logs").insert({ ad_account_id: acc.id, connection_id: acc.connection_id, tipo: [opcoes.campanhas && "campanhas", opcoes.insights && "insights"].filter(Boolean).join("+"), status: "executando" }).select("id").single();
    log = lg;
    if (opcoes.campanhas) {
      const camps = await paginar(`${act}/campaigns`, token, { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,updated_time", limit: 200 });
      const linhasC = camps.map((c) => ({ id: c.id, ad_account_id: acc.id, nome: c.name, status: c.status, effective_status: c.effective_status, objetivo: c.objective, orcamento_diario: dinheiro(c.daily_budget), orcamento_total: dinheiro(c.lifetime_budget), inicio: c.start_time || null, fim: c.stop_time || null, atualizado_meta: c.updated_time || null, sincronizado_em: agoraISO() }));
      for (let i = 0; i < linhasC.length; i += 500) { const { error } = await db.from("meta_campaigns").upsert(linhasC.slice(i, i + 500)); if (error) throw new Error("banco: " + error.message); }
      const sets = await paginar(`${act}/adsets`, token, { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,updated_time", limit: 200 });
      const linhasS = sets.map((s) => ({ id: s.id, ad_account_id: acc.id, campaign_id: s.campaign_id, nome: s.name, status: s.status, effective_status: s.effective_status, orcamento_diario: dinheiro(s.daily_budget), orcamento_total: dinheiro(s.lifetime_budget), otimizacao: s.optimization_goal, atualizado_meta: s.updated_time || null, sincronizado_em: agoraISO() }));
      for (let i = 0; i < linhasS.length; i += 500) { const { error } = await db.from("meta_adsets").upsert(linhasS.slice(i, i + 500)); if (error) throw new Error("banco: " + error.message); }
      const ads = await paginar(`${act}/ads`, token, { fields: "id,name,campaign_id,adset_id,status,effective_status,updated_time", limit: 200 });
      const linhasA = ads.map((a) => ({ id: a.id, ad_account_id: acc.id, campaign_id: a.campaign_id, adset_id: a.adset_id, nome: a.name, status: a.status, effective_status: a.effective_status, atualizado_meta: a.updated_time || null, sincronizado_em: agoraISO() }));
      for (let i = 0; i < linhasA.length; i += 500) { const { error } = await db.from("meta_ads").upsert(linhasA.slice(i, i + 500)); if (error) throw new Error("banco: " + error.message); }
      Object.assign(res, { campanhas: linhasC.length, conjuntos: linhasS.length, anuncios: linhasA.length });
      await db.from("meta_ad_accounts").update({ ultima_sync_campanhas: agoraISO() }).eq("id", acc.id);
    }
    if (opcoes.insights) {
      const dias = Math.min(Math.max(opcoes.dias || 2, 1), 90);
      const faixa = { since: diaBRT(-(dias - 1)), until: diaBRT(0) };
      const campos = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,impressions,reach,frequency,clicks,inline_link_clicks,spend,cpc,cpm,ctr,actions,action_values,account_currency";
      for (const nivel of ["campaign", "adset", "ad"]) {
        const brutas = await paginar(`${act}/insights`, token, { level: nivel, time_increment: 1, time_range: faixa, fields: campos, limit: 500, use_account_attribution_setting: true });
        const linhas = brutas.map((r) => linhaInsight(r, nivel, acc.id)).filter((l) => l.objeto_id && /^\d{4}-\d{2}-\d{2}$/.test(l.data));
        for (let i = 0; i < linhas.length; i += 500) { const { error } = await db.from("meta_insights_daily").upsert(linhas.slice(i, i + 500), { onConflict: "nivel,objeto_id,data" }); if (error) throw new Error("banco: " + error.message); }
        res.insights += linhas.length;
      }
      if (dias >= 7) await db.from("meta_ad_accounts").update({ ultima_consolidacao: diaBRT(0) }).eq("id", acc.id);
    }
    await db.from("meta_ad_accounts").update({ ultima_sync: agoraISO(), ultimo_erro: null, primeira_sync_feita: true }).eq("id", acc.id);
    if (log) await db.from("meta_sync_logs").update({ status: "ok", linhas: res.campanhas + res.conjuntos + res.anuncios + res.insights, detalhe: JSON.stringify(res), fim: agoraISO() }).eq("id", log.id);
    return { ok: true, ...res };
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 400);
    if (e instanceof ErroMeta && e.token && acc.connection_id) await marcarTokenInvalido(db, acc.connection_id, msg);
    await db.from("meta_ad_accounts").update({ ultimo_erro: msg }).eq("id", acc.id);
    if (log) await db.from("meta_sync_logs").update({ status: "erro", detalhe: msg, fim: agoraISO() }).eq("id", log.id);
    else await db.from("meta_sync_logs").insert({ ad_account_id: acc.id, connection_id: acc.connection_id, tipo: "sync", status: "erro", detalhe: msg, fim: agoraISO() });
    return { ok: false, erro: msg };
  } finally {
    await db.from("meta_ad_accounts").update({ sync_lock: null }).eq("id", accId);
  }
}

async function sincronizarTodas(db: Db) {
  const inicio = Date.now();
  const { data: contas } = await db.from("meta_ad_accounts").select("id, primeira_sync_feita, ultima_consolidacao, ultima_sync").eq("ativo", true).not("connection_id", "is", null).order("ultima_sync", { ascending: true, nullsFirst: true }).limit(100);
  let feitas = 0;
  for (const a of (contas || []) as Row[]) {
    if (Date.now() - inicio > 120e3) break; // fica para a próxima rodada
    if (a.ultima_sync && Date.now() - Date.parse(a.ultima_sync) < 20 * 60e3) continue;
    const dias = !a.primeira_sync_feita ? 30 : (a.ultima_consolidacao !== diaBRT(0) ? 7 : 2);
    await sincronizar(db, a.id, { campanhas: true, insights: true, dias });
    feitas++;
  }
  return feitas;
}

async function verificarTokens(db: Db) {
  const { data: cs } = await db.from("meta_connections").select("*").in("status", ["ativa", "expirando", "erro"]);
  let ok = 0, renovados = 0, problemas = 0;
  for (const c of (cs || []) as Row[]) {
    try {
      const token = await decifrar(c.token_cifrado);
      const dbg = (await graph("debug_token", appToken(), { input_token: token })).data || {};
      if (!dbg.is_valid) { await marcarTokenInvalido(db, c.id, "Token inválido ou revogado na Meta. Reconecte."); problemas++; continue; }
      let expira = dbg.expires_at ? new Date(dbg.expires_at * 1000) : (dbg.data_access_expires_at ? new Date(dbg.data_access_expires_at * 1000) : null);
      const upd: Row = { verificada_em: agoraISO(), escopos: dbg.scopes || c.escopos, status: "ativa", ultimo_erro: null };
      if (expira && expira.getTime() - Date.now() < 10 * 864e5) {
        try {
          const novo = await graph("oauth/access_token", "", { grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: token, access_token: appToken() });
          if (novo.access_token) { upd.token_cifrado = await cifrar(novo.access_token); expira = novo.expires_in ? new Date(Date.now() + novo.expires_in * 1000) : expira; renovados++; }
        } catch { /* a Meta nem sempre renova; avisa para reconectar */ }
        if (expira && expira.getTime() - Date.now() < 10 * 864e5) { upd.status = "expirando"; upd.ultimo_erro = "O acesso vence em " + expira.toLocaleDateString("pt-BR") + ". Reconecte para não interromper."; }
      }
      if (expira) upd.expira_em = expira.toISOString();
      upd.atualizado_em = agoraISO();
      await db.from("meta_connections").update(upd).eq("id", c.id); ok++;
    } catch (e) {
      problemas++;
      await db.from("meta_connections").update({ status: "erro", ultimo_erro: String((e as Error).message || e).slice(0, 300), verificada_em: agoraISO() }).eq("id", c.id);
    }
  }
  return { verificadas: ok, renovadas: renovados, problemas };
}

const voltarCRM = (q: string) => new Response(null, { status: 302, headers: { Location: CRM + "#marketing?" + q } });

// ---------- servidor ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(BASE(), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // retorno da Meta (meta-oauth-callback repassa o GET)
  if (req.method === "GET") {
    const u = new URL(req.url), code = u.searchParams.get("code"), estado = u.searchParams.get("state") || "";
    const { data: est } = /^[a-f0-9]{48}$/.test(estado)
      ? await db.from("oauth_estados").delete().eq("estado", estado).eq("provedor", "meta-mi").select("usuario, criado_em, dados").maybeSingle() : { data: null };
    if (u.searchParams.get("error")) return voltarCRM("meta=cancelado");
    if (!code || !est) return voltarCRM("meta=erro&motivo=retorno_invalido");
    if (Date.now() - Date.parse(est.criado_em) > 15 * 60e3) return voltarCRM("meta=erro&motivo=expirou");
    const { data: m } = await db.from("membros").select("id, papel, conta_id, ativo").eq("id", est.usuario).maybeSingle();
    if (!m?.ativo) return voltarCRM("meta=erro&motivo=usuario_inativo");
    try {
      const curto = await graph("oauth/access_token", "", { client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), redirect_uri: REDIRECT(), code, access_token: appToken() });
      const longo = await graph("oauth/access_token", "", { grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: curto.access_token, access_token: appToken() });
      const tk = String(longo.access_token || curto.access_token);
      const dbg = (await graph("debug_token", appToken(), { input_token: tk })).data || {};
      if (!dbg.is_valid || String(dbg.app_id) !== env("META_APP_ID")) throw new Error("token_invalido");
      const escopos: string[] = dbg.scopes || [];
      if (!escopos.includes("ads_read")) return voltarCRM("meta=erro&motivo=" + encodeURIComponent("Permissão ads_read não concedida. Conecte de novo e aceite todas as permissões."));
      const eu = await graph("me", tk, { fields: "id,name" });
      const contaDestino = m.papel === "admin" ? (est.dados?.conta_id || null) : m.conta_id;
      const expira = longo.expires_in ? new Date(Date.now() + Number(longo.expires_in) * 1000).toISOString() : (dbg.expires_at ? new Date(dbg.expires_at * 1000).toISOString() : null);
      const { data: cx, error } = await db.from("meta_connections").upsert({
        membro_id: m.id, conta_id: contaDestino, meta_user_id: String(eu.id), meta_user_name: eu.name, token_cifrado: await cifrar(tk),
        escopos, expira_em: expira, status: "ativa", ultimo_erro: null, verificada_em: agoraISO(), atualizado_em: agoraISO(),
      }, { onConflict: "membro_id,meta_user_id" }).select("id").single();
      if (error) throw new Error("banco: " + error.message);
      return voltarCRM("meta=ok&conexao=" + cx.id);
    } catch (e) {
      console.error("meta-mi callback", e);
      return voltarCRM("meta=erro&motivo=" + encodeURIComponent(String((e as Error).message || e).slice(0, 140)));
    }
  }
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  let corpo: Row = {}; try { corpo = await req.json(); } catch { /* vazio */ }
  const acao = String(corpo.acao || req.headers.get("x-mi-acao") || "");

  // tarefas programadas (pg_cron) — token interno
  const interno = req.headers.get("x-token-interno");
  if (interno) {
    const { data: valido } = await db.rpc("validar_token_interno", { nome: "meta-mi", token: interno });
    if (!valido) return json({ erro: "token" }, 401);
    if (acao === "sync_all") { segundoPlano(sincronizarTodas(db)); return json({ ok: true, iniciado: true }, 202); }
    if (acao === "token_refresh") return json(await verificarTokens(db));
    return json({ erro: "acao_invalida" }, 400);
  }

  const q = await usuario(req, db);
  if (!q) return json({ erro: "nao_autenticado" }, 401);
  if (!q.admin && !q.cliente) return json({ erro: q.papel === "construtora" ? "sem_conta_vinculada" : "sem_acesso" }, 403);

  try {
    switch (acao) {
      case "oauth_start": {
        if (!env("META_APP_ID") || !env("META_APP_SECRET")) return json({ erro: "app_nao_configurado" }, 400);
        await chave(); // falha cedo se a chave de criptografia não estiver nas Secrets
        const estado = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("");
        await db.from("oauth_estados").delete().lt("criado_em", new Date(Date.now() - 3600e3).toISOString());
        await db.from("oauth_estados").insert({ estado, usuario: q.id, provedor: "meta-mi", dados: { conta_id: q.admin ? (corpo.conta_id || null) : q.cliente } });
        const escopos = q.admin && corpo.gerenciar ? ESC_GESTAO : ESC_LEITURA;
        return json({ url: `https://www.facebook.com/${VER()}/dialog/oauth?client_id=${env("META_APP_ID")}&redirect_uri=${encodeURIComponent(REDIRECT())}&state=${estado}&response_type=code&scope=${escopos.join(",")}&auth_type=rerequest` });
      }
      case "list_accounts": {
        const { c, token } = await tokenDaConexao(db, String(corpo.connection_id || ""));
        if (!podeConexao(q, c)) return json({ erro: "sem_acesso" }, 403);
        const campos = "account_id,name,currency,timezone_name,account_status,business{id,name}";
        const mapa = new Map<string, Row>();
        const add = (lista: Row[]) => { for (const a of lista) { const id = String(a.account_id || "").replace(/\D/g, ""); if (id && !mapa.has(id)) mapa.set(id, { act_id: id, nome: a.name, moeda: a.currency, fuso: a.timezone_name, status_meta: String(a.account_status), empresa: a.business?.name || "" }); } };
        try { add(await paginar("me/adaccounts", token, { fields: campos, limit: 200 }, 20)); }
        catch (e) { if (e instanceof ErroMeta && e.token) await marcarTokenInvalido(db, c.id, e.message); throw e; }
        try { for (const b of await paginar("me/businesses", token, { fields: "id", limit: 100 }, 5)) for (const t of ["owned_ad_accounts", "client_ad_accounts"]) { try { add(await paginar(`${b.id}/${t}`, token, { fields: campos, limit: 200 }, 10)); } catch { /* sem acesso */ } } } catch { /* sem business_management */ }
        const ids = [...mapa.keys()];
        const { data: ja } = ids.length ? await db.from("meta_ad_accounts").select("id, act_id, conta_id, ativo, connection_id").in("act_id", ids) : { data: [] };
        const porId = new Map(((ja || []) as Row[]).map((x) => [x.act_id, x]));
        return json({ contas: ids.map((id) => { const x = porId.get(id); return { ...mapa.get(id), vinculada: !!(x && x.ativo), de_outro_cliente: !!(x && x.conta_id && !q.admin && x.conta_id !== q.cliente), conta_id: q.admin ? x?.conta_id || null : undefined }; }) });
      }
      case "select_account": {
        const { c, token } = await tokenDaConexao(db, String(corpo.connection_id || ""));
        if (!podeConexao(q, c)) return json({ erro: "sem_acesso" }, 403);
        const destino = q.admin ? (corpo.conta_id !== undefined ? corpo.conta_id || null : c.conta_id) : q.cliente;
        const pedidas = new Set(((corpo.act_ids || []) as unknown[]).map((x) => String(x).replace(/\D/g, "")).filter(Boolean));
        if (!pedidas.size) return json({ erro: "nenhuma_conta" }, 400);
        let vinculadas = 0, recusadas = 0; const novas: string[] = [];
        for (const id of pedidas) {
          let info: Row;
          try { info = await graph("act_" + id, token, { fields: "account_id,name,currency,timezone_name,account_status,business{name}" }); }
          catch { recusadas++; continue; } // o Facebook conectado não acessa essa conta
          const { data: ex } = await db.from("meta_ad_accounts").select("id, conta_id").eq("act_id", id).maybeSingle();
          if (ex && ex.conta_id && destino !== ex.conta_id && !q.admin) { recusadas++; continue; } // não sequestra conta de outro cliente
          const dados = { conta_id: destino, connection_id: c.id, nome: info.name || "Conta " + id, moeda: info.currency, fuso: info.timezone_name, empresa: info.business?.name || null, status_meta: String(info.account_status), ativo: true, ultimo_erro: null };
          if (ex) await db.from("meta_ad_accounts").update(dados).eq("id", ex.id);
          else { const { data: nv } = await db.from("meta_ad_accounts").insert({ act_id: id, ...dados }).select("id").single(); if (nv) novas.push(nv.id); }
          if (ex) novas.push(ex.id);
          vinculadas++;
        }
        segundoPlano((async () => { for (const id of novas) await sincronizar(db, id, { campanhas: true, insights: true, dias: 30 }); })());
        return json({ ok: true, vinculadas, recusadas });
      }
      case "sync_campaigns": case "sync_insights": case "sync_now": {
        const { data: a } = await db.from("meta_ad_accounts").select("id, conta_id, ultima_sync").eq("id", String(corpo.ad_account_id || "")).maybeSingle();
        if (!a || !podeConta(q, a)) return json({ erro: "conta_nao_encontrada" }, 404);
        if (!q.admin && a.ultima_sync && Date.now() - Date.parse(a.ultima_sync) < 5 * 60e3) return json({ erro: "aguarde", detalhe: "Atualizado há menos de 5 minutos." }, 429);
        const r = await sincronizar(db, a.id, { campanhas: acao !== "sync_insights", insights: acao !== "sync_campaigns", dias: Number(corpo.dias) || 7 });
        return json(r, r.ok === false ? 502 : 200);
      }
      case "get_dashboard": {
        const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(corpo.ate)) ? corpo.ate : diaBRT(0);
        const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(corpo.desde)) ? corpo.desde : diaBRT(-29);
        const { data, error } = await q.cli.rpc("mi_dashboard", { p_desde: desde, p_ate: ate, p_conta: q.admin ? (corpo.conta_id || null) : q.cliente, p_ad_account: corpo.ad_account_id || null, p_campanha: corpo.campaign_id || null, p_status: corpo.status || null });
        if (error) return json({ erro: error.message }, 400);
        return json({ desde, ate, ...data });
      }
      case "manage_campaign": {
        if (!q.admin) return json({ erro: "sem_acesso", detalhe: "Somente administradores DANOVA podem alterar campanhas." }, 403);
        if (corpo.confirmar !== true) return json({ erro: "confirmacao_obrigatoria" }, 400);
        const tipo = String(corpo.tipo || "campaign"), id = String(corpo.id || ""), op = String(corpo.operacao || "");
        const tabela = tipo === "campaign" ? "meta_campaigns" : tipo === "adset" ? "meta_adsets" : tipo === "ad" ? "meta_ads" : "";
        if (!tabela || !/^\d+$/.test(id) || !["ativar", "pausar", "orcamento", "status"].includes(op)) return json({ erro: "parametros_invalidos" }, 400);
        const { data: obj } = await db.from(tabela).select("*").eq("id", id).maybeSingle();
        if (!obj) return json({ erro: "objeto_nao_encontrado" }, 404);
        const { data: acc } = await db.from("meta_ad_accounts").select("id, conta_id, connection_id").eq("id", obj.ad_account_id).maybeSingle();
        if (!acc?.connection_id) return json({ erro: "sem_conexao" }, 400);
        const { c, token } = await tokenDaConexao(db, acc.connection_id);
        const camposStatus = tipo === "ad" ? "id,name,status,effective_status" : "id,name,status,effective_status,daily_budget,lifetime_budget";
        const antes = await graph(id, token, { fields: camposStatus });
        if (op === "status") return json({ ok: true, atual: antes });
        if (!(c.escopos || []).includes("ads_management")) return json({ erro: "sem_permissao_gestao", detalhe: "A conexão não tem a permissão ads_management. Reconecte com 'gerenciar campanhas' (exige aprovação da Meta)." }, 403);
        const params: Row = {};
        if (op === "ativar") params.status = "ACTIVE";
        if (op === "pausar") params.status = "PAUSED";
        if (op === "orcamento") {
          if (tipo === "ad") return json({ erro: "anuncio_sem_orcamento" }, 400);
          const v = Number(corpo.valor); if (!(v > 0) || v > 1e7) return json({ erro: "valor_invalido" }, 400);
          if (antes.lifetime_budget && Number(antes.lifetime_budget) > 0 && !antes.daily_budget) params.lifetime_budget = Math.round(v * 100); else params.daily_budget = Math.round(v * 100);
        }
        let sucesso = false, erro: string | null = null, depois: Row | null = null;
        try { await graph(id, token, params, "POST"); depois = await graph(id, token, { fields: camposStatus }); sucesso = true; }
        catch (e) { erro = String((e as Error).message || e).slice(0, 400); }
        await db.from("meta_audit_logs").insert({ membro_id: q.id, membro_nome: q.nome, conta_id: acc.conta_id, ad_account_id: acc.id, objeto_tipo: tipo, objeto_id: id, objeto_nome: antes.name || obj.nome, acao: op + (op === "orcamento" ? " " + corpo.valor : ""), antes, depois, sucesso, erro });
        if (sucesso && depois) await db.from(tabela).update({ status: depois.status, effective_status: depois.effective_status, ...(tipo !== "ad" ? { orcamento_diario: dinheiro(depois.daily_budget), orcamento_total: dinheiro(depois.lifetime_budget) } : {}), sincronizado_em: agoraISO() }).eq("id", id);
        return json(sucesso ? { ok: true, depois } : { erro: "meta", detalhe: erro }, sucesso ? 200 : 502);
      }
      case "disconnect": {
        const { data: c } = await db.from("meta_connections").select("*").eq("id", String(corpo.connection_id || "")).maybeSingle();
        if (!c || !podeConexao(q, c)) return json({ erro: "conexao_nao_encontrada" }, 404);
        if (corpo.revogar) { try { await graph("me/permissions", await decifrar(c.token_cifrado), {}, "DELETE"); } catch { /* já revogado */ } }
        await db.from("meta_ad_accounts").update({ ativo: false, connection_id: null }).eq("connection_id", c.id);
        await db.from("meta_connections").delete().eq("id", c.id);
        await db.from("meta_audit_logs").insert({ membro_id: q.id, membro_nome: q.nome, conta_id: c.conta_id, objeto_tipo: "conexao", objeto_id: c.id, objeto_nome: c.meta_user_name, acao: "desconectar", sucesso: true });
        return json({ ok: true });
      }
      case "unlink_account": {
        const { data: a } = await db.from("meta_ad_accounts").select("id, conta_id, nome").eq("id", String(corpo.ad_account_id || "")).maybeSingle();
        if (!a || !podeConta(q, a)) return json({ erro: "conta_nao_encontrada" }, 404);
        await db.from("meta_ad_accounts").update({ ativo: false }).eq("id", a.id);
        return json({ ok: true });
      }
      case "set_client": {
        if (!q.admin) return json({ erro: "sem_acesso" }, 403);
        await db.from("meta_ad_accounts").update({ conta_id: corpo.conta_id || null }).eq("id", String(corpo.ad_account_id || ""));
        return json({ ok: true });
      }
      case "token_refresh": {
        if (!q.admin) return json({ erro: "sem_acesso" }, 403);
        return json(await verificarTokens(db));
      }
      case "sync_all": {
        if (!q.admin) return json({ erro: "sem_acesso" }, 403);
        segundoPlano(sincronizarTodas(db));
        return json({ ok: true, iniciado: true }, 202);
      }
      case "config": {
        if (!q.admin) return json({ erro: "sem_acesso" }, 403);
        return json({ app_id: env("META_APP_ID") || null, app_secret: !!env("META_APP_SECRET"), chave_cripto: env("META_TOKEN_ENCRYPTION_KEY").length >= 32, versao: VER(), redirect: REDIRECT() });
      }
    }
    return json({ erro: "acao_invalida" }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    console.error("meta-mi", acao, msg);
    return json({ erro: e instanceof ErroMeta ? "meta" : msg.slice(0, 80), detalhe: msg.slice(0, 400) }, e instanceof ErroMeta ? 502 : 400);
  }
});
