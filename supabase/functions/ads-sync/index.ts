// danova AI — sincroniza métricas diárias das contas de anúncio dos clientes (Google Ads e Meta Ads)
// para a tabela campanhas_metricas. Chamado pelo botão "Sincronizar" na tela Campanhas (só admin).
// Segredos (Supabase → Edge Functions → Secrets):
//   Google Ads: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
//               GOOGLE_ADS_LOGIN_CUSTOMER_ID (ID da conta MCC, só números), GOOGLE_ADS_API_VERSION (opcional, padrão v21)
//   Meta Ads:   META_ADS_TOKEN (token de usuário do sistema com ads_read), META_GRAPH_VERSION (opcional, padrão v23.0)
// Ações: listar_contas_meta / salvar_contas_meta {ids} / listar_campanhas {conta} / salvar_campanhas {conta, campanhas}; importar_meta (todas);
// { plataforma: "meta" } sincroniza só o Meta (respeitando as campanhas escolhidas em contas_anuncio.campanhas_sel).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { gaqlConsulta, mapearGoogle, camposMeta, mapearMeta, limparId } from "./mapear.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const iso = (d: Date) => d.toISOString().slice(0, 10);
let TOKEN_META = ""; // META_ADS_TOKEN (segredo) ou a conexão "Conectar com Facebook" (tabela integracoes)

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

async function puxarMeta(act: string, desde: string, ate: string, campanhas: string[] = []) {
  const ver = env("META_GRAPH_VERSION") || "v23.0", tk = TOKEN_META;
  const c = await fetch(`https://graph.facebook.com/${ver}/act_${act}?fields=currency,name&access_token=${encodeURIComponent(tk)}`);
  const conta = await c.json();
  if (!c.ok) throw new Error("Meta: " + (conta?.error?.message || c.status));
  let url = `https://graph.facebook.com/${ver}/act_${act}/insights?level=campaign&time_increment=1&limit=500&fields=${camposMeta()}` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: ate }))}&access_token=${encodeURIComponent(tk)}` +
    (campanhas.length ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campanhas }]))}` : "");
  const linhas: unknown[] = [];
  for (let pag = 0; url && pag < 40; pag++) {
    const r = await fetch(url); const j = await r.json();
    if (!r.ok) throw new Error("Meta: " + (j?.error?.message || r.status));
    linhas.push(...mapearMeta(j.data, act, conta.currency));
    url = j.paging?.next || "";
  }
  return { linhas, nome: conta.name as string, moeda: conta.currency as string };
}

// Lista TODAS as contas de anúncio que o token do Meta enxerga: as atribuídas ao usuário do sistema
// e as próprias/de clientes de cada Gerenciador de Negócios a que ele tem acesso.
async function listarContasMeta() {
  const ver = env("META_GRAPH_VERSION") || "v23.0", tk = encodeURIComponent(TOKEN_META);
  const campos = "account_id,name,currency,account_status,business{name}";
  const contas = new Map<string, { id: string; nome: string; moeda: string; status: number; empresa: string }>();
  async function paginar(inicio: string) {
    let url = inicio;
    for (let pag = 0; url && pag < 20; pag++) {
      const r = await fetch(url); const j = await r.json();
      if (!r.ok) throw new Error("Meta: " + (j?.error?.message || r.status));
      for (const a of j.data ?? []) {
        const id = String(a.account_id || "").replace(/\D/g, "");
        if (id && !contas.has(id)) contas.set(id, { id, nome: a.name || "Conta " + id, moeda: a.currency || "", status: Number(a.account_status) || 0, empresa: a.business?.name || "" });
      }
      url = j.paging?.next || "";
    }
  }
  await paginar(`https://graph.facebook.com/${ver}/me/adaccounts?fields=${campos}&limit=200&access_token=${tk}`);
  const rb = await fetch(`https://graph.facebook.com/${ver}/me/businesses?fields=id,name&limit=100&access_token=${tk}`);
  const negocios = rb.ok ? ((await rb.json()).data ?? []) : [];
  for (const n of negocios) {
    for (const tipo of ["owned_ad_accounts", "client_ad_accounts"]) {
      try { await paginar(`https://graph.facebook.com/${ver}/${n.id}/${tipo}?fields=${campos}&limit=200&access_token=${tk}`); } catch { /* sem permissão nessa lista */ }
    }
  }
  return [...contas.values()];
}
async function campanhasMeta(act: string) {
  const ver = env("META_GRAPH_VERSION") || "v23.0", tk = encodeURIComponent(TOKEN_META);
  const lista: { id: string; nome: string; status: string; objetivo: string; inicio: string | null }[] = [];
  let url = `https://graph.facebook.com/${ver}/act_${act}/campaigns?fields=id,name,effective_status,objective,start_time&limit=200&access_token=${tk}`;
  for (let pag = 0; url && pag < 10; pag++) {
    const r = await fetch(url); const j = await r.json();
    if (!r.ok) throw new Error("Meta: " + (j?.error?.message || r.status));
    for (const c of j.data ?? []) lista.push({ id: String(c.id), nome: c.name || "Sem nome", status: String(c.effective_status || "").toLowerCase(), objetivo: c.objective || "", inicio: c.start_time || null });
    url = j.paging?.next || "";
  }
  return lista;
}
const statusMeta = (s: number) => s === 1 ? "ativa" : (s === 2 || s === 101) ? "encerrada" : "pausada";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = env("SUPABASE_URL");
  const usuario = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await usuario.from("membros").select("ativo, papel").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo || me.papel !== "admin") return json({ erro: "sem_acesso" }, 403);

  let corpo: { conta?: string; dias?: number; acao?: string; plataforma?: string; ids?: string[]; campanhas?: { id: string; nome?: string }[] } = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const dias = Math.min(Math.max(Number(corpo.dias) || 30, 1), 365);
  const ate = new Date(Date.now() - 864e5), desde = new Date(ate.getTime() - (dias - 1) * 864e5);
  const db = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  TOKEN_META = env("META_ADS_TOKEN");
  if (!TOKEN_META) { const { data: i } = await db.from("integracoes").select("token").eq("provedor", "meta").maybeSingle(); TOKEN_META = i?.token || ""; }

  // ---------- escolha de contas e campanhas ----------
  if (corpo.acao === "listar_contas_meta" || corpo.acao === "salvar_contas_meta" || corpo.acao === "listar_campanhas" || corpo.acao === "salvar_campanhas") {
    if (!TOKEN_META) return json({ erro: "meta_nao_configurado" }, 400);
    try {
      const { data: existentes } = await db.from("contas_anuncio").select("id, conta_externa, nome, ativo, campanhas_sel").eq("plataforma", "meta");
      const porExt = new Map((existentes ?? []).map((e) => [String(e.conta_externa || "").replace(/\D/g, ""), e]));
      if (corpo.acao === "listar_contas_meta") {
        const lista = await listarContasMeta();
        return json({ contas: lista.map((a) => { const e = porExt.get(a.id); return { id: a.id, nome: a.nome, empresa: a.empresa, moeda: a.moeda, status: statusMeta(a.status), selecionada: !!(e && e.ativo), conta_crm: e?.id || null, campanhas: (e?.campanhas_sel || []).length }; }) });
      }
      if (corpo.acao === "salvar_contas_meta") {
        const ids = new Set((corpo.ids || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean));
        const lista = await listarContasMeta();
        let ativadas = 0, desativadas = 0;
        for (const a of lista) {
          const e = porExt.get(a.id);
          if (ids.has(a.id)) {
            if (e) { if (!e.ativo) { await db.from("contas_anuncio").update({ ativo: true, moeda: a.moeda, status: statusMeta(a.status) }).eq("id", e.id); } }
            else { await db.from("contas_anuncio").insert({ plataforma: "meta", conta_externa: a.id, nome: a.empresa && !a.nome.includes(a.empresa) ? `${a.nome} · ${a.empresa}` : a.nome, moeda: a.moeda, status: statusMeta(a.status), ativo: true, nicho: "outro" }); }
            ativadas++;
          } else if (e && e.ativo) { await db.from("contas_anuncio").update({ ativo: false }).eq("id", e.id); desativadas++; }
        }
        return json({ ativadas, desativadas });
      }
      const conta = (existentes ?? []).find((e) => e.id === corpo.conta);
      if (!conta) return json({ erro: "conta_nao_encontrada" }, 404);
      const act = limparId("meta", conta.conta_externa);
      if (corpo.acao === "listar_campanhas") {
        const sel = new Set((conta.campanhas_sel || []).map((c: { id: string }) => String(c.id)));
        const lista = await campanhasMeta(act);
        return json({ todas: sel.size === 0, campanhas: lista.map((c) => ({ ...c, selecionada: sel.size === 0 || sel.has(c.id) })) });
      }
      // salvar_campanhas: lista vazia = todas as campanhas da conta
      const escolhidas = (corpo.campanhas || []).slice(0, 300).map((c) => ({ id: String(c.id).replace(/\D/g, ""), nome: String(c.nome || "").slice(0, 200) })).filter((c) => c.id);
      await db.from("contas_anuncio").update({ campanhas_sel: escolhidas }).eq("id", conta.id);
      if (escolhidas.length) {
        const nomes = escolhidas.map((c) => c.nome).filter(Boolean);
        if (nomes.length) await db.from("campanhas_metricas").delete().eq("plataforma", "meta").eq("conta_anuncio", act).not("campanha", "in", `(${nomes.map((n) => '"' + n.replace(/"/g, '\\"') + '"').join(",")})`);
      }
      return json({ ok: true, campanhas: escolhidas.length });
    } catch (e) {
      return json({ erro: String((e as Error).message || e).slice(0, 400) }, 502);
    }
  }

  // Importa todas as contas do Gerenciador de Negócios do Meta (não altera as já cadastradas, só atualiza nome/moeda/status).
  if (corpo.acao === "importar_meta") {
    if (!TOKEN_META) return json({ erro: "meta_nao_configurado" }, 400);
    try {
      const lista = await listarContasMeta();
      const { data: existentes } = await db.from("contas_anuncio").select("id, conta_externa").eq("plataforma", "meta");
      const ja = new Map((existentes ?? []).map((e) => [String(e.conta_externa || "").replace(/\D/g, ""), e.id]));
      let novas = 0, atualizadas = 0;
      for (const a of lista) {
        if (ja.has(a.id)) {
          await db.from("contas_anuncio").update({ moeda: a.moeda, status: statusMeta(a.status), ativo: a.status !== 101 }).eq("id", ja.get(a.id));
          atualizadas++;
        } else {
          const { error } = await db.from("contas_anuncio").insert({ plataforma: "meta", conta_externa: a.id, nome: a.empresa && !a.nome.includes(a.empresa) ? `${a.nome} · ${a.empresa}` : a.nome, moeda: a.moeda, status: statusMeta(a.status), ativo: a.status !== 101, nicho: "outro" });
          if (!error) novas++;
        }
      }
      return json({ total: lista.length, novas, atualizadas, contas: lista.map((a) => ({ id: a.id, nome: a.nome, empresa: a.empresa, status: statusMeta(a.status) })) });
    } catch (e) {
      return json({ erro: String((e as Error).message || e).slice(0, 400) }, 502);
    }
  }
  let q = db.from("contas_anuncio").select("*").eq("ativo", true);
  if (corpo.conta) q = q.eq("id", corpo.conta);
  if (corpo.plataforma === "meta" || corpo.plataforma === "google") q = q.eq("plataforma", corpo.plataforma);
  const { data: contas } = await q;
  if (!contas?.length) return json({ erro: "sem_contas" }, 400);

  const resultado: unknown[] = [];
  let tokenG = "";
  for (const c of contas) {
    const id = limparId(c.plataforma, c.conta_externa);
    try {
      let linhas: Record<string, unknown>[] = [], extra: Record<string, unknown> = {};
      if (c.plataforma === "google") {
        if (!env("GOOGLE_ADS_DEVELOPER_TOKEN") || !env("GOOGLE_ADS_REFRESH_TOKEN")) throw new Error("google_nao_configurado");
        tokenG = tokenG || await tokenGoogle();
        linhas = await puxarGoogle(id, iso(desde), iso(ate), tokenG) as Record<string, unknown>[];
      } else {
        if (!TOKEN_META) throw new Error("meta_nao_configurado");
        const sel = Array.isArray(c.campanhas_sel) ? c.campanhas_sel.map((x: { id: string }) => String(x.id)).filter(Boolean) : [];
        const m = await puxarMeta(id, iso(desde), iso(ate), sel);
        linhas = m.linhas as Record<string, unknown>[]; extra = { nome: c.nome || m.nome, moeda: m.moeda };
      }
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await db.from("campanhas_metricas").upsert(linhas.slice(i, i + 500), { onConflict: "data,plataforma,conta_anuncio,campanha,conjunto" });
        if (error) throw new Error("banco: " + error.message);
      }
      await db.from("contas_anuncio").update({ ...extra, ultima_sync: new Date().toISOString(), ultimo_erro: null }).eq("id", c.id);
      resultado.push({ conta: c.id, plataforma: c.plataforma, linhas: linhas.length });
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      await db.from("contas_anuncio").update({ ultimo_erro: msg }).eq("id", c.id);
      resultado.push({ conta: c.id, plataforma: c.plataforma, erro: msg });
    }
  }
  return json({ desde: iso(desde), ate: iso(ate), resultado });
});
