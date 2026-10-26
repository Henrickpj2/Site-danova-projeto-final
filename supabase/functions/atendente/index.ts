// danova AI — atendente virtual do site (público, sem login).
// Segredos (Supabase → Edge Functions → Secrets): ANTHROPIC_API_KEY (obrigatório para a IA responder),
// ATENDENTE_MODELO (opcional, padrão claude-sonnet-5-5).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { CONHECIMENTO, REGRAS, WHATSAPP } from "./conhecimento.ts";
import { buscar, formatar } from "./rag.ts";

const LIMITE_MSG_CONVERSA = 30;      // mensagens do cliente por conversa
const LIMITE_CONVERSAS_IP_HORA = 6;  // conversas novas por IP por hora
const LIMITE_GLOBAL_MINUTO = 60;     // mensagens de clientes por minuto, no site todo
const MAX_CARACTERES = 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function tokenAleatorio() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return Array.from(a).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function linkWhatsApp(texto: string) {
  return "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(texto.slice(0, 1200));
}
const TXT = {
  pt: { offline: "Nosso atendente virtual está indisponível no momento. Fale agora com a equipe da Danielle pelo WhatsApp — respondemos rapidinho.", limite: "Para continuar, vamos seguir pelo WhatsApp com a equipe da Danielle, que já recebe o histórico da nossa conversa.", ola: "Olá, Danielle! Vim pelo chat do site danova-ai.com." },
  en: { offline: "Our virtual assistant is unavailable right now. Please talk to Danielle's team on WhatsApp — we reply quickly.", limite: "To continue, let's move to WhatsApp with Danielle's team.", ola: "Hi Danielle! I came from the danova-ai.com chat." },
  es: { offline: "Nuestro asistente virtual no está disponible en este momento. Habla ahora con el equipo de Danielle por WhatsApp.", limite: "Para continuar, sigamos por WhatsApp con el equipo de Danielle.", ola: "¡Hola, Danielle! Vengo del chat de danova-ai.com." },
};
type Idioma = keyof typeof TXT;

const FERRAMENTAS = [
  {
    name: "registrar_lead",
    description: "Registra ou atualiza o cliente no CRM da danova. Use assim que tiver nome e (telefone ou e-mail), e de novo quando surgirem dados importantes.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        email: { type: "string" },
        telefone: { type: "string", description: "Com código do país, se informado" },
        pais: { type: "string" },
        perfil: { type: "string", enum: ["Investidor ou comprador", "Corretor de imóveis", "Imobiliária", "Construtora ou incorporadora", "Family office", "Outro"] },
        empreendimento: { type: "string", description: "Nome do empreendimento de interesse, se houver" },
        objetivo: { type: "string", description: "Ex.: moradia, investimento/renda, EB-5, venda" },
        orcamento: { type: "string" },
        prazo: { type: "string" },
        temperatura: { type: "string", enum: ["frio", "morno", "quente"] },
        resumo: { type: "string", description: "2 a 4 frases em português para o corretor: o que o cliente quer, dados-chave e próximo passo combinado" },
      },
      required: ["resumo", "temperatura"],
    },
  },
  {
    name: "transferir_para_humano",
    description: "Encaminha o cliente para a equipe da Danielle no WhatsApp com um resumo. Use quando o cliente pedir uma pessoa, tiver alta intenção ou o assunto exigir a Danielle.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string" },
        resumo_para_whatsapp: { type: "string", description: "Mensagem curta, em nome do cliente e no idioma dele, com o que ele quer e seus dados principais" },
      },
      required: ["motivo", "resumo_para_whatsapp"],
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const mensagem = String(corpo.mensagem ?? "").trim().slice(0, MAX_CARACTERES);
  const idiomaPedido = String(corpo.idioma ?? "pt").slice(0, 2).toLowerCase();
  const idioma: Idioma = (["pt", "en", "es"].includes(idiomaPedido) ? idiomaPedido : "pt") as Idioma;
  if (!mensagem) return json({ erro: "mensagem_vazia" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipHash = ip ? await sha256("danova:" + ip) : null;

  // limite global de custo
  const umMinuto = new Date(Date.now() - 60_000).toISOString();
  const { count: recentes } = await db.from("mensagens").select("id", { count: "exact", head: true }).eq("papel", "cliente").gte("criado_em", umMinuto);
  if ((recentes ?? 0) >= LIMITE_GLOBAL_MINUTO) {
    return json({ resposta: TXT[idioma].offline, acao: { tipo: "whatsapp", url: linkWhatsApp(TXT[idioma].ola) } });
  }

  // conversa: nova ou existente (validada pelo token)
  let conversa: Record<string, any> | null = null;
  let tokenNovo: string | null = null;
  if (corpo.conversa_id && corpo.token) {
    const { data } = await db.from("conversas").select("*").eq("id", String(corpo.conversa_id)).maybeSingle();
    if (data && data.token_hash === (await sha256(String(corpo.token)))) conversa = data;
  }
  if (!conversa) {
    if (ipHash) {
      const umaHora = new Date(Date.now() - 3_600_000).toISOString();
      const { count } = await db.from("conversas").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("criado_em", umaHora);
      if ((count ?? 0) >= LIMITE_CONVERSAS_IP_HORA) {
        return json({ resposta: TXT[idioma].limite, acao: { tipo: "whatsapp", url: linkWhatsApp(TXT[idioma].ola) } });
      }
    }
    tokenNovo = tokenAleatorio();
    const { data, error } = await db.from("conversas").insert({
      token_hash: await sha256(tokenNovo), ip_hash: ipHash, idioma, pagina: String(corpo.pagina ?? "").slice(0, 120),
    }).select().single();
    if (error) return json({ erro: "falha_conversa" }, 500);
    conversa = data;
  }
  const c = conversa!;

  if (c.total_mensagens >= LIMITE_MSG_CONVERSA) {
    return json({ conversa_id: c.id, token: tokenNovo, resposta: TXT[idioma].limite, acao: { tipo: "whatsapp", url: linkWhatsApp(TXT[idioma].ola + (c.resumo ? "\n\n" + c.resumo : "")) } });
  }

  await db.from("mensagens").insert({ conversa_id: c.id, papel: "cliente", texto: mensagem });
  await db.from("conversas").update({ total_mensagens: c.total_mensagens + 1, atualizado_em: new Date().toISOString() }).eq("id", c.id);

  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) {
    const r = TXT[idioma].offline;
    await db.from("mensagens").insert({ conversa_id: c.id, papel: "sistema", texto: r });
    return json({ conversa_id: c.id, token: tokenNovo, resposta: r, acao: { tipo: "whatsapp", url: linkWhatsApp(TXT[idioma].ola + "\n\n" + mensagem) }, configurado: false });
  }

  // histórico para o modelo (alternando usuário/assistente)
  const { data: hist } = await db.from("mensagens").select("papel, texto").eq("conversa_id", c.id).neq("papel", "sistema").order("id", { ascending: true }).limit(40);
  const msgs: { role: "user" | "assistant"; content: any }[] = [];
  for (const m of hist ?? []) {
    const role = m.papel === "cliente" ? "user" : "assistant";
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += "\n" + m.texto; else msgs.push({ role, content: m.texto });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  let leadAtual: Record<string, any> | null = null;
  if (c.lead_id) {
    const { data } = await db.from("leads").select("nome, email, telefone, empreendimento, objetivo, orcamento, temperatura").eq("id", c.lead_id).maybeSingle();
    leadAtual = data;
  }
  const contexto = `\n\n# Contexto desta conversa\n- Data de hoje: ${new Date().toISOString().slice(0, 10)}\n- Idioma do navegador: ${idioma}\n- Página: ${c.pagina || "home"}\n- Lead já registrado no CRM: ${leadAtual ? "sim — " + JSON.stringify(leadAtual) : "ainda não"}`;
  // RAG: busca na base de conhecimento os trechos ligados à pergunta (mais a pergunta anterior, para dar contexto)
  const anteriores = (hist ?? []).filter((m) => m.papel === "cliente").slice(-2).map((m) => m.texto).join(" \n");
  const trechos = await buscar(db, anteriores || mensagem, 6);
  // sem trechos (base vazia ou pergunta genérica): usa a base fixa como reserva
  const system = REGRAS + "\n" + (trechos.length ? formatar(trechos) : CONHECIMENTO) + contexto;
  const modelo = Deno.env.get("ATENDENTE_MODELO") || "claude-sonnet-5-5";

  let acao: Record<string, string> | null = null;
  let leadRegistrado = !!c.lead_id;
  let resposta = "";

  try {
    for (let rodada = 0; rodada < 4; rodada++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: modelo, max_tokens: 700, system, tools: FERRAMENTAS, messages: msgs }),
      });
      if (!r.ok) throw new Error("anthropic " + r.status + " " + (await r.text()).slice(0, 300));
      const out = await r.json();
      const textos = (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      const usos = (out.content ?? []).filter((b: any) => b.type === "tool_use");
      if (textos) resposta = textos;
      if (out.stop_reason !== "tool_use" || !usos.length) break;

      msgs.push({ role: "assistant", content: out.content });
      const resultados: any[] = [];
      for (const u of usos) {
        let conteudo = "ok";
        try {
          if (u.name === "registrar_lead") {
            conteudo = await registrarLead(db, c, u.input, idioma);
            leadRegistrado = true;
          } else if (u.name === "transferir_para_humano") {
            const texto = String(u.input.resumo_para_whatsapp || TXT[idioma].ola);
            acao = { tipo: "whatsapp", url: linkWhatsApp(texto) };
            await db.from("conversas").update({ status: "humano" }).eq("id", c.id);
            if (c.lead_id) await db.from("lead_eventos").insert({ lead_id: c.lead_id, tipo: "nota", texto: "Agente de IA: cliente encaminhado ao WhatsApp — " + String(u.input.motivo || "") });
            conteudo = "Botão de WhatsApp exibido ao cliente com o resumo. Diga a ele que pode tocar no botão para falar com a equipe.";
          }
        } catch (e) {
          conteudo = "erro: " + (e as Error).message;
        }
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: conteudo });
      }
      msgs.push({ role: "user", content: resultados });
    }
  } catch (e) {
    console.error(e);
    resposta = TXT[idioma].offline;
    acao = { tipo: "whatsapp", url: linkWhatsApp(TXT[idioma].ola + "\n\n" + mensagem) };
  }

  if (!resposta) resposta = idioma === "en" ? "Got it! How else can I help?" : idioma === "es" ? "¡Entendido! ¿En qué más puedo ayudarte?" : "Combinado! Posso ajudar em algo mais?";
  await db.from("mensagens").insert({ conversa_id: c.id, papel: "agente", texto: resposta });
  return json({ conversa_id: c.id, token: tokenNovo, resposta, acao, lead_registrado: leadRegistrado, configurado: true });
});

// deno-lint-ignore no-explicit-any
async function registrarLead(db: any, c: Record<string, any>, i: Record<string, any>, idioma: string) {
  const limpo = (v: unknown, n = 300) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const email = limpo(i.email, 200), tel = limpo(i.telefone, 60);
  let leadId: string | null = c.lead_id;

  if (!leadId) {
    if (!email && !tel) return "Ainda falta telefone ou e-mail para registrar. Peça ao cliente.";
    const { data, error } = await db.rpc("enviar_lead", {
      dados: {
        name: limpo(i.nome, 200) ?? "", email, phone: tel, profile: limpo(i.perfil, 120), project: limpo(i.empreendimento, 200),
        goal: limpo(i.objetivo, 200), budget: limpo(i.orcamento, 120), country: limpo(i.pais, 80), language: idioma,
        notes: limpo(i.resumo, 2000), lead_page: "chat-ia", source: "chat-ia", first_touch_source: "chat-ia",
      },
    });
    if (error || !data) throw new Error(error?.message || "lead_nao_criado");
    leadId = data as string;
    c.lead_id = leadId;
    await db.from("conversas").update({ lead_id: leadId }).eq("id", c.id);
  }

  const upd: Record<string, unknown> = {};
  for (const [k, v] of Object.entries({ nome: limpo(i.nome, 200), email, telefone: tel, pais: limpo(i.pais, 80), perfil: limpo(i.perfil, 120), empreendimento: limpo(i.empreendimento, 200), objetivo: limpo(i.objetivo, 200), orcamento: limpo(i.orcamento, 120), temperatura: ["frio", "morno", "quente"].includes(i.temperatura) ? i.temperatura : null })) {
    if (v) upd[k] = v;
  }
  if (Object.keys(upd).length) await db.from("leads").update(upd).eq("id", leadId);

  const resumo = limpo(i.resumo, 2000);
  await db.from("conversas").update({ resumo }).eq("id", c.id);
  await db.from("agente_analises").insert({
    lead_id: leadId, origem: "atendente", resumo, temperatura: upd.temperatura ?? null,
    dados: { prazo: limpo(i.prazo, 120), orcamento: upd.orcamento ?? null, objetivo: upd.objetivo ?? null },
  });
  await db.from("lead_eventos").insert({ lead_id: leadId, tipo: "nota", texto: "Agente de IA (chat do site): " + (resumo ?? "dados atualizados") });
  return "Lead registrado no CRM. Confirme ao cliente que a equipe da Danielle vai entrar em contato, sem prometer prazo exato.";
}
