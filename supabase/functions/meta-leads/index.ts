// danova AI — recebe leads dos formulários do Meta (Facebook/Instagram Lead Ads) e cria no CRM.
// Configure no app do Meta (Webhooks → Page → campo "leadgen") a URL desta função e o token de verificação.
// Segredos: META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_TOKEN (token de página com leads_retrieval), META_GRAPH_VERSION (opcional, padrão v23.0)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ok = (b: unknown = "ok", s = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: s });

async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string) {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = cabecalho.slice(7);
  if (hex.length !== recebido.length) return false;
  let dif = 0; for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

// Converte os campos do formulário do Meta para o formato do CRM
export function mapearCampos(field_data: { name: string; values: string[] }[]) {
  const d: Record<string, string> = {};
  const extras: string[] = [];
  for (const f of field_data ?? []) {
    const nome = (f.name || "").toLowerCase(), valor = (f.values ?? []).join(", ").trim();
    if (!valor) continue;
    if (["full_name", "nome", "nome_completo", "name"].includes(nome)) d.name = valor;
    else if (nome === "first_name") d.name = (valor + " " + (d.name ?? "")).trim();
    else if (nome === "last_name") d.name = ((d.name ?? "") + " " + valor).trim();
    else if (["email", "e-mail"].includes(nome)) d.email = valor;
    else if (["phone_number", "phone", "telefone", "whatsapp"].includes(nome)) d.phone = valor;
    else if (["country", "pais", "país"].includes(nome)) d.country = valor;
    else if (nome.includes("orcamento") || nome.includes("orçamento") || nome.includes("budget")) d.budget = valor;
    else if (nome.includes("objetivo") || nome.includes("goal")) d.goal = valor;
    else if (nome.includes("prazo") || nome.includes("timeline")) d.timeline = valor;
    else if (nome.includes("empreendimento") || nome.includes("project")) d.project = valor;
    else extras.push(f.name + ": " + valor);
  }
  if (extras.length) d.notes = extras.join("\n");
  return d;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // verificação do webhook pelo Meta
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === Deno.env.get("META_VERIFY_TOKEN")) {
      return ok(url.searchParams.get("hub.challenge") ?? "");
    }
    return ok("forbidden", 403);
  }
  if (req.method !== "POST") return ok("method", 405);

  const bruto = await req.text();
  const segredo = Deno.env.get("META_APP_SECRET");
  if (!segredo || !(await assinaturaValida(bruto, req.headers.get("x-hub-signature-256"), segredo))) return ok("assinatura", 401);

  const token = Deno.env.get("META_PAGE_TOKEN");
  const versao = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let corpo: any; try { corpo = JSON.parse(bruto); } catch { return ok("json", 400); }

  const resultados: unknown[] = [];
  for (const entry of corpo.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value?.leadgen_id) continue;
      const leadgenId = String(ch.value.leadgen_id);
      const { data: existe } = await db.from("leads").select("id").eq("meta_lead_id", leadgenId).maybeSingle();
      if (existe) { resultados.push({ leadgenId, duplicado: true }); continue; }
      if (!token) { resultados.push({ leadgenId, erro: "META_PAGE_TOKEN ausente" }); continue; }
      const r = await fetch(`https://graph.facebook.com/${versao}/${leadgenId}?fields=field_data,created_time,ad_id,ad_name,adset_name,campaign_name,form_id,platform&access_token=${encodeURIComponent(token)}`);
      if (!r.ok) { console.error(await r.text()); resultados.push({ leadgenId, erro: "graph " + r.status }); continue; }
      const lead = await r.json();
      const d = mapearCampos(lead.field_data);
      const plataforma = String(lead.platform || "").toLowerCase().includes("ig") ? "instagram" : "facebook";
      const { data: id, error } = await db.rpc("enviar_lead", {
        dados: {
          ...d, language: "pt", source: "meta-lead-ads", lead_page: "meta-lead-ads",
          first_touch_source: plataforma, first_touch_medium: "paid-social", first_touch_campaign: lead.campaign_name ?? null,
          last_touch_source: plataforma, last_touch_medium: "paid-social", last_touch_campaign: lead.campaign_name ?? null,
        },
      });
      if (error || !id) { resultados.push({ leadgenId, erro: error?.message ?? "sem id" }); continue; }
      await db.from("leads").update({ meta_lead_id: leadgenId, campanha: lead.campaign_name ?? null }).eq("id", id);
      await db.from("lead_eventos").insert({ lead_id: id, tipo: "nota", texto: `Lead do formulário do Meta (${plataforma}) · campanha: ${lead.campaign_name ?? "—"} · conjunto: ${lead.adset_name ?? "—"} · anúncio: ${lead.ad_name ?? "—"}` });
      resultados.push({ leadgenId, lead: id });
    }
  }
  return ok({ recebidos: resultados.length, resultados });
});
