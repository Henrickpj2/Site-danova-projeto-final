// danova AI — sincroniza métricas diárias das contas de anúncio (Google Ads e Meta Ads).
//   • campanhas_metricas: uma linha por campanha/dia (tela Campanhas do admin)
//   • meta_insights: uma linha por anúncio/dia (painel do cliente: campanha → conjunto → anúncio)
// Quem pode chamar:
//   • admin (login) → todas as contas ou { conta } / { plataforma }
//   • cliente/construtora (login) → só as contas de anúncio vinculadas à conta dele (no máx. 1 vez a cada 10 min)
//   • sincronização programada (cabeçalho x-token-interno validado em validar_token_interno('ads-sync')) → todas
// Token do Meta de cada conta: o da conexão que a autorizou (meta_conexoes); se faltar, META_ADS_TOKEN.
// Ações do admin: listar_campanhas {conta} / salvar_campanhas {conta, campanhas} (vazio = todas).
// Segredos Google Ads: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_API_VERSION (opcional). Meta: META_GRAPH_VERSION (opcional), META_ADS_TOKEN (opcional).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { gaqlConsulta, mapearGoogle, camposMeta, mapearMeta, camposMetaAnuncio, mapearMetaAnuncio, limparId } from "./mapear.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token-interno" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const VER = () => env("META_GRAPH_VERSION") || "v23.0";

class ErroToken extends Error {}
async function graph(url: string) {
  const r = await fetch(url); const j = await r.json();
  if (!r.ok) {
    const e = j?.error || {};
    if (e.code === 190 || e.code === 102 || e.error_subcode === 463 || e.error_subcode === 460) throw new ErroToken("Meta: autorização expirada ou revogada — reconecte o Facebook.");
    throw new Error("Meta: " + (e.message || r.status));
  }
  return j;
}

async function tokenGoogle() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_ADS_CLIENT_ID"), client_secret: env("GOOGLE_ADS_CLIENT_SECRET"), refresh_token: env("GOOGLE_ADS_REFRESH_TOKEN"), grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Google OAuth: " + (j.error_description || j.error || r.status));
  return j.access_token as string;
}
async function puxarGoogle(cid: string, desde: string, ate: string, token: string) {
  const ver = env("GOOGLE_ADS_API_VERSION") || "v21";
  const h: Record<string, string> = { Authorization: "Bearer " + token, "developer-token": env("GOOGLE_ADS_DEVELOPER_TOKEN"), "content-type": "application/json" };
  if (env("GOOGLE_ADS_LOGIN_CUSTOMER_ID")) h["login-customer-id"] = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/\D/g, "");
  const r = await fetch(`https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:searchStream`, { method: "POST", headers: h, body: JSON.stringify({ query: gaqlConsulta(desde, ate) }) });
  const t = await r.text();
  if (!r.ok) { let msg = t.slice(0, 400); try { const e = JSON.parse(t); msg = (Array.isArray(e) ? e[0] : e)?.error?.message || msg; } catch { /* texto */ } throw new Error("Google Ads: " + msg); }
  return mapearGoogle(JSON.parse(t), cid);
}

async function puxarMeta(act: string, desde: string, ate: string, tk: string, campanhas: string[]) {
  const t = encodeURIComponent(tk);
  const conta = await graph(`https://graph.facebook.com/${VER()}/act_${act}?fields=currency,name&access_token=${t}`);
  const filtro = campanhas.length ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campanhas }]))}` : "";
  const periodo = `&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: ate }))}&time_increment=1&limit=500&access_token=${t}${filtro}`;
  const campanhaLinhas: unknown[] = [], anuncioLinhas: unknown[] = [];
  let url = `https://graph.facebook.com/${VER()}/act_${act}/insights?level=campaign&fields=${camposMeta()}${periodo}`;
  for (let pag = 0; url && pag < 40; pag++) { const j = await graph(url); campanhaLinhas.push(...mapearMeta(j.data, act, conta.currency)); url = j.paging?.next || ""; }
  url = `https://graph.facebook.com/${VER()}/act_${act}/insights?level=ad&fields=${camposMetaAnuncio()}${periodo}`;
  for (let pag = 0; url && pag < 60; pag++) { const j = await graph(url); anuncioLinhas.push(...mapearMetaAnuncio(j.data, act, conta.currency)); url = j.paging?.next || ""; }
  return { campanhaLinhas, anuncioLinhas, nome: conta.name as string, moeda: conta.currency as string };
}

async function campanhasMeta(act: string, tk: string) {
  const lista: { id: string; nome: string; status: string; objetivo: string }[] = [];
  let url = `https://graph.facebook.com/${VER()}/act_${act}/campaigns?fields=id,name,effective_status,objective&limit=200&access_token=${encodeURIComponent(tk)}`;
  for (let pag = 0; url && pag < 10; pag++) {
    const j = await graph(url);
    for (const c of j.data ?? []) lista.push({ id: String(c.id), nome: c.name || "Sem nome", status: String(c.effective_status || "").toLowerCase(), objetivo: c.objective || "" });
    url = j.paging?.next || "";
  }
  return lista;
}

async function upsertLotes(db: ReturnType<typeof createClient>, tabela: string, linhas: unknown[], chave: string) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await db.from(tabela).upsert(linhas.slice(i, i + 500) as Record<string, unknown>[], { onConflict: chave });
    if (error) throw new Error("banco: " + error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = env("SUPABASE_URL");
  const db = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // ---------- quem está chamando ----------
  let papel = "", minhaConta: string | null = null;
  const tokenInterno = req.headers.get("x-token-interno") || "";
  if (tokenInterno) {
    const { data: ok } = await db.rpc("validar_token_interno", { nome: "ads-sync", token: tokenInterno });
    if (!ok) return json({ erro: "token_invalido" }, 401);
    papel = "sistema";
  } else {
    const usuario = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: u } = await usuario.auth.getUser();
    if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
    const { data: me } = await db.from("membros").select("ativo, papel, conta_id").eq("id", u.user.id).maybeSingle();
    if (!me?.ativo) return json({ erro: "sem_acesso" }, 403);
    if (me.papel === "admin") papel = "admin";
    else if (me.papel === "construtora" && me.conta_id) { papel = "cliente"; minhaConta = me.conta_id; }
    else return json({ erro: "sem_acesso" }, 403);
  }

  let corpo: { conta?: string; dias?: number; acao?: string; plataforma?: string; campanhas?: { id: string; nome?: string }[] } = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const dias = Math.min(Math.max(Number(corpo.dias) || (papel === "sistema" ? 3 : 30), 1), 365);
  const ate = new Date(Date.now() - 864e5), desde = new Date(ate.getTime() - (dias - 1) * 864e5);

  // tokens das conexões
  const { data: conexoes } = await db.from("meta_conexoes").select("id, token, status, expira_em");
  const tokenDe = new Map((conexoes ?? []).map((c) => [c.id, c]));
  const tokenConta = (c: { conexao_id?: string | null }) => {
    const cx = c.conexao_id ? tokenDe.get(c.conexao_id) : null;
    if (cx && cx.status !== "revogada") return { token: cx.token as string, conexao: cx.id as string };
    return env("META_ADS_TOKEN") ? { token: env("META_ADS_TOKEN"), conexao: null } : null;
  };

  // ---------- ações do admin: campanhas de uma conta ----------
  if (corpo.acao === "listar_campanhas" || corpo.acao === "salvar_campanhas") {
    if (papel !== "admin" && papel !== "cliente") return json({ erro: "sem_acesso" }, 403);
    const { data: conta } = await db.from("contas_anuncio").select("id, conta_externa, conexao_id, conta_id, campanhas_sel").eq("id", corpo.conta || "").eq("plataforma", "meta").maybeSingle();
    if (!conta || (papel === "cliente" && conta.conta_id !== minhaConta)) return json({ erro: "conta_nao_encontrada" }, 404);
    const act = limparId("meta", conta.conta_externa);
    try {
      if (corpo.acao === "listar_campanhas") {
        const tk = tokenConta(conta); if (!tk) return json({ erro: "meta_nao_configurado" }, 400);
        const sel = new Set((conta.campanhas_sel || []).map((c: { id: string }) => String(c.id)));
        const lista = await campanhasMeta(act, tk.token);
        return json({ todas: sel.size === 0, campanhas: lista.map((c) => ({ ...c, selecionada: sel.size === 0 || sel.has(c.id) })) });
      }
      const escolhidas = (corpo.campanhas || []).slice(0, 300).map((c) => ({ id: String(c.id).replace(/\D/g, ""), nome: String(c.nome || "").slice(0, 200) })).filter((c) => c.id);
      await db.from("contas_anuncio").update({ campanhas_sel: escolhidas }).eq("id", conta.id);
      if (escolhidas.length) {
        await db.from("meta_insights").delete().eq("conta_anuncio", act).not("campanha_id", "in", `(${escolhidas.map((c) => c.id).join(",")})`);
        const nomes = escolhidas.map((c) => c.nome).filter(Boolean);
        if (nomes.length) await db.from("campanhas_metricas").delete().eq("plataforma", "meta").eq("conta_anuncio", act).not("campanha", "in", `(${nomes.map((n) => '"' + n.replace(/"/g, '\\"') + '"').join(",")})`);
      }
      return json({ ok: true, campanhas: escolhidas.length });
    } catch (e) {
      return json({ erro: String((e as Error).message || e).slice(0, 400) }, 502);
    }
  }

  // ---------- sincronização ----------
  let q = db.from("contas_anuncio").select("*").eq("ativo", true);
  if (corpo.conta) q = q.eq("id", corpo.conta);
  if (corpo.plataforma === "meta" || corpo.plataforma === "google") q = q.eq("plataforma", corpo.plataforma);
  if (papel === "cliente") q = q.eq("conta_id", minhaConta!).eq("plataforma", "meta");
  if (papel === "sistema") {
    q = q.not("status", "eq", "encerrada");
    if (!env("GOOGLE_ADS_DEVELOPER_TOKEN") || !env("GOOGLE_ADS_REFRESH_TOKEN")) q = q.eq("plataforma", "meta"); // Google ainda sem credenciais
  }
  const { data: contas } = await q;
  if (!contas?.length) return json({ erro: "sem_contas" }, 400);
  if (papel === "cliente") {
    const recente = contas.find((c) => c.ultima_sync && Date.now() - new Date(c.ultima_sync).getTime() < 10 * 60e3);
    if (recente) return json({ erro: "aguarde", detalhe: "Os dados foram atualizados há menos de 10 minutos." }, 429);
  }

  const resultado: unknown[] = [];
  const conexoesComErro = new Map<string, string>(), conexoesOk = new Set<string>();
  let tokenG = "";
  for (const c of contas) {
    const id = limparId(c.plataforma, c.conta_externa);
    try {
      let n = 0; const extra: Record<string, unknown> = {};
      if (c.plataforma === "google") {
        if (!env("GOOGLE_ADS_DEVELOPER_TOKEN") || !env("GOOGLE_ADS_REFRESH_TOKEN")) throw new Error("google_nao_configurado");
        if ((c.estimados || []).includes("conta_externa")) throw new Error("ID provisório — informe o ID real da conta Google Ads");
        tokenG = tokenG || await tokenGoogle();
        const linhas = await puxarGoogle(id, iso(desde), iso(ate), tokenG);
        await upsertLotes(db, "campanhas_metricas", linhas, "data,plataforma,conta_anuncio,campanha,conjunto"); n = linhas.length;
      } else {
        const tk = tokenConta(c);
        if (!tk) throw new Error("meta_nao_configurado");
        const sel = Array.isArray(c.campanhas_sel) ? c.campanhas_sel.map((x: { id: string }) => String(x.id)).filter(Boolean) : [];
        try {
          const m = await puxarMeta(id, iso(desde), iso(ate), tk.token, sel);
          await upsertLotes(db, "campanhas_metricas", m.campanhaLinhas, "data,plataforma,conta_anuncio,campanha,conjunto");
          await upsertLotes(db, "meta_insights", m.anuncioLinhas, "data,conta_anuncio,anuncio_id");
          n = m.campanhaLinhas.length; extra.nome = c.nome || m.nome; extra.moeda = m.moeda;
          if (tk.conexao) conexoesOk.add(tk.conexao);
        } catch (e) {
          if (e instanceof ErroToken && tk.conexao) conexoesComErro.set(tk.conexao, e.message);
          throw e;
        }
      }
      await db.from("contas_anuncio").update({ ...extra, ultima_sync: new Date().toISOString(), ultimo_erro: null }).eq("id", c.id);
      resultado.push({ conta: c.id, nome: c.nome, plataforma: c.plataforma, linhas: n });
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      await db.from("contas_anuncio").update({ ultimo_erro: msg }).eq("id", c.id);
      resultado.push({ conta: c.id, nome: c.nome, plataforma: c.plataforma, erro: msg });
    }
  }
  const agora = new Date().toISOString();
  for (const [cx, msg] of conexoesComErro) await db.from("meta_conexoes").update({ status: "expirada", ultimo_erro: msg, atualizado_em: agora }).eq("id", cx);
  for (const cx of conexoesOk) if (!conexoesComErro.has(cx)) await db.from("meta_conexoes").update({ status: "ativa", ultimo_erro: null, ultima_sync: agora }).eq("id", cx);
  if (papel === "sistema") await db.from("meta_conexoes").update({ status: "expirada", ultimo_erro: "A autorização do Facebook venceu — reconecte." }).lt("expira_em", agora).eq("status", "ativa");
  return json({ desde: iso(desde), ate: iso(ate), resultado });
});
