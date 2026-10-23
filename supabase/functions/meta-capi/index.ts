// danova AI — envia ao Meta (API de Conversões, leads de CRM) as mudanças de etapa registradas no CRM:
// lead qualificado, visita, proposta, contrato e venda. Assim o Meta otimiza as campanhas por compradores reais.
// Segredos: META_PIXEL_ID (conjunto de dados), META_CAPI_TOKEN, META_GRAPH_VERSION (opcional), META_TEST_EVENT_CODE (opcional, para testar).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const NOMES: Record<string, string> = { qualificado: "Lead qualificado", visita: "Visita", proposta: "Proposta", contrato: "Contrato", fechado: "Venda" };

async function sha(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await usuario.from("membros").select("ativo, papel").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo || !["admin", "corretor"].includes(me.papel)) return json({ erro: "sem_acesso" }, 403);

  const pixel = Deno.env.get("META_PIXEL_ID"), token = Deno.env.get("META_CAPI_TOKEN");
  if (!pixel || !token) return json({ erro: "meta_nao_configurado" }, 503);
  const versao = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: fila } = await db.from("conversoes").select("id, lead_id, evento, valor, moeda, tentativas, criado_em").in("status", ["pendente", "erro"]).lt("tentativas", 5).order("id").limit(50);
  if (!fila?.length) return json({ enviados: 0 });
  const ids = [...new Set(fila.map((c) => c.lead_id))];
  const { data: leads } = await db.from("leads").select("id, email, telefone, pais, meta_lead_id").in("id", ids);
  const porId = new Map((leads ?? []).map((l) => [l.id, l]));

  const dados: any[] = [], usados: number[] = [], ignorados: number[] = [];
  for (const c of fila) {
    const l = porId.get(c.lead_id);
    const user: Record<string, unknown> = {};
    if (l?.email) user.em = [await sha(String(l.email).trim().toLowerCase())];
    if (l?.telefone) { const tel = String(l.telefone).replace(/\D/g, ""); if (tel.length >= 8) user.ph = [await sha(tel)]; }
    if (l?.meta_lead_id && /^\d+$/.test(l.meta_lead_id)) user.lead_id = Number(l.meta_lead_id);
    if (!Object.keys(user).length) { ignorados.push(c.id); continue; }
    const custom: Record<string, unknown> = { event_source: "crm", lead_event_source: "danova AI CRM" };
    if (c.valor) { custom.value = Number(c.valor); custom.currency = c.moeda || "USD"; }
    dados.push({ event_name: NOMES[c.evento] ?? c.evento, event_time: Math.floor(new Date(c.criado_em).getTime() / 1000), action_source: "system_generated", event_id: "danova-" + c.id, user_data: user, custom_data: custom });
    usados.push(c.id);
  }
  if (ignorados.length) await db.from("conversoes").update({ status: "ignorado", erro: "lead sem e-mail, telefone ou ID do Meta" }).in("id", ignorados);
  if (!dados.length) return json({ enviados: 0, ignorados: ignorados.length });

  const corpo: Record<string, unknown> = { data: dados };
  const teste = Deno.env.get("META_TEST_EVENT_CODE"); if (teste) corpo.test_event_code = teste;
  const r = await fetch(`https://graph.facebook.com/${versao}/${pixel}/events?access_token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const texto = await r.text();
  if (!r.ok) {
    for (const c of fila.filter((x) => usados.includes(x.id))) await db.from("conversoes").update({ status: "erro", tentativas: c.tentativas + 1, erro: texto.slice(0, 500) }).eq("id", c.id);
    return json({ erro: "meta_recusou", detalhe: texto.slice(0, 300) }, 502);
  }
  await db.from("conversoes").update({ status: "enviado", enviado_em: new Date().toISOString(), erro: null }).in("id", usados);
  return json({ enviados: usados.length, ignorados: ignorados.length });
});
