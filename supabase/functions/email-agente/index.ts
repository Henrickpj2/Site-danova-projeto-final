// danova AI — Agente de IA de e-mails programados.
// • Tarefas programadas (cabeçalho x-token-interno, ver privado.disparar_email_agente):
//     planejar  (a cada hora)    → aplica as regras ativas e cria RASCUNHOS escritos pela IA (nada sai sem aprovação)
//     despachar (a cada 5 min)   → envia os AGENDADOS cujo horário chegou, pelo servidor do site (api/email-fila.php)
// • Servidor do site (sem login, com ticket de uso único): buscar
// • CRM (login de admin ou do corretor do lead): salvar, aprovar, descartar, cancelar, agendar, campanha (admin), planejar_agora (admin)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { montarEmail, emailValido } from "./layout.ts";
import { buscar, formatar } from "./rag.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token-interno" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const SITE_FILA = "https://danova-ai.com/api/email-fila.php";
const PAGINA_SAIR = "https://danova-ai.com/descadastro.html";
const FECHADAS = ["fechado", "perdido"];
const NOMES: Record<string, string> = { ia_followup: "Agente de IA · Follow-up", ia_boasvindas: "Agente de IA · Boas-vindas", ia_data: "Agente de IA · Data marcada", campanha: "Campanha", agendado: "Agendado" };
// deno-lint-ignore no-explicit-any
type Db = any; type Row = Record<string, any>;

const sha = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("SUPABASE_SERVICE_ROLE_KEY") + ":descadastro"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
  return Array.from(s.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function textoParaHtml(t: string) {
  const lnk = (x: string) => esc(x).replace(/(https?:\/\/[^\s<)]*[^\s<).,;:!?])/g, '<a href="$1">$1</a>');
  return String(t || "").replace(/\r/g, "").split(/\n\s*\n/).map((bloco) => {
    const l = bloco.split("\n").filter((x) => x.trim()); if (!l.length) return "";
    if (l.every((x) => /^\s*[•\-*]\s+/.test(x))) return "<ul>" + l.map((x) => "<li>" + lnk(x.replace(/^\s*[•\-*]\s+/, "")) + "</li>").join("") + "</ul>";
    return "<p>" + l.map(lnk).join("<br>") + "</p>";
  }).join("");
}
function htmlParaTexto(h: string) {
  return String(h || "")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, u, t) => { const tt = t.replace(/<[^>]+>/g, ""); return /^https?:/.test(u) && !u.includes(tt) && !tt.includes(u.replace(/^https?:\/\//, "")) ? `${tt} (${u})` : u; })
    .replace(/<li[^>]*>/gi, "\n• ").replace(/<\/(p|ul|ol)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const trocar = (t: string, v: Record<string, string>) => String(t || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k) => v[k.toLowerCase()] ?? "");
function moeda(n: unknown) { const v = Number(n); if (!n || !isFinite(v)) return "sob consulta"; return v >= 1e6 ? "US$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi" : "US$ " + Math.round(v / 1e3).toLocaleString("pt-BR") + " mil"; }

// horário de Brasília (UTC-3, sem horário de verão)
const BRT = 3 * 3600e3;
function hojeBRT() { return new Date(Date.now() - BRT).toISOString().slice(0, 10); }
function horarioEm(dataISO: string, hora: number) { return new Date(Date.parse(dataISO + "T00:00:00Z") + hora * 3600e3 + BRT); }
function proximoHorario(hora: number, dataISO?: string) {
  let d = horarioEm(dataISO || hojeBRT(), hora);
  while (d.getTime() < Date.now() + 5 * 60e3) d = new Date(d.getTime() + 864e5);
  return d.toISOString();
}

// ---------- contexto ----------
async function base(db: Db) {
  const [emps, membros, descad] = await Promise.all([
    db.from("empreendimentos").select("id, nome, cidade, endereco, preco_a_partir, condicoes, link, entrega, status").eq("ativo", true),
    db.from("membros").select("id, nome, email, telefone, papel, ativo"),
    db.from("email_descadastros").select("email"),
  ]);
  return { emps: (emps.data || []) as Row[], membros: (membros.data || []) as Row[], descad: new Set(((descad.data || []) as Row[]).map((d) => String(d.email).toLowerCase())) };
}
type Base = Awaited<ReturnType<typeof base>>;
function empDoLead(b: Base, l: Row) { return b.emps.find((e) => e.id === l.empreendimento_id) || b.emps.find((e) => e.nome === l.empreendimento) || null; }
function varsDoLead(b: Base, l: Row) {
  const e = empDoLead(b, l) || {} as Row; const c = b.membros.find((m) => m.id === l.corretor_id) || {} as Row;
  return { nome_cliente: String(l.nome || "").split(" ")[0], email_cliente: l.email || "", nome_corretor: c.nome || "Equipe DANOVA-AI",
    empreendimento: e.nome || l.empreendimento || "", localizacao: [e.endereco, e.cidade].filter(Boolean).join(", "), valor: moeda(e.preco_a_partir),
    condicoes: e.condicoes || "sob consulta", link_empreendimento: e.link || "https://danova-ai.com/#empreendimentos" } as Record<string, string>;
}
function elegivel(b: Base, l: Row) { return l.email && emailValido(l.email) && !b.descad.has(String(l.email).toLowerCase()) && !FECHADAS.includes(l.etapa); }

// ---------- IA ----------
const FERRAMENTA = { name: "escrever_email", description: "Entrega o e-mail pronto para revisão do corretor.", input_schema: { type: "object", required: ["assunto", "texto", "motivo"], properties: {
  assunto: { type: "string", description: "Assunto curto (até 70 caracteres), sem emojis." },
  texto: { type: "string", description: "Corpo em texto simples. Parágrafos separados por linha em branco; listas com '• '. Comece com 'Olá, <primeiro nome>!'. Sem assinatura (é adicionada automaticamente)." },
  motivo: { type: "string", description: "Uma frase para o corretor: por que este e-mail agora." } } } };

async function escrever(db: Db, b: Base, l: Row, objetivo: string) {
  const chave = env("ANTHROPIC_API_KEY"); if (!chave) throw new Error("ia_nao_configurada");
  const c = b.membros.find((m) => m.id === l.corretor_id);
  const e = empDoLead(b, l);
  const { data: ev } = await db.from("lead_eventos").select("tipo, texto, para_etapa, criado_em").eq("lead_id", l.id).order("criado_em", { ascending: false }).limit(15);
  const historico = ((ev || []) as Row[]).reverse().map((x) => `${String(x.criado_em).slice(0, 10)} · ${x.tipo}${x.para_etapa ? " → " + x.para_etapa : ""}${x.texto ? ": " + String(x.texto).slice(0, 240) : ""}`).join("\n");
  const dados = Object.fromEntries(Object.entries(l).filter(([k, v]) => v != null && v !== "" && ["nome", "perfil", "empreendimento", "objetivo", "mensagem", "pais", "idioma", "orcamento", "etapa", "temperatura", "proximo_passo", "proximo_contato", "criado_em"].includes(k)));
  const trechos = await buscar(db, [l.empreendimento, l.objetivo, l.perfil, l.mensagem].filter(Boolean).join(" ") || "DANOVA-AI empreendimentos Miami", 5);
  const idioma = /^en/i.test(l.idioma || "") ? "inglês" : /^es/i.test(l.idioma || "") ? "espanhol" : "português do Brasil";
  const system = `Você escreve e-mails comerciais da DANOVA-AI (inteligência imobiliária: conecta investidores do Brasil e da América Latina a imóveis em Miami e na Flórida) em nome do corretor ${c?.nome || "da equipe"}.
Regras obrigatórias:
- Escreva em ${idioma}, tom cordial, consultivo e de alto padrão. Entre 60 e 150 palavras. Uma única chamada para ação clara (responder o e-mail, conversar por WhatsApp ou agendar uma chamada).
- Use SOMENTE os dados do lead, do empreendimento e da base abaixo. Não invente fatos, conversas, preços, prazos, disponibilidade ou rentabilidade. Se não souber algo, não mencione.
- Não prometa valorização, retorno, desconto, aprovação de visto ou financiamento. Valores sempre "a partir de".
- Não use links além de https://danova-ai.com e do link do empreendimento informado. Sem emojis. Sem assinatura (é adicionada automaticamente).
- Se o histórico indicar que o cliente pediu para não ser contatado ou já comprou, escreva apenas uma mensagem curta e neutra e explique isso no motivo.
Hoje é ${hojeBRT()}.
${trechos.length ? formatar(trechos) : ""}`;
  const conteudo = `OBJETIVO DESTE E-MAIL: ${objetivo}

DADOS DO LEAD:
${JSON.stringify(dados, null, 2)}

EMPREENDIMENTO DE INTERESSE:
${e ? JSON.stringify({ nome: e.nome, local: [e.endereco, e.cidade].filter(Boolean).join(", "), a_partir_de: moeda(e.preco_a_partir), condicoes: e.condicoes, entrega: e.entrega, link: e.link }) : "(não informado)"}

HISTÓRICO NO CRM (mais recente por último):
${historico || "(vazio)"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env("AGENTE_MODELO") || "claude-sonnet-5-5", max_tokens: 900, system, tools: [FERRAMENTA], tool_choice: { type: "tool", name: "escrever_email" }, messages: [{ role: "user", content: conteudo }] }),
  });
  if (!r.ok) { console.error(await r.text()); throw new Error("falha_ia"); }
  const out = await r.json();
  const uso = (out.content || []).find((x: Row) => x.type === "tool_use");
  if (!uso?.input?.texto) throw new Error("falha_ia");
  return { assunto: String(uso.input.assunto || "").replace(/[\r\n]+/g, " ").slice(0, 200), texto: String(uso.input.texto).slice(0, 6000), motivo: String(uso.input.motivo || "").slice(0, 400) };
}

const OBJETIVOS = {
  followup: (l: Row, dias: number) => `Follow-up: o lead está há mais de ${dias} dias sem novidades na etapa "${l.etapa}". Retome o contato de forma leve, lembre do interesse dele e proponha um próximo passo simples.`,
  boasvindas: (p: number, total: number) => [
    "Boas-vindas (1º de " + total + "): agradeça o contato, apresente a DANOVA-AI em poucas linhas e pergunte o objetivo do cliente (morar, investir, renda) para indicar as melhores opções.",
    "Boas-vindas (2º de " + total + "): traga informação útil sobre o empreendimento ou a região de interesse (só com dados fornecidos) e ofereça enviar plantas e tabela.",
    "Boas-vindas (3º de " + total + "): convide para uma conversa rápida por WhatsApp ou Zoom para entender o perfil e apresentar as oportunidades.",
  ][Math.min(p, 2)],
  data: (l: Row) => `Contato na data combinada (${l.proximo_contato}). Próximo passo registrado pelo corretor: "${l.proximo_passo || "não informado"}". Escreva o e-mail que cumpre esse próximo passo.`,
};

// ---------- planejar (regras) ----------
async function criarRascunho(db: Db, l: Row, origem: string, chave: string, a: { assunto: string; texto: string; motivo: string }, quando: string, extra: Row = {}) {
  const { error } = await db.from("email_sends").insert({
    lead_id: l.id, modelo: NOMES[origem] || origem, destinatario_nome: l.nome, destinatario_email: String(l.email).toLowerCase(),
    assunto: a.assunto, corpo_texto: a.texto, motivo_ia: a.motivo, status: "rascunho", origem, agendado_para: quando,
    enviado_por: l.corretor_id || null, enviado_por_nome: "Agente de IA", provedor: "hostinger", chave_idempotencia: chave, ...extra,
  });
  if (error && !/duplicate/.test(error.message)) console.error("rascunho", error.message);
  return !error;
}

async function planejar(db: Db, forcado: boolean) {
  const { data: regras } = await db.from("email_automacoes").select("*");
  const ativas = ((regras || []) as Row[]).filter((r) => r.ativo);
  if (!ativas.length) return { criados: 0, motivo: "nenhuma_regra_ativa" };
  if (!env("ANTHROPIC_API_KEY")) return { criados: 0, motivo: "ia_nao_configurada" };
  const b = await base(db);
  const { data: abertos } = await db.from("email_sends").select("lead_id").in("status", ["rascunho", "agendado", "pendente", "enviando"]);
  const ocupado = new Set(((abertos || []) as Row[]).map((x) => x.lead_id));
  let limite = forcado ? 8 : 12, criados = 0; const erros: string[] = [];
  const tentar = async (l: Row, origem: string, chave: string, objetivo: string, quando: string, extra: Row = {}) => {
    if (limite <= 0 || ocupado.has(l.id) || !elegivel(b, l)) return;
    try { const a = await escrever(db, b, l, objetivo); if (await criarRascunho(db, l, origem, chave, a, quando, extra)) { criados++; limite--; ocupado.add(l.id); } }
    catch (e) { erros.push(String((e as Error).message)); if (String((e as Error).message) === "ia_nao_configurada") limite = 0; }
  };
  for (const r of ativas) {
    const cfg = r.config || {}; const hora = Number(cfg.hora ?? 10);
    if (r.tipo === "data") {
      const hoje = hojeBRT(), amanha = new Date(Date.parse(hoje) + 864e5).toISOString().slice(0, 10);
      const { data: ls } = await db.from("leads").select("*").gte("proximo_contato", hoje).lte("proximo_contato", amanha).limit(40);
      for (const l of (ls || []) as Row[]) await tentar(l, "ia_data", `ia_data:${l.id}:${l.proximo_contato}`, OBJETIVOS.data(l), proximoHorario(hora, l.proximo_contato));
    }
    if (r.tipo === "boasvindas") {
      const passos = (Array.isArray(cfg.passos) ? cfg.passos : [1, 4, 9]).map(Number).filter((n: number) => n >= 0).slice(0, 3);
      const janela = new Date(Date.now() - (Math.max(...passos) + 3) * 864e5).toISOString();
      const { data: ls } = await db.from("leads").select("*").gte("criado_em", janela).neq("canal", "importacao").order("criado_em").limit(80);
      for (const l of (ls || []) as Row[]) {
        const { data: feitos } = await db.from("email_sends").select("passo").eq("lead_id", l.id).eq("origem", "ia_boasvindas");
        const ja = new Set(((feitos || []) as Row[]).map((x) => x.passo));
        const i = passos.findIndex((_p: number, k: number) => !ja.has(k + 1)); if (i < 0) continue;
        const dias = (Date.now() - Date.parse(l.criado_em)) / 864e5; if (dias < passos[i] - 1) continue; // prepara na véspera
        const dataEnvio = new Date(Date.parse(l.criado_em) - BRT + passos[i] * 864e5).toISOString().slice(0, 10);
        await tentar(l, "ia_boasvindas", `ia_boasvindas:${l.id}:${i + 1}`, OBJETIVOS.boasvindas(i, passos.length), proximoHorario(hora, dataEnvio), { passo: i + 1 });
      }
    }
    if (r.tipo === "followup") {
      const dias = Math.max(1, Number(cfg.dias ?? 5)); const corte = new Date(Date.now() - dias * 864e5).toISOString();
      const etapas = Array.isArray(cfg.etapas) && cfg.etapas.length ? cfg.etapas : ["novo", "contato", "qualificado", "visita", "proposta"];
      const { data: ls } = await db.from("leads").select("*").in("etapa", etapas).lt("atualizado_em", corte).order("atualizado_em", { ascending: false }).limit(60);
      for (const l of (ls || []) as Row[]) {
        if (limite <= 0) break;
        const { data: rec } = await db.from("email_sends").select("id").eq("lead_id", l.id).gte("criado_em", corte).neq("status", "falhou").limit(1);
        if (rec?.length) continue;
        await tentar(l, "ia_followup", `ia_followup:${l.id}:${hojeBRT()}`, OBJETIVOS.followup(l, dias), proximoHorario(hora));
      }
    }
    await db.from("email_automacoes").update({ ultima_execucao: new Date().toISOString() }).eq("tipo", r.tipo);
  }
  return { criados, erros: [...new Set(erros)].slice(0, 3) };
}

// campanhas no modo IA: preenche textos que ficaram para depois
async function preencherCampanhas(db: Db, max: number) {
  const { data: pend } = await db.from("email_sends").select("id, lead_id, campanha_id").eq("status", "rascunho").eq("origem", "campanha").is("corpo_texto", null).limit(max);
  if (!pend?.length || !env("ANTHROPIC_API_KEY")) return 0;
  const b = await base(db); let n = 0;
  for (const p of pend as Row[]) {
    const [{ data: l }, { data: c }] = await Promise.all([db.from("leads").select("*").eq("id", p.lead_id).maybeSingle(), db.from("email_campanhas").select("nome, instrucoes").eq("id", p.campanha_id).maybeSingle()]);
    if (!l || !c) continue;
    try {
      const a = await escrever(db, b, l, `Campanha "${c.nome}". Instruções do gestor: ${c.instrucoes || "apresentar as oportunidades da DANOVA-AI"}`);
      await db.from("email_sends").update({ assunto: a.assunto, corpo_texto: a.texto, motivo_ia: a.motivo, atualizado_em: new Date().toISOString() }).eq("id", p.id).eq("status", "rascunho");
      n++;
    } catch (_e) { break; }
  }
  return n;
}

// ---------- despachar ----------
async function despachar(db: Db) {
  // envios presos (servidor do site não respondeu) voltam para a fila
  await db.from("email_sends").update({ status: "agendado", ticket_hash: null, erro: "Nova tentativa automática" }).eq("status", "enviando").neq("origem", "manual").lt("ticket_expira", new Date(Date.now() - 10 * 60e3).toISOString()).lt("tentativas", 3);
  const { data: fila } = await db.from("email_sends").select("id").eq("status", "agendado").lte("agendado_para", new Date().toISOString()).order("agendado_para").limit(15);
  let enviados = 0, falhas = 0;
  if (fila?.length) {
    const b = await base(db);
    for (const f of fila as Row[]) {
      const ticket = crypto.randomUUID() + crypto.randomUUID();
      const { data: e } = await db.from("email_sends").update({ status: "enviando", ticket_hash: await sha(ticket), ticket_expira: new Date(Date.now() + 3 * 60e3).toISOString(), atualizado_em: new Date().toISOString() })
        .eq("id", f.id).eq("status", "agendado").select("*").maybeSingle();
      if (!e) continue;
      await db.from("email_sends").update({ tentativas: (e.tentativas || 0) + 1 }).eq("id", e.id);
      const { data: l } = await db.from("leads").select("*").eq("id", e.lead_id).maybeSingle();
      if (!l || !elegivel(b, l)) { await db.from("email_sends").update({ status: "cancelado", ticket_hash: null, erro: !l ? "Lead removido" : b.descad.has(String(l.email).toLowerCase()) ? "Contato descadastrado" : "Lead fechado/perdido ou sem e-mail válido" }).eq("id", e.id); continue; }
      const c = b.membros.find((m) => m.id === l.corretor_id) || b.membros.find((m) => m.id === e.aprovado_por) || {};
      const html = montarEmail({ corpoHtml: e.corpo_texto ? textoParaHtml(e.corpo_texto) : (e.corpo_html || ""), assinante: c, descadastro: PAGINA_SAIR + "?s=" + e.id + "&t=" + await hmac(e.id) });
      await db.from("email_sends").update({ corpo_html: html, destinatario_email: String(l.email).toLowerCase() }).eq("id", e.id);
      let ok = false, msg = "";
      try {
        const r = await fetch(SITE_FILA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envio_id: e.id, ticket }), signal: AbortSignal.timeout(30000) });
        const j = await r.json().catch(() => ({})); ok = r.ok && j.ok === true; msg = j.erro || ("HTTP " + r.status);
      } catch (x) { msg = String((x as Error).message || x); }
      if (ok) {
        enviados++;
        await db.from("email_sends").update({ status: "enviado", erro: null, ticket_hash: null, atualizado_em: new Date().toISOString() }).eq("id", e.id);
        await db.from("email_events").insert({ send_id: e.id, tipo: "enviado", dados: { via: "hostinger", origem: e.origem } });
        await db.from("lead_eventos").insert({ lead_id: l.id, autor_id: e.aprovado_por || null, tipo: "nota", texto: "E-mail enviado: “" + e.assunto + "” (" + (e.modelo || e.origem) + ")" });
      } else {
        falhas++;
        const fim = (e.tentativas || 0) + 1 >= 3;
        await db.from("email_sends").update({ status: fim ? "falhou" : "agendado", agendado_para: fim ? e.agendado_para : new Date(Date.now() + 15 * 60e3).toISOString(), ticket_hash: null, erro: ("Envio pela Hostinger: " + msg).slice(0, 300), atualizado_em: new Date().toISOString() }).eq("id", e.id);
        if (fim) await db.from("email_events").insert({ send_id: e.id, tipo: "falha", dados: { via: "hostinger", erro: msg } });
      }
    }
  }
  const preenchidos = await preencherCampanhas(db, 5);
  return { enviados, falhas, preenchidos };
}

// ---------- servidor ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  let corpo: Row = {}; try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const acao = String(corpo.acao || "");

  // tarefas programadas
  const tokenInterno = req.headers.get("x-token-interno");
  if (tokenInterno) {
    const { data: valido } = await db.rpc("validar_token_interno", { nome: "email-agente", token: tokenInterno });
    if (!valido) return json({ erro: "token" }, 401);
    if (acao === "planejar") return json(await planejar(db, false));
    if (acao === "despachar") return json(await despachar(db));
    return json({ erro: "acao_invalida" }, 400);
  }

  // servidor do site busca o e-mail com o ticket de uso único
  if (acao === "buscar") {
    const id = String(corpo.envio_id || ""), ticket = String(corpo.ticket || "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || ticket.length < 40) return json({ erro: "ticket" }, 400);
    const { data: e } = await db.from("email_sends").update({ ticket_hash: null }).eq("id", id).eq("status", "enviando").eq("ticket_hash", await sha(ticket)).gt("ticket_expira", new Date().toISOString())
      .select("id, lead_id, destinatario_email, destinatario_nome, assunto, corpo_html").maybeSingle();
    if (!e) return json({ erro: "ticket" }, 403);
    const { data: l } = await db.from("leads").select("corretor_id").eq("id", e.lead_id).maybeSingle();
    const { data: c } = l?.corretor_id ? await db.from("membros").select("email").eq("id", l.corretor_id).maybeSingle() : { data: null };
    return json({ ok: true, para: e.destinatario_email, nome: e.destinatario_nome, assunto: e.assunto, html: e.corpo_html,
      responder: c?.email && emailValido(c.email) ? c.email : "danova-ai@danova-ai.com",
      descadastro: env("SUPABASE_URL") + "/functions/v1/email-descadastro?s=" + e.id + "&t=" + await hmac(e.id) });
  }

  // ações do CRM (com login)
  const usuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: eu } = await db.from("membros").select("id, nome, papel, ativo").eq("id", u.user.id).maybeSingle();
  const me = eu as Row;
  if (!me?.ativo || !["admin", "corretor"].includes(me.papel)) return json({ erro: "sem_acesso" }, 403);
  const admin = me.papel === "admin";
  const agora = new Date().toISOString();
  const quandoValido = (q: unknown) => { const t = Date.parse(String(q || "")); return isFinite(t) && t > Date.now() - 60e3 && t < Date.now() + 120 * 864e5 ? new Date(t).toISOString() : null; };

  // envios que o usuário pode mexer
  async function meus(ids: unknown, status: string[]) {
    const lista = (Array.isArray(ids) ? ids : [ids]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
    if (!lista.length) return [] as Row[];
    const { data } = await db.from("email_sends").select("id, lead_id, status, agendado_para, leads!inner(corretor_id)").in("id", lista).in("status", status);
    return ((data || []) as Row[]).filter((e) => admin || e.leads?.corretor_id === me.id);
  }

  if (acao === "salvar") {
    const [e] = await meus(corpo.id, ["rascunho", "agendado"]); if (!e) return json({ erro: "nao_encontrado" }, 404);
    const assunto = String(corpo.assunto || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200), texto = String(corpo.texto || "").trim().slice(0, 8000);
    if (!assunto || !texto) return json({ erro: "conteudo_vazio" }, 400);
    const q = corpo.agendado_para ? quandoValido(corpo.agendado_para) : e.agendado_para;
    if (!q) return json({ erro: "data_invalida" }, 400);
    await db.from("email_sends").update({ assunto, corpo_texto: texto, agendado_para: q, atualizado_em: agora }).eq("id", e.id);
    return json({ ok: true });
  }
  if (acao === "aprovar") {
    const lista = await meus(corpo.ids, ["rascunho"]);
    let n = 0;
    for (const e of lista) {
      const q = corpo.agendado_para ? quandoValido(corpo.agendado_para) : (Date.parse(e.agendado_para || "") > Date.now() ? e.agendado_para : agora);
      const { data: x } = await db.from("email_sends").select("corpo_texto").eq("id", e.id).maybeSingle();
      if (!x?.corpo_texto) continue; // campanha com texto da IA ainda em preparo
      const { error } = await db.from("email_sends").update({ status: "agendado", agendado_para: q || agora, aprovado_por: me.id, aprovado_em: agora, enviado_por: me.id, enviado_por_nome: me.nome, atualizado_em: agora }).eq("id", e.id).eq("status", "rascunho");
      if (!error) n++;
    }
    return json({ ok: true, aprovados: n });
  }
  if (acao === "descartar" || acao === "cancelar") {
    const lista = await meus(corpo.ids, acao === "descartar" ? ["rascunho"] : ["agendado"]);
    if (lista.length) await db.from("email_sends").update({ status: "cancelado", erro: acao === "descartar" ? "Rascunho descartado por " + me.nome : "Cancelado por " + me.nome, atualizado_em: agora }).in("id", lista.map((e) => e.id));
    return json({ ok: true, total: lista.length });
  }
  if (acao === "agendar") {
    const { data: l } = await db.from("leads").select("*").eq("id", String(corpo.lead_id || "")).maybeSingle();
    if (!l) return json({ erro: "lead_nao_encontrado" }, 404);
    if (!admin && l.corretor_id !== me.id) return json({ erro: "sem_acesso" }, 403);
    const b = await base(db); if (!elegivel(b, l)) return json({ erro: b.descad.has(String(l.email || "").toLowerCase()) ? "descadastrado" : "email_invalido" }, 400);
    const q = quandoValido(corpo.agendado_para); if (!q || Date.parse(q) < Date.now() + 2 * 60e3) return json({ erro: "data_invalida" }, 400);
    const assunto = String(corpo.assunto || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200), texto = String(corpo.texto || "").trim().slice(0, 8000);
    if (!assunto || !texto) return json({ erro: "conteudo_vazio" }, 400);
    let modelo = "Agendado"; if (corpo.template_id) { const { data: t } = await db.from("email_templates").select("nome").eq("id", String(corpo.template_id)).maybeSingle(); if (t) modelo = t.nome; }
    const { error } = await db.from("email_sends").insert({ lead_id: l.id, template_id: corpo.template_id || null, modelo, destinatario_nome: l.nome, destinatario_email: String(l.email).toLowerCase(), assunto, corpo_texto: texto,
      status: "agendado", origem: "agendado", agendado_para: q, aprovado_por: me.id, aprovado_em: agora, enviado_por: me.id, enviado_por_nome: me.nome, provedor: "hostinger", chave_idempotencia: String(corpo.chave || crypto.randomUUID()).slice(0, 80) });
    if (error) return json({ erro: /duplicate/.test(error.message) ? "duplicado" : "banco" }, 409);
    return json({ ok: true, agendado_para: q });
  }
  if (acao === "planejar_agora") {
    if (!admin) return json({ erro: "sem_acesso" }, 403);
    return json(await planejar(db, true));
  }
  if (acao === "campanha") {
    if (!admin) return json({ erro: "sem_acesso" }, 403);
    const nome = String(corpo.nome || "").trim().slice(0, 120); const modo = corpo.modo === "ia" ? "ia" : "modelo";
    const q = quandoValido(corpo.agendado_para); if (!nome || !q) return json({ erro: "dados_invalidos" }, 400);
    const f = corpo.filtro || {};
    let qy = db.from("leads").select("*").not("email", "is", null);
    if (Array.isArray(f.etapas) && f.etapas.length) qy = qy.in("etapa", f.etapas.map(String));
    if (f.empreendimento) qy = qy.eq("empreendimento", String(f.empreendimento));
    if (f.temperatura) qy = qy.eq("temperatura", String(f.temperatura));
    if (f.perfil) qy = qy.eq("perfil", String(f.perfil));
    if (f.canal) qy = qy.eq("canal", String(f.canal));
    if (f.corretor_id) qy = qy.eq("corretor_id", String(f.corretor_id));
    const { data: ls } = await qy.limit(modo === "ia" ? 60 : 300);
    const b = await base(db);
    const alvo = ((ls || []) as Row[]).filter((l) => elegivel(b, l));
    if (corpo.simular) return json({ ok: true, total: alvo.length, exemplos: alvo.slice(0, 5).map((l) => l.nome) });
    if (!alvo.length) return json({ erro: "sem_leads" }, 400);
    let assunto = String(corpo.assunto || ""), texto = String(corpo.texto || "");
    if (modo === "modelo" && corpo.template_id && (!assunto || !texto)) {
      const { data: t } = await db.from("email_templates").select("assunto, corpo_html").eq("id", String(corpo.template_id)).maybeSingle();
      if (t) { assunto = assunto || t.assunto; texto = texto || htmlParaTexto(t.corpo_html); }
    }
    if (modo === "modelo" && (!assunto.trim() || !texto.trim())) return json({ erro: "conteudo_vazio" }, 400);
    const { data: camp, error: eC } = await db.from("email_campanhas").insert({ nome, filtro: f, modo, template_id: corpo.template_id || null, assunto, corpo_texto: texto, instrucoes: String(corpo.instrucoes || "").slice(0, 2000), agendado_para: q, total: alvo.length, criado_por: me.id }).select("id").single();
    if (eC) return json({ erro: "banco" }, 500);
    const linhas = alvo.map((l) => { const v = varsDoLead(b, l); return {
      lead_id: l.id, campanha_id: camp.id, modelo: "Campanha · " + nome, destinatario_nome: l.nome, destinatario_email: String(l.email).toLowerCase(),
      assunto: modo === "modelo" ? trocar(assunto, v).slice(0, 200) : "(a IA está escrevendo…)", corpo_texto: modo === "modelo" ? trocar(texto, v) : null,
      status: "rascunho", origem: "campanha", agendado_para: q, enviado_por: me.id, enviado_por_nome: me.nome, provedor: "hostinger", chave_idempotencia: "campanha:" + camp.id + ":" + l.id }; });
    for (let i = 0; i < linhas.length; i += 100) await db.from("email_sends").insert(linhas.slice(i, i + 100));
    if (modo === "ia") await preencherCampanhas(db, 4);
    return json({ ok: true, campanha_id: camp.id, total: linhas.length });
  }
  return json({ erro: "acao_invalida" }, 400);
});
