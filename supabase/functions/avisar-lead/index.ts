// danova AI — avisa o corretor (e o administrador) por e-mail quando um lead chega ou muda de corretor.
// Chamada pelo próprio banco (gatilho em public.leads, via pg_net) com um token interno.
// Segredos: RESEND_API_KEY (obrigatório para enviar), AVISO_REMETENTE (opcional, padrão "danova AI <avisos@danova-ai.com>";
// o domínio precisa estar verificado no Resend), CRM_URL (opcional, padrão https://danova-ai.com/crm/).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = req.headers.get("x-token-interno") ?? "";
  const { data: ok } = await db.rpc("validar_token_interno", { nome: "avisar-lead", token });
  if (!ok) return json({ erro: "sem_acesso" }, 403);

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const leadId = String(corpo.lead_id ?? "");
  const motivo = corpo.motivo === "atribuido" ? "atribuido" : "novo";

  const { data: lead } = await db.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (!lead) return json({ erro: "lead_nao_encontrado" }, 404);
  const { data: membros } = await db.from("membros").select("id, nome, email, papel, ativo").eq("ativo", true);
  const corretor = (membros ?? []).find((m) => m.id === lead.corretor_id);
  const admins = (membros ?? []).filter((m) => m.papel === "admin");

  // corretor recebe os leads dele; administradores recebem todo lead novo (não as reatribuições)
  const para = new Map<string, { id: string; nome: string; email: string; papel: string }>();
  if (corretor?.email) para.set(corretor.email.toLowerCase(), corretor);
  if (motivo === "novo") for (const a of admins) if (a.email) para.set(a.email.toLowerCase(), a);
  if (!para.size) return json({ ok: true, enviados: 0 });

  const chave = Deno.env.get("RESEND_API_KEY");
  const crm = (Deno.env.get("CRM_URL") || "https://danova-ai.com/crm/").replace(/\/?$/, "/");
  const remetente = Deno.env.get("AVISO_REMETENTE") || "danova AI <avisos@danova-ai.com>";
  const tel = String(lead.telefone ?? "").replace(/\D/g, "");
  const nome = lead.nome || lead.email || lead.telefone || "Lead";
  const linhas: [string, unknown][] = [
    ["Empreendimento", lead.empreendimento], ["Objetivo", lead.objetivo], ["Orçamento", lead.orcamento], ["País", lead.pais],
    ["Perfil", lead.perfil], ["Temperatura", lead.temperatura], ["Origem", [lead.canal, lead.origem, lead.campanha].filter(Boolean).join(" · ")],
    ["Telefone", lead.telefone], ["E-mail", lead.email],
  ];
  const html = (destino: { nome: string; id: string }) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172334">
  <div style="background:#0b1424;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><b style="font-size:17px">${motivo === "novo" ? "Novo lead" : "Lead atribuído a você"}</b><br><span style="color:#93a3b8;font-size:13px">danova AI · CRM</span></div>
  <div style="border:1px solid #e3e8ef;border-top:0;border-radius:0 0 14px 14px;padding:20px 22px">
    <p style="margin:0 0 4px;font-size:20px;font-weight:bold">${esc(nome)}</p>
    <p style="margin:0 0 16px;color:#66758a;font-size:13px">${destino.id === lead.corretor_id ? "Responsável: você" : "Responsável: " + esc(corretor?.nome || "ainda sem corretor")}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${linhas.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 0;color:#66758a;width:130px">${k}</td><td style="padding:6px 0">${esc(v)}</td></tr>`).join("")}</table>
    ${lead.mensagem ? `<p style="background:#f4f7fa;border-radius:10px;padding:12px;font-size:14px;white-space:pre-line;margin:14px 0 0">${esc(String(lead.mensagem).slice(0, 1200))}</p>` : ""}
    <p style="margin:20px 0 0">${tel ? `<a href="https://wa.me/${tel}" style="background:#16b8a6;color:#04211e;text-decoration:none;padding:11px 16px;border-radius:999px;font-weight:bold;margin-right:8px;display:inline-block">Chamar no WhatsApp</a>` : ""}<a href="${crm}#leads" style="background:#0b1424;color:#fff;text-decoration:none;padding:11px 16px;border-radius:999px;font-weight:bold;display:inline-block">Abrir no CRM</a></p>
    <p style="color:#93a3b8;font-size:12px;margin-top:18px">Responda rápido: leads atendidos nos primeiros 5 minutos convertem muito mais.</p>
  </div></div>`;

  let enviados = 0;
  for (const [email, m] of para) {
    let status = "sem_chave", erro: string | null = null;
    if (chave) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
        body: JSON.stringify({ from: remetente, to: [email], subject: `${motivo === "novo" ? "Novo lead" : "Lead para você"}: ${nome}${lead.empreendimento ? " · " + lead.empreendimento : ""}`.replace(/[\r\n]+/g, " ").slice(0, 180), html: html(m) }),
      });
      if (r.ok) { status = "enviado"; enviados++; } else { status = "erro"; erro = (await r.text()).slice(0, 300); }
    }
    await db.from("avisos_lead").insert({ lead_id: lead.id, membro_id: m.id, canal: "email", destino: email, motivo, status, erro });
  }
  return json({ ok: true, enviados });
});
