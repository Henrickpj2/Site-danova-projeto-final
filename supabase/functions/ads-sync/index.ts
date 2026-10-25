// danova AI — sincroniza métricas diárias das contas de anúncio dos clientes (Google Ads e Meta Ads)
// para a tabela campanhas_metricas. Chamado pelo botão "Sincronizar" na tela Campanhas (só admin).
// Segredos (Supabase → Edge Functions → Secrets):
//   Google Ads: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
//               GOOGLE_ADS_LOGIN_CUSTOMER_ID (ID da conta MCC, só números), GOOGLE_ADS_API_VERSION (opcional, padrão v21)
//   Meta Ads:   META_ADS_TOKEN (token de usuário do sistema com ads_read), META_GRAPH_VERSION (opcional, padrão v23.0)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { gaqlConsulta, mapearGoogle, camposMeta, mapearMeta, limparId } from "./mapear.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const iso = (d: Date) => d.toISOString().slice(0, 10);

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

async function puxarMeta(act: string, desde: string, ate: string) {
  const ver = env("META_GRAPH_VERSION") || "v23.0", tk = env("META_ADS_TOKEN");
  const c = await fetch(`https://graph.facebook.com/${ver}/act_${act}?fields=currency,name&access_token=${encodeURIComponent(tk)}`);
  const conta = await c.json();
  if (!c.ok) throw new Error("Meta: " + (conta?.error?.message || c.status));
  let url = `https://graph.facebook.com/${ver}/act_${act}/insights?level=campaign&time_increment=1&limit=500&fields=${camposMeta()}` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: ate }))}&access_token=${encodeURIComponent(tk)}`;
  const linhas: unknown[] = [];
  for (let pag = 0; url && pag < 40; pag++) {
    const r = await fetch(url); const j = await r.json();
    if (!r.ok) throw new Error("Meta: " + (j?.error?.message || r.status));
    linhas.push(...mapearMeta(j.data, act, conta.currency));
    url = j.paging?.next || "";
  }
  return { linhas, nome: conta.name as string, moeda: conta.currency as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = env("SUPABASE_URL");
  const usuario = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await usuario.from("membros").select("ativo, papel").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo || me.papel !== "admin") return json({ erro: "sem_acesso" }, 403);

  let corpo: { conta?: string; dias?: number } = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  const dias = Math.min(Math.max(Number(corpo.dias) || 30, 1), 365);
  const ate = new Date(Date.now() - 864e5), desde = new Date(ate.getTime() - (dias - 1) * 864e5);
  const db = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  let q = db.from("contas_anuncio").select("*").eq("ativo", true);
  if (corpo.conta) q = q.eq("id", corpo.conta);
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
        if (!env("META_ADS_TOKEN")) throw new Error("meta_nao_configurado");
        const m = await puxarMeta(id, iso(desde), iso(ate));
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
