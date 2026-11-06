// danova AI — Central de E-mails: prévia e envio pelo provedor transacional (Resend).
// A chave fica só no servidor: Supabase → Edge Functions → Secrets → RESEND_API_KEY.
// Sem RESEND_API_KEY, o envio sai pelo e-mail da Hostinger (public_html/api/email-enviar.php).
// Opcional: EMAIL_REMETENTE (padrão "DANOVA-AI <contato@danova-ai.com>"), EMAIL_RESPONDER_PARA (padrão danova-ai@danova-ai.com).
// Ações (com login de admin ou do corretor responsável pelo lead):
//   { acao: "previa", lead_id, assunto, corpo_html, vars }  → { assunto, html }
//   { acao: "enviar", lead_id, template_id, assunto, corpo_html, vars, chave } → { ok, envio }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { montarEmail, substituir, emailValido } from "./layout.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
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
  let corpo: Record<string, any> = {};
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const usuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await db.from("membros").select("id, nome, email, telefone, papel, ativo").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo || !["admin", "corretor"].includes(me.papel)) return json({ erro: "sem_acesso" }, 403);

  // ---- envio pelo e-mail da Hostinger: o servidor do site (api/email-enviar.php) reserva e depois informa o resultado ----
  if (corpo.acao === "hostinger_reservar" || corpo.acao === "hostinger_resultado") {
    const id = String(corpo.envio_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ erro: "envio_invalido" }, 400);
    if (corpo.acao === "hostinger_reservar") {
      const dezMinAtras = new Date(Date.now() - 10 * 60e3).toISOString();
      const { data: r } = await db.from("email_sends").update({ status: "enviando", atualizado_em: new Date().toISOString() })
        .eq("id", id).eq("status", "pendente").eq("provedor", "hostinger").eq("enviado_por", me.id).gte("criado_em", dezMinAtras)
        .select("id, lead_id, destinatario_email, destinatario_nome, assunto, corpo_html").maybeSingle();
      if (!r) return json({ erro: "envio_indisponivel" }, 409);
      const { data: ld } = await db.from("leads").select("corretor_id").eq("id", r.lead_id).maybeSingle();
      const { data: cor } = ld?.corretor_id ? await db.from("membros").select("email").eq("id", ld.corretor_id).maybeSingle() : { data: null };
      const sair = env("SUPABASE_URL") + "/functions/v1/email-descadastro?s=" + r.id + "&t=" + await hmac(r.id);
      return json({ ok: true, para: r.destinatario_email, nome: r.destinatario_nome, assunto: r.assunto, html: r.corpo_html,
        responder: cor?.email && emailValido(cor.email) ? cor.email : "danova-ai@danova-ai.com", descadastro: sair });
    }
    const sucesso = corpo.ok === true;
    const erroTxt = String(corpo.erro || "O servidor de e-mail da Hostinger recusou o envio").slice(0, 300);
    const { data: r } = await db.from("email_sends").update({ status: sucesso ? "enviado" : "falhou", erro: sucesso ? null : erroTxt, atualizado_em: new Date().toISOString() })
      .eq("id", id).eq("status", "enviando").eq("enviado_por", me.id).select("id, lead_id, assunto, modelo").maybeSingle();
    if (!r) return json({ erro: "envio_indisponivel" }, 409);
    await db.from("email_events").insert({ send_id: r.id, tipo: sucesso ? "enviado" : "falha", dados: sucesso ? { via: "hostinger" } : { via: "hostinger", erro: erroTxt } });
    if (sucesso) await db.from("lead_eventos").insert({ lead_id: r.lead_id, autor_id: me.id, tipo: "nota", texto: "E-mail enviado: “" + r.assunto + "” (" + (r.modelo || "personalizado") + ") por " + me.nome });
    return json({ ok: true });
  }

  const leadId = String(corpo.lead_id || "");
  const { data: lead } = await db.from("leads").select("id, nome, email, corretor_id").eq("id", leadId).maybeSingle();
  if (!lead) return json({ erro: "lead_nao_encontrado" }, 404);
  if (me.papel !== "admin" && lead.corretor_id !== me.id) return json({ erro: "sem_acesso" }, 403);

  const { data: corretor } = lead.corretor_id ? await db.from("membros").select("nome, email, telefone").eq("id", lead.corretor_id).maybeSingle() : { data: null };
  const assinante = corretor || me;
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(corpo.vars || {})) vars[String(k)] = String(v ?? "").slice(0, 500);
  vars.nome_cliente = vars.nome_cliente || String(lead.nome || "").split(" ")[0] || "";
  vars.email_cliente = String(lead.email || "");
  vars.nome_corretor = vars.nome_corretor || String(assinante.nome || "");

  const assuntoBruto = String(corpo.assunto || "").slice(0, 300);
  const corpoBruto = String(corpo.corpo_html || "").slice(0, 60000);
  if (!assuntoBruto.trim() || !corpoBruto.trim()) return json({ erro: "conteudo_vazio" }, 400);
  const assunto = substituir(assuntoBruto, vars, false).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const urlFuncaoSair = env("SUPABASE_URL") + "/functions/v1/email-descadastro";
  const urlPaginaSair = "https://danova-ai.com/descadastro.html";

  if (corpo.acao === "previa") {
    const html = montarEmail({ corpoHtml: substituir(corpoBruto, vars, true), assinante, descadastro: urlPaginaSair, previa: true });
    return json({ assunto, html });
  }
  if (corpo.acao !== "enviar") return json({ erro: "acao_invalida" }, 400);

  const para = String(lead.email || "").trim().toLowerCase();
  if (!emailValido(para)) return json({ erro: "email_invalido", detalhe: "O cliente não tem um e-mail válido cadastrado." }, 400);
  const { data: bloqueado } = await db.from("email_descadastros").select("email").eq("email", para).maybeSingle();
  if (bloqueado) return json({ erro: "descadastrado", detalhe: "Este contato pediu para não receber mais e-mails." }, 409);

  const chave = String(corpo.chave || "").slice(0, 80);
  if (!chave) return json({ erro: "sem_chave" }, 400);
  const { data: jaExiste } = await db.from("email_sends").select("id, status").eq("chave_idempotencia", chave).maybeSingle();
  if (jaExiste) return json({ erro: "duplicado", detalhe: "Este e-mail já foi enviado.", envio: jaExiste }, 409);
  const dezMin = new Date(Date.now() - 10 * 60e3).toISOString();
  const { data: recente } = await db.from("email_sends").select("id").eq("lead_id", lead.id).eq("assunto", assunto).in("status", ["enviado", "entregue", "aberto", "clicado", "pendente", "enviando"]).gte("criado_em", dezMin).limit(1);
  if (recente?.length && !corpo.forcar) return json({ erro: "repetido", detalhe: "Um e-mail com o mesmo assunto foi enviado para este cliente há menos de 10 minutos." }, 409);

  let modelo = "", templateId: string | null = null;
  if (corpo.template_id) {
    const { data: t } = await db.from("email_templates").select("id, nome").eq("id", String(corpo.template_id)).maybeSingle();
    if (t) { modelo = t.nome; templateId = t.id; }
  }
  const { data: envio, error: eIns } = await db.from("email_sends").insert({
    lead_id: lead.id, template_id: templateId, modelo: modelo || "Personalizado", destinatario_nome: lead.nome, destinatario_email: para,
    assunto, enviado_por: me.id, enviado_por_nome: me.nome, status: "pendente", chave_idempotencia: chave, provedor: env("RESEND_API_KEY") ? "resend" : "hostinger",
  }).select("id").single();
  if (eIns) return json({ erro: /duplicate/.test(eIns.message) ? "duplicado" : "banco", detalhe: eIns.message }, 409);

  const assinaturaSair = "?s=" + envio.id + "&t=" + await hmac(envio.id);
  const linkSair = urlPaginaSair + assinaturaSair, linkUmClique = urlFuncaoSair + assinaturaSair;
  const html = montarEmail({ corpoHtml: substituir(corpoBruto, vars, true), assinante, descadastro: linkSair });
  await db.from("email_sends").update({ corpo_html: html }).eq("id", envio.id);

  const chaveApi = env("RESEND_API_KEY");
  if (!chaveApi) {
    // sem provedor externo: o navegador entrega o envio ao servidor do site (Hostinger), que dispara pelo e-mail do domínio
    return json({ ok: true, via: "hostinger", envio: { id: envio.id, status: "pendente" } });
  }
  const remetente = env("EMAIL_REMETENTE") || "DANOVA-AI <contato@danova-ai.com>";
  const responder = env("EMAIL_RESPONDER_PARA") || (corretor?.email && emailValido(corretor.email) ? corretor.email : "danova-ai@danova-ai.com");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + chaveApi, "Content-Type": "application/json", "Idempotency-Key": chave },
      body: JSON.stringify({
        from: remetente, to: [para], reply_to: responder, subject: assunto, html,
        headers: { "List-Unsubscribe": "<" + linkUmClique + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: [{ name: "envio", value: envio.id }],
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(out?.message || out?.error || ("HTTP " + r.status)).slice(0, 400);
      await db.from("email_sends").update({ status: "falhou", erro: msg, atualizado_em: new Date().toISOString() }).eq("id", envio.id);
      await db.from("email_events").insert({ send_id: envio.id, tipo: "falha", dados: { status: r.status, resposta: out } });
      return json({ erro: "falha_provedor", detalhe: msg, envio: { id: envio.id } }, 502);
    }
    await db.from("email_sends").update({ status: "enviado", provedor_id: out.id, atualizado_em: new Date().toISOString() }).eq("id", envio.id);
    await db.from("email_events").insert({ send_id: envio.id, provedor_id: out.id, tipo: "enviado", dados: {} });
    await db.from("lead_eventos").insert({ lead_id: lead.id, autor_id: me.id, tipo: "nota", texto: "E-mail enviado: “" + assunto + "” (" + (modelo || "personalizado") + ") por " + me.nome });
    return json({ ok: true, envio: { id: envio.id, provedor_id: out.id, status: "enviado" } });
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 400);
    await db.from("email_sends").update({ status: "falhou", erro: msg, atualizado_em: new Date().toISOString() }).eq("id", envio.id);
    return json({ erro: "falha_provedor", detalhe: msg, envio: { id: envio.id } }, 502);
  }
});
