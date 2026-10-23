// danova AI — receptor de leads na Vercel (equivale ao public_html/api/lead.php da Hostinger).
// Recebe os formulários do site, encaminha ao CRM (Supabase) e, se configurado, avisa por e-mail.
// Variáveis opcionais na Vercel (Settings → Environment Variables):
//   RESEND_API_KEY  → envia o aviso por e-mail via resend.com
//   LEAD_TO         → quem recebe (padrão danielle@danova-ai.com)
//   LEAD_FROM       → remetente verificado no Resend (padrão "Site danova <site@danova-ai.com>")
const CRM_URL = "https://oeylfwasqvbnybzrwtgf.supabase.co";
// chave pública "anon" (a mesma de js/crm-config.js): só consegue chamar enviar_lead
const CRM_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leWxmd2FzcXZibnlienJ3dGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDkxNDYsImV4cCI6MjEwODEyNTE0Nn0.xfl5HyVe4RGqs0VYNt-a7Rox1Ro9ORQlkdNirxG3FeY";
const CAMPOS = ["name", "email", "phone", "message", "source", "language", "page", "lead_page",
  "budget", "timeline", "goal", "country", "lead_temperature",
  "first_touch_source", "first_touch_medium", "first_touch_campaign",
  "last_touch_source", "last_touch_medium", "last_touch_campaign",
  "utm_content", "utm_term", "gclid", "fbclid", "landing_page", "referrer",
  "objective", "interest", "unit_type", "is_realtor", "address", "quiz_profile", "source_context", "channel"];
// formulários que já gravam no CRM direto pelo navegador
const DIRETO_NO_CRM = ["leadForm", "videoForm"];
const recentes = new Map(); // limite simples por instância

function origemPermitida(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const h = new URL(o).hostname;
    return h === String(req.headers.host || "").split(":")[0] || h === "danova-ai.com" || h === "www.danova-ai.com";
  } catch { return false; }
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); } }
  return {};
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.headers.origin && origemPermitida(req)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!origemPermitida(req)) return res.status(403).json({ ok: false, error: "origin_not_allowed" });

  const d = await lerCorpo(req);
  if (d.website) return res.status(200).json({ ok: true }); // honeypot
  const lead = {};
  for (const f of CAMPOS) {
    let v = d[f] == null ? "" : (typeof d[f] === "object" ? JSON.stringify(d[f]) : String(d[f]));
    lead[f] = v.replace(/[\r\n]+/g, " ").replace(/<[^>]*>/g, "").trim().slice(0, 1000);
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email);
  if (!emailOk && !lead.phone) return res.status(422).json({ ok: false, error: "email_or_phone_required" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "0";
  const agora = Date.now();
  const hits = (recentes.get(ip) || []).filter((t) => agora - t < 600000);
  if (hits.length >= 10) return res.status(429).json({ ok: false, error: "rate_limited" });
  hits.push(agora); recentes.set(ip, hits);
  const chaveDup = "dup:" + (lead.email || lead.phone).toLowerCase();
  if (recentes.get(chaveDup) && agora - recentes.get(chaveDup) < 180000) return res.status(200).json({ ok: true, duplicate: true });
  recentes.set(chaveDup, agora);

  const tarefas = [];
  if (!DIRETO_NO_CRM.includes(lead.source)) {
    tarefas.push(fetch(CRM_URL + "/rest/v1/rpc/enviar_lead", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CRM_ANON, Authorization: "Bearer " + CRM_ANON },
      body: JSON.stringify({ dados: lead }),
    }).catch(() => null));
  }
  let enviado = false;
  if (process.env.RESEND_API_KEY) {
    const assunto = "Novo lead site Danova: " + (lead.name || lead.email || lead.phone) + " [" + (lead.lead_page || lead.page || "site") + "]";
    const texto = "Novo contato recebido pelo site\n\n" + Object.entries(lead).filter(([, v]) => v).map(([k, v]) => k.padEnd(22) + ": " + v).join("\n") +
      "\n\nRecebido em: " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC\n";
    tarefas.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.LEAD_FROM || "Site danova <site@danova-ai.com>", to: [process.env.LEAD_TO || "danielle@danova-ai.com"], reply_to: emailOk ? lead.email : undefined, subject: assunto, text: texto }),
    }).then((r) => { enviado = r.ok; }).catch(() => null));
  }
  await Promise.all(tarefas);
  return res.status(200).json({ ok: true, mailed: enviado });
};
