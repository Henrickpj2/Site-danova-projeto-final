// danova AI — "Conectar minha conta Meta Ads" (OAuth oficial da Meta), por login.
//   • Cliente (papel construtora, vinculado a uma conta): conecta o próprio Facebook, escolhe a(s) conta(s) de anúncio
//     e vê só elas no painel. Permissões pedidas: ads_read e business_management.
//   • Admin: idem para a agência e, além disso, liga o recebimento de leads dos formulários (Lead Ads) das páginas.
// O token fica em public.meta_conexoes (só o servidor lê). Segredos: META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION (opcional).
// POST (com login): { acao: "iniciar" } → URL do Facebook
//                   { acao: "listar_contas", conexao } → contas de anúncio que esse Facebook acessa
//                   { acao: "vincular", conexao, ids: [...], cliente? } → define as contas ligadas (cliente? só admin)
//                   { acao: "desconectar", conexao }
// GET ?code=…&state=… → retorno do Facebook.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const CRM = "https://danova-ai.com/crm/";
const ESCOPOS_CLIENTE = ["ads_read", "business_management"];
// leads_retrieval, pages_manage_metadata e pages_manage_ads exigem casos de uso extras no app Meta; adicione-os aqui quando forem liberados.
const ESCOPOS_ADMIN = ["ads_read", "business_management", "pages_show_list", "pages_read_engagement"];
const voltar = (tela: string, q: string) => new Response(null, { status: 302, headers: { Location: CRM + "#" + tela + "?" + q } });
const statusMeta = (s: number) => s === 1 ? "ativa" : (s === 2 || s === 101) ? "encerrada" : "pausada";

async function graph(url: string, init?: RequestInit) {
  const r = await fetch(url, init); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || String(r.status));
  return j;
}

async function listarContas(tk: string, ver: string) {
  const t = encodeURIComponent(tk), campos = "account_id,name,currency,account_status,business{name}";
  const contas = new Map<string, { id: string; nome: string; moeda: string; status: string; empresa: string }>();
  async function paginar(inicio: string) {
    let url = inicio;
    for (let pag = 0; url && pag < 20; pag++) {
      const j = await graph(url);
      for (const a of j.data ?? []) {
        const id = String(a.account_id || "").replace(/\D/g, "");
        if (id && !contas.has(id)) contas.set(id, { id, nome: a.name || "Conta " + id, moeda: a.currency || "", status: statusMeta(Number(a.account_status) || 0), empresa: a.business?.name || "" });
      }
      url = j.paging?.next || "";
    }
  }
  await paginar(`https://graph.facebook.com/${ver}/me/adaccounts?fields=${campos}&limit=200&access_token=${t}`);
  try {
    const neg = await graph(`https://graph.facebook.com/${ver}/me/businesses?fields=id&limit=100&access_token=${t}`);
    for (const n of neg.data ?? []) for (const tipo of ["owned_ad_accounts", "client_ad_accounts"]) {
      try { await paginar(`https://graph.facebook.com/${ver}/${n.id}/${tipo}?fields=${campos}&limit=200&access_token=${t}`); } catch { /* sem acesso */ }
    }
  } catch { /* sem business_management */ }
  return [...contas.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const base = env("SUPABASE_URL"), ver = env("META_GRAPH_VERSION") || "v23.0";
  const retorno = base + "/functions/v1/meta-conectar";
  const db = createClient(base, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const appId = env("META_APP_ID"), segredo = env("META_APP_SECRET");

  // ---------- retorno do Facebook ----------
  if (req.method === "GET") {
    const u = new URL(req.url), code = u.searchParams.get("code"), estado = u.searchParams.get("state") || "";
    const { data: est } = /^[a-f0-9]{48}$/.test(estado)
      ? await db.from("oauth_estados").delete().eq("estado", estado).eq("provedor", "meta").select("usuario, criado_em").maybeSingle()
      : { data: null };
    const { data: quem } = est ? await db.from("membros").select("id, papel, conta_id, ativo").eq("id", est.usuario).maybeSingle() : { data: null };
    const tela = quem?.papel === "admin" ? "integracoes" : "anuncios";
    if (u.searchParams.get("error")) return voltar(tela, "meta=cancelado");
    if (!code || !est || !quem?.ativo) return voltar(tela, "meta=erro&motivo=retorno_invalido");
    if (Date.now() - new Date(est.criado_em).getTime() > 15 * 60e3) return voltar(tela, "meta=erro&motivo=expirou");
    try {
      const curto = await graph(`https://graph.facebook.com/${ver}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(retorno)}&client_secret=${encodeURIComponent(segredo)}&code=${encodeURIComponent(code)}`);
      const longo = await graph(`https://graph.facebook.com/${ver}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${encodeURIComponent(segredo)}&fb_exchange_token=${encodeURIComponent(curto.access_token)}`);
      const tk = longo.access_token as string;
      const eu = await graph(`https://graph.facebook.com/${ver}/me?fields=id,name&access_token=${encodeURIComponent(tk)}`);
      const expira = longo.expires_in ? new Date(Date.now() + Number(longo.expires_in) * 1000).toISOString() : null;
      const agora = new Date().toISOString();
      const { data: cx, error } = await db.from("meta_conexoes").upsert({
        membro_id: quem.id, conta_id: quem.papel === "admin" ? null : quem.conta_id, usuario_meta_id: eu.id, usuario_nome: eu.name,
        token: tk, expira_em: expira, status: "ativa", ultimo_erro: null, atualizado_em: agora,
      }, { onConflict: "membro_id" }).select("id").single();
      if (error) throw new Error(error.message);

      let extra = "";
      if (quem.papel === "admin") {
        // Páginas: token de página + assinatura do campo leadgen (leads dos formulários instantâneos).
        let paginas = 0, assinadas = 0;
        try {
          let url = `https://graph.facebook.com/${ver}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(tk)}`;
          for (let pag = 0; url && pag < 10; pag++) {
            const j = await graph(url);
            for (const p of j.data ?? []) {
              if (!p.access_token) continue; paginas++;
              let ok = false, erro: string | null = null;
              try { const s = await graph(`https://graph.facebook.com/${ver}/${p.id}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(p.access_token)}`, { method: "POST" }); ok = s.success !== false; } catch (e) { erro = String((e as Error).message).slice(0, 300); }
              if (ok) assinadas++;
              await db.from("meta_paginas").upsert({ id: String(p.id), nome: p.name, token: p.access_token, assinada: ok, erro, atualizado_em: agora });
            }
            url = j.paging?.next || "";
          }
        } catch (_) { /* sem páginas */ }
        try {
          let verif = env("META_VERIFY_TOKEN");
          if (!verif) {
            const { data: atual } = await db.from("integracoes").select("token").eq("provedor", "meta_verify").maybeSingle();
            verif = atual?.token || crypto.randomUUID().replace(/-/g, "");
            await db.from("integracoes").upsert({ provedor: "meta_verify", token: verif, atualizado_em: agora });
          }
          await fetch(`https://graph.facebook.com/${ver}/${appId}/subscriptions`, { method: "POST", body: new URLSearchParams({ object: "page", callback_url: base + "/functions/v1/meta-leads", fields: "leadgen", verify_token: verif, include_values: "true", access_token: `${appId}|${segredo}` }) });
        } catch (_) { /* configurável no painel do Meta */ }
        extra = `&paginas=${paginas}&assinadas=${assinadas}`;
      }
      return voltar(tela, `meta=ok&conexao=${cx.id}${extra}`);
    } catch (e) {
      console.error("meta-conectar", e);
      return voltar(tela, "meta=erro&motivo=" + encodeURIComponent(String((e as Error).message || e).slice(0, 120)));
    }
  }

  // ---------- ações (com login) ----------
  const usuario = createClient(base, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await db.from("membros").select("id, ativo, papel, conta_id").eq("id", u.user.id).maybeSingle();
  const admin = me?.ativo && me.papel === "admin";
  const cliente = me?.ativo && me.papel === "construtora" && !!me.conta_id;
  if (!admin && !cliente) return json({ erro: me?.papel === "construtora" ? "sem_conta_vinculada" : "sem_acesso" }, 403);
  let corpo: { acao?: string; conexao?: string; ids?: string[]; cliente?: string | null } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }

  if (corpo.acao === "iniciar") {
    if (!appId || !segredo) return json({ erro: "app_nao_configurado" }, 400);
    const estado = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("");
    await db.from("oauth_estados").delete().lt("criado_em", new Date(Date.now() - 3600e3).toISOString());
    await db.from("oauth_estados").insert({ estado, usuario: me!.id, provedor: "meta" });
    const escopos = admin ? ESCOPOS_ADMIN : ESCOPOS_CLIENTE;
    return json({ url: `https://www.facebook.com/${ver}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(retorno)}&state=${estado}&response_type=code&scope=${escopos.join(",")}` });
  }

  // conexão: o cliente só usa a dele; o admin usa qualquer uma
  const { data: cx } = await db.from("meta_conexoes").select("id, membro_id, conta_id, token, status").eq("id", corpo.conexao || "").maybeSingle();
  if (!cx || (!admin && cx.membro_id !== me!.id)) return json({ erro: "conexao_nao_encontrada" }, 404);

  if (corpo.acao === "desconectar") {
    await db.from("contas_anuncio").update({ ativo: false, conexao_id: null }).eq("conexao_id", cx.id);
    await db.from("meta_conexoes").delete().eq("id", cx.id);
    return json({ ok: true });
  }

  if (corpo.acao === "listar_contas" || corpo.acao === "vincular") {
    let lista;
    try { lista = await listarContas(cx.token, ver); }
    catch (e) {
      const msg = String((e as Error).message || e);
      await db.from("meta_conexoes").update({ status: /expired|session|invalid|validat/i.test(msg) ? "expirada" : "erro", ultimo_erro: msg.slice(0, 300) }).eq("id", cx.id);
      return json({ erro: "Meta: " + msg.slice(0, 300) }, 502);
    }
    const ids = lista.map((a) => a.id);
    const { data: existentes } = await db.from("contas_anuncio").select("id, conta_externa, conta_id, conexao_id, ativo").eq("plataforma", "meta");
    const porExt = new Map((existentes ?? []).map((e) => [String(e.conta_externa || "").replace(/\D/g, ""), e]));

    if (corpo.acao === "listar_contas") {
      return json({ contas: lista.map((a) => { const e = porExt.get(a.id);
        const deOutro = !admin && !!(e && e.conta_id && e.conta_id !== me!.conta_id);
        return { ...a, vinculada: !!(e && e.ativo && e.conexao_id === cx.id), de_outro_cliente: deOutro, conta_crm: e?.id || null, cliente_id: admin ? e?.conta_id || null : undefined };
      }) });
    }

    // vincular: só contas que este Facebook realmente acessa
    const escolhidas = new Set((corpo.ids || []).map((x) => String(x).replace(/\D/g, "")).filter((x) => ids.includes(x)));
    // admin: { cliente } define o cliente das contas marcadas (null = agência); sem { cliente }, mantém o que já estava
    const clienteDestino = admin ? corpo.cliente : me!.conta_id;
    let vinculadas = 0, recusadas = 0;
    for (const a of lista) {
      const e = porExt.get(a.id);
      if (escolhidas.has(a.id)) {
        if (!admin && e && e.conta_id && e.conta_id !== me!.conta_id) { recusadas++; continue; } // separação entre clientes
        const dados = { conexao_id: cx.id, ativo: true, moeda: a.moeda, status: a.status, ...(clienteDestino !== undefined ? { conta_id: clienteDestino } : {}) };
        if (e) await db.from("contas_anuncio").update(dados).eq("id", e.id);
        else await db.from("contas_anuncio").insert({ plataforma: "meta", conta_externa: a.id, nome: a.empresa && !a.nome.includes(a.empresa) ? `${a.nome} · ${a.empresa}` : a.nome, nicho: "outro", ...dados });
        vinculadas++;
      } else if (e && e.conexao_id === cx.id && e.ativo) {
        await db.from("contas_anuncio").update({ ativo: false }).eq("id", e.id);
      }
    }
    return json({ vinculadas, recusadas });
  }
  return json({ erro: "acao_invalida" }, 400);
});
