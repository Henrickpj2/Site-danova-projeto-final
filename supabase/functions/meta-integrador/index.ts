// danova AI — Integração Meta Ads por ID da conta (act_…) via integrador autorizado (Make · app Facebook Insights).
// Fluxo: banco (pg_cron ou botão "Conectar conta Meta") → webhook do cenário Make { token, retorno, desde, ate, contas[] }
//        → Make busca os insights no Meta com a conexão do Facebook da danova → POST aqui { acao: "dados", act, linhas } com x-token-interno.
// Ações com login (admin ou cliente dono da conta): { acao: "disparar", conta } → pede ao Make para buscar agora.
// Ações do integrador (cabeçalho x-token-interno = token "meta-integrador"): { acao: "dados", act, linhas } / { acao: "erro", act, mensagem }.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { mapearMetaAnuncio } from "./mapear.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token-interno" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }

  // ---------- integrador (Make) ----------
  const tokenInterno = req.headers.get("x-token-interno") || "";
  if (tokenInterno) {
    const { data: ok } = await db.rpc("validar_token_interno", { nome: "meta-integrador", token: tokenInterno });
    if (!ok) return json({ erro: "token_invalido" }, 401);
    const act = soDigitos(corpo.act);
    const { data: conta } = await db.from("contas_anuncio").select("id, conta_externa, moeda, campanhas_sel").eq("plataforma", "meta").eq("ativo", true).eq("conta_externa", act).maybeSingle();
    if (!conta) return json({ erro: "conta_nao_cadastrada" }, 404);
    const agora = new Date().toISOString();
    if (corpo.acao === "erro") {
      const msg = String(corpo.mensagem || "Sem acesso a esta conta pelo integrador").slice(0, 400);
      await db.from("contas_anuncio").update({ situacao: "erro", ultimo_erro: msg }).eq("id", conta.id);
      return json({ ok: true });
    }
    if (corpo.acao !== "dados") return json({ erro: "acao_invalida" }, 400);
    let linhas = corpo.linhas as unknown;
    if (typeof linhas === "string") { try { linhas = JSON.parse(linhas); } catch { linhas = []; } }
    if (linhas && !Array.isArray(linhas) && Array.isArray((linhas as { data?: unknown[] }).data)) linhas = (linhas as { data: unknown[] }).data;
    if (!Array.isArray(linhas)) return json({ erro: "linhas_invalidas" }, 400);
    const sel = new Set((Array.isArray(conta.campanhas_sel) ? conta.campanhas_sel : []).map((c: { id: string }) => String(c.id)));
    const moeda = String(corpo.moeda || conta.moeda || "BRL").toUpperCase().slice(0, 3);
    const anuncios = mapearMetaAnuncio(linhas.slice(0, 20000), act, moeda)
      .filter((l: { data: string; anuncio_id: string; campanha_id: string }) => /^\d{4}-\d{2}-\d{2}$/.test(l.data) && l.anuncio_id && (!sel.size || sel.has(l.campanha_id)));
    // campanha/dia para a tela Campanhas (soma dos anúncios; alcance somado é aproximado)
    const porCamp = new Map<string, Record<string, unknown>>();
    for (const l of anuncios as Record<string, any>[]) {
      const k = l.data + "|" + l.campanha;
      const c = porCamp.get(k) || { data: l.data, plataforma: "meta", conta_anuncio: act, campanha: l.campanha, conjunto: "", impressoes: 0, cliques: 0, custo: 0, moeda: moeda === "USD" ? "USD" : "BRL", conversoes: 0, valor_conversoes: 0, alcance: 0, origem: "api" };
      c.impressoes = (c.impressoes as number) + l.impressoes; c.cliques = (c.cliques as number) + (l.cliques_link || l.cliques);
      c.custo = Math.round(((c.custo as number) + l.custo) * 100) / 100; c.conversoes = (c.conversoes as number) + l.leads;
      c.valor_conversoes = (c.valor_conversoes as number) + l.valor_conversoes; c.alcance = (c.alcance as number) + (l.alcance || 0);
      porCamp.set(k, c);
    }
    for (let i = 0; i < anuncios.length; i += 500) {
      const { error } = await db.from("meta_insights").upsert(anuncios.slice(i, i + 500), { onConflict: "data,conta_anuncio,anuncio_id" });
      if (error) return json({ erro: "banco: " + error.message }, 500);
    }
    const camps = [...porCamp.values()];
    for (let i = 0; i < camps.length; i += 500) {
      const { error } = await db.from("campanhas_metricas").upsert(camps.slice(i, i + 500), { onConflict: "data,plataforma,conta_anuncio,campanha,conjunto" });
      if (error) return json({ erro: "banco: " + error.message }, 500);
    }
    const extra: Record<string, unknown> = { situacao: "conectada", ultimo_erro: null, ultima_sync: agora, moeda };
    if (corpo.nome) extra.nome = String(corpo.nome).slice(0, 120);
    await db.from("contas_anuncio").update(extra).eq("id", conta.id);
    return json({ ok: true, anuncios: anuncios.length, campanhas_dia: camps.length });
  }

  // ---------- CRM (login) ----------
  const usuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await db.from("membros").select("ativo, papel, conta_id").eq("id", u.user.id).maybeSingle();
  const admin = me?.ativo && me.papel === "admin";
  if (!admin && !(me?.ativo && me.papel === "construtora" && me.conta_id)) return json({ erro: "sem_acesso" }, 403);
  if (corpo.acao !== "disparar") return json({ erro: "acao_invalida" }, 400);
  let q = db.from("contas_anuncio").select("id, conta_externa, conta_id, ultima_sync").eq("plataforma", "meta").eq("ativo", true).neq("fonte_dados", "oauth");
  if (corpo.conta) q = q.eq("id", String(corpo.conta));
  if (!admin) q = q.eq("conta_id", me!.conta_id);
  const { data: contas } = await q;
  if (!contas?.length) return json({ erro: "sem_contas" }, 400);
  if (!admin && contas.some((c) => c.ultima_sync && Date.now() - new Date(c.ultima_sync).getTime() < 10 * 60e3)) return json({ erro: "aguarde", detalhe: "Os dados foram atualizados há menos de 10 minutos." }, 429);
  const dias = Math.min(Math.max(Number(corpo.dias) || 30, 1), 90);
  const { data: pedido, error } = await db.rpc("disparar_meta_integrador", { p_contas: contas.map((c) => c.id), p_dias: dias });
  if (error) return json({ erro: /integrador_nao_configurado/.test(error.message) ? "integrador_nao_configurado" : error.message }, 503);
  return json({ ok: true, pedido, contas: contas.length });
});
