// danova AI — recebe leads de formulários externos (Elementor, WordPress, RD Station, Typeform, Google Forms, HubSpot, Webflow…)
// URL: /functions/v1/captura-lead?fonte=CODIGO-DA-FONTE   · aceita JSON ou formulário (x-www-form-urlencoded / multipart)
// Descobre sozinho nome, e-mail, telefone e mensagem em qualquer formato e grava pelo enviar_lead (mesmas regras do site).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Par = { k: string; v: string };
// percorre qualquer estrutura e devolve pares chave → valor (Typeform, RD, Elementor avançado etc.)
function achatar(x: unknown, chave = "", out: Par[] = []): Par[] {
  if (x == null) return out;
  if (Array.isArray(x)) { x.forEach((y) => achatar(y, chave, out)); return out; }
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    // Typeform: { field: { ref/title }, type: "email", email: "…" } · Elementor avançado: { title, value }
    const rot = String((o.field as Record<string, unknown>)?.ref ?? (o.field as Record<string, unknown>)?.title ?? o.title ?? o.label ?? o.name ?? o.id ?? "");
    const val = o.value ?? o.email ?? o.phone_number ?? o.text ?? o.number ?? o.answer;
    if (rot && (typeof val === "string" || typeof val === "number")) out.push({ k: (rot + " " + String(o.type ?? "")).toLowerCase(), v: String(val) });
    for (const [k, v] of Object.entries(o)) achatar(v, (chave ? chave + "." : "") + k, out);
    return out;
  }
  if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") out.push({ k: chave.toLowerCase(), v: String(x) });
  return out;
}
function pegar(pares: Par[], nomes: string[], teste?: (v: string) => boolean) {
  for (const n of nomes) { const p = pares.find((q) => q.k.includes(n) && q.v.trim() && (!teste || teste(q.v.trim()))); if (p) return p.v.trim(); }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "use POST" }, 405);
  const url = new URL(req.url);
  const fonte = (url.searchParams.get("fonte") || "formulario-externo").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60) || "formulario-externo";

  let corpo: unknown = {};
  const tipo = req.headers.get("content-type") || "";
  try {
    if (tipo.includes("json")) corpo = await req.json();
    else if (tipo.includes("form")) { const f = await req.formData(); const o: Record<string, string> = {}; f.forEach((v, k) => { if (typeof v === "string") o[k] = v; }); corpo = o; }
    else { const t = await req.text(); try { corpo = JSON.parse(t); } catch { corpo = Object.fromEntries(new URLSearchParams(t)); } }
  } catch { return json({ ok: false, erro: "corpo inválido" }, 400); }

  const pares = achatar(corpo);
  const email = pegar(pares, ["email", "e-mail", "mail"], (v) => EMAIL.test(v)) || (pares.find((p) => EMAIL.test(p.v.trim()))?.v.trim() ?? "");
  const tel = pegar(pares, ["whats", "celular", "mobile", "telefone", "phone", "fone", "tel"], (v) => v.replace(/\D/g, "").length >= 8);
  if (!email && !tel) return json({ ok: false, erro: "sem e-mail ou telefone" }, 422);
  const nome = pegar(pares, ["nome completo", "full name", "nome", "name", "first"], (v) => !EMAIL.test(v) && v.replace(/\D/g, "").length < 6);
  const dados: Record<string, string> = {
    name: nome.slice(0, 200), email, phone: tel,
    notes: pegar(pares, ["mensagem", "message", "coment", "duvida", "dúvida", "obs"]).slice(0, 3000),
    project: (url.searchParams.get("empreendimento") || pegar(pares, ["empreendimento", "imovel", "imóvel", "produto", "interesse", "modelo"])).slice(0, 200),
    budget: pegar(pares, ["orcamento", "orçamento", "budget", "renda", "valor"]).slice(0, 120),
    country: pegar(pares, ["cidade", "city", "estado", "pais", "país", "country"]).slice(0, 80),
    lead_page: fonte,
    first_touch_source: pegar(pares, ["utm_source"]) || (pegar(pares, ["gclid"]) ? "google" : pegar(pares, ["fbclid"]) ? "facebook" : fonte),
    first_touch_medium: pegar(pares, ["utm_medium"]), first_touch_campaign: pegar(pares, ["utm_campaign"]),
    last_touch_campaign: pegar(pares, ["utm_campaign"]), gclid: pegar(pares, ["gclid"]), fbclid: pegar(pares, ["fbclid"]),
    landing_page: pegar(pares, ["page_url", "referer", "referrer", "pagina", "url"]).slice(0, 300),
    website: pegar(pares, ["website"]), // armadilha anti-robô do site
  };
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("enviar_lead", { dados });
  if (error) return json({ ok: false, erro: error.message.includes("limite") ? "muitos envios, tente em 1 minuto" : "não foi possível registrar" }, error.message.includes("limite") ? 429 : 400);
  return json({ ok: true, lead_id: data });
});
