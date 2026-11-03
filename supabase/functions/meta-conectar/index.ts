// danova AI — "Conectar com Facebook": o administrador autoriza uma vez e o CRM passa a puxar
// contas de anúncio, métricas e leads dos formulários (Lead Ads) sem copiar tokens.
// Segredos: META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION (opcional). O token fica em public.integracoes (só o servidor lê).
// Ações (POST, com login de admin): { acao: "iniciar" } → URL do Facebook; { acao: "desconectar" }.
// GET ?code=…&state=… → retorno do Facebook (troca o código pelo token de longa duração, salva e volta ao CRM).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const CRM = "https://danova-ai.com/crm/";
const ESCOPOS = ["ads_read", "business_management", "leads_retrieval", "pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads"];
const voltar = (q: string) => new Response(null, { status: 302, headers: { Location: CRM + "#integracoes?" + q } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const base = env("SUPABASE_URL"), ver = env("META_GRAPH_VERSION") || "v23.0";
  const retorno = base + "/functions/v1/meta-conectar";
  const db = createClient(base, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const appId = env("META_APP_ID"), segredo = env("META_APP_SECRET");

  // ---------- retorno do Facebook ----------
  if (req.method === "GET") {
    const u = new URL(req.url), code = u.searchParams.get("code"), estado = u.searchParams.get("state") || "";
    if (u.searchParams.get("error")) return voltar("meta=cancelado");
    if (!code || !/^[a-f0-9]{48}$/.test(estado)) return voltar("meta=erro&motivo=retorno_invalido");
    const { data: est } = await db.from("oauth_estados").delete().eq("estado", estado).eq("provedor", "meta").select("usuario, criado_em").maybeSingle();
    if (!est || Date.now() - new Date(est.criado_em).getTime() > 15 * 60e3) return voltar("meta=erro&motivo=expirou");
    try {
      const g = (p: string) => fetch(`https://graph.facebook.com/${ver}/${p}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message || String(r.status)); return j; });
      const curto = await g(`oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(retorno)}&client_secret=${encodeURIComponent(segredo)}&code=${encodeURIComponent(code)}`);
      const longo = await g(`oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${encodeURIComponent(segredo)}&fb_exchange_token=${encodeURIComponent(curto.access_token)}`);
      const tk = longo.access_token as string;
      const eu = await g(`me?fields=id,name&access_token=${encodeURIComponent(tk)}`);
      const expira = longo.expires_in ? new Date(Date.now() + Number(longo.expires_in) * 1000).toISOString() : null;
      await db.from("integracoes").upsert({ provedor: "meta", token: tk, expira_em: expira, usuario_nome: eu.name, extra: { usuario_id: eu.id }, conectado_por: est.usuario, atualizado_em: new Date().toISOString() });

      // Páginas: token de página (não expira quando vem de token de longa duração) + assinatura do campo leadgen.
      let paginas = 0, assinadas = 0;
      try {
        let url = `https://graph.facebook.com/${ver}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(tk)}`;
        for (let pag = 0; url && pag < 10; pag++) {
          const r = await fetch(url); const j = await r.json(); if (!r.ok) break;
          for (const p of j.data ?? []) {
            if (!p.access_token) continue;
            paginas++;
            const s = await fetch(`https://graph.facebook.com/${ver}/${p.id}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(p.access_token)}`, { method: "POST" });
            const sj = await s.json().catch(() => ({}));
            const ok = s.ok && sj.success !== false; if (ok) assinadas++;
            await db.from("meta_paginas").upsert({ id: String(p.id), nome: p.name, token: p.access_token, assinada: ok, erro: ok ? null : String(sj?.error?.message || s.status).slice(0, 300), atualizado_em: new Date().toISOString() });
          }
          url = j.paging?.next || "";
        }
      } catch (_) { /* sem páginas: só métricas */ }

      // Webhook do app para leads (objeto Page, campo leadgen), com token de verificação gerado aqui.
      try {
        let verif = env("META_VERIFY_TOKEN");
        if (!verif) {
          const { data: atual } = await db.from("integracoes").select("token").eq("provedor", "meta_verify").maybeSingle();
          verif = atual?.token || crypto.randomUUID().replace(/-/g, "");
          await db.from("integracoes").upsert({ provedor: "meta_verify", token: verif, atualizado_em: new Date().toISOString() });
        }
        await fetch(`https://graph.facebook.com/${ver}/${appId}/subscriptions`, {
          method: "POST",
          body: new URLSearchParams({ object: "page", callback_url: base + "/functions/v1/meta-leads", fields: "leadgen", verify_token: verif, include_values: "true", access_token: `${appId}|${segredo}` }),
        });
      } catch (_) { /* configurável depois no painel do Meta */ }

      return voltar(`meta=ok&paginas=${paginas}&assinadas=${assinadas}`);
    } catch (e) {
      console.error("meta-conectar", e);
      return voltar("meta=erro&motivo=" + encodeURIComponent(String((e as Error).message || e).slice(0, 120)));
    }
  }

  // ---------- ações do CRM (admin) ----------
  const usuario = createClient(base, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await usuario.from("membros").select("ativo, papel").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo || me.papel !== "admin") return json({ erro: "sem_acesso" }, 403);
  let corpo: { acao?: string } = {}; try { corpo = await req.json(); } catch { /* vazio */ }

  if (corpo.acao === "iniciar") {
    if (!appId || !segredo) return json({ erro: "app_nao_configurado" }, 400);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const estado = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    await db.from("oauth_estados").delete().lt("criado_em", new Date(Date.now() - 3600e3).toISOString());
    await db.from("oauth_estados").insert({ estado, usuario: u.user.id, provedor: "meta" });
    const url = `https://www.facebook.com/${ver}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(retorno)}&state=${estado}&response_type=code&scope=${ESCOPOS.join(",")}`;
    return json({ url });
  }
  if (corpo.acao === "desconectar") {
    await db.from("integracoes").delete().eq("provedor", "meta");
    await db.from("meta_paginas").delete().neq("id", "");
    return json({ ok: true });
  }
  return json({ erro: "acao_invalida" }, 400);
});
