// danova AI — webhook do Resend com entrega, rejeição, abertura e cliques dos e-mails.
// Configure no Resend → Webhooks a URL desta função; copie o "Signing secret" (whsec_...) para o segredo RESEND_WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const env = (k: string) => Deno.env.get(k) || "";
const MAPA: Record<string, string> = { "email.sent": "enviado", "email.delivered": "entregue", "email.delivery_delayed": "atrasado", "email.bounced": "rejeitado", "email.complained": "reclamacao", "email.opened": "aberto", "email.clicked": "clicado", "email.failed": "falhou" };
const ORDEM = ["pendente", "enviado", "atrasado", "entregue", "aberto", "clicado"];

async function assinaturaOk(corpo: string, h: Headers) {
  const segredo = env("RESEND_WEBHOOK_SECRET"); if (!segredo) return false;
  const id = h.get("svix-id") || "", ts = h.get("svix-timestamp") || "", sig = h.get("svix-signature") || "";
  if (!id || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  const chave = Uint8Array.from(atob(segredo.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(id + "." + ts + "." + corpo)))));
  return sig.split(" ").some((p) => p.split(",")[1] === mac);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("metodo", { status: 405 });
  const bruto = await req.text();
  if (!(await assinaturaOk(bruto, req.headers))) return new Response("assinatura", { status: 401 });
  let ev: any; try { ev = JSON.parse(bruto); } catch { return new Response("json", { status: 400 }); }
  const tipo = MAPA[ev?.type]; const pid = String(ev?.data?.email_id || "");
  if (!tipo || !pid) return new Response("ok");
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: envio } = await db.from("email_sends").select("id, status, lead_id, destinatario_email").eq("provedor_id", pid).maybeSingle();
  if (!envio) return new Response("ok");
  await db.from("email_events").insert({ send_id: envio.id, provedor_id: pid, tipo, dados: { evento: ev.type, em: ev.created_at, bounce: ev.data?.bounce ?? null, link: ev.data?.click?.link ?? null } });
  const finais = ["rejeitado", "reclamacao", "falhou"];
  const avanca = finais.includes(tipo) || (!finais.includes(envio.status) && ORDEM.indexOf(tipo) > ORDEM.indexOf(envio.status));
  if (avanca) await db.from("email_sends").update({ status: tipo, erro: tipo === "rejeitado" ? String(ev.data?.bounce?.message || "E-mail rejeitado pelo servidor do destinatário").slice(0, 300) : null, atualizado_em: new Date().toISOString() }).eq("id", envio.id);
  if (tipo === "reclamacao") await db.from("email_descadastros").upsert({ email: String(envio.destinatario_email).toLowerCase(), lead_id: envio.lead_id, motivo: "Marcou como spam" }, { onConflict: "email", ignoreDuplicates: true });
  return new Response("ok");
});
