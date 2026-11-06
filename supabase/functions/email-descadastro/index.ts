// danova AI — descadastro de comunicações comerciais (link do rodapé dos e-mails e "List-Unsubscribe" de um clique).
// POST ?s=<id do envio>&t=<assinatura>  → grava o e-mail em email_descadastros. Sem login; a assinatura impede abuso.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
async function hmac(texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("SUPABASE_SERVICE_ROLE_KEY") + ":descadastro"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
  return Array.from(s.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const url = new URL(req.url);
  let s = url.searchParams.get("s") || "", t = url.searchParams.get("t") || "";
  if (!s || !t) { try { const b = await req.json(); s = String(b.s || ""); t = String(b.t || ""); } catch { /* corpo de um clique */ } }
  if (!/^[0-9a-f-]{36}$/i.test(s) || !/^[0-9a-f]{32}$/i.test(t)) return json({ erro: "link_invalido" }, 400);
  if ((await hmac(s)) !== t.toLowerCase()) return json({ erro: "link_invalido" }, 400);
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: envio } = await db.from("email_sends").select("id, lead_id, destinatario_email").eq("id", s).maybeSingle();
  if (!envio) return json({ erro: "link_invalido" }, 404);
  const email = String(envio.destinatario_email).toLowerCase();
  await db.from("email_descadastros").upsert({ email, lead_id: envio.lead_id, motivo: "Link de descadastro no e-mail" }, { onConflict: "email", ignoreDuplicates: true });
  await db.from("email_events").insert({ send_id: envio.id, tipo: "descadastro", dados: {} });
  if (envio.lead_id) await db.from("lead_eventos").insert({ lead_id: envio.lead_id, tipo: "nota", texto: "Contato pediu para não receber mais e-mails comerciais (descadastro)." });
  return json({ ok: true });
});
