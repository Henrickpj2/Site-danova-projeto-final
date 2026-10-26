// danova AI — agente do CRM: analisa um lead e sugere o próximo passo.
// Só membros logados (JWT). O acesso ao lead respeita as regras do banco: o corretor só analisa os próprios leads.
// Segredos: ANTHROPIC_API_KEY (obrigatório), AGENTE_MODELO (opcional, padrão claude-sonnet-5-5).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { CONHECIMENTO } from "./conhecimento.ts";
import { buscar, formatar } from "./rag.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const FERRAMENTA = {
  name: "registrar_analise",
  description: "Registra a análise do lead para o corretor.",
  input_schema: {
    type: "object",
    properties: {
      resumo: { type: "string", description: "3 a 5 frases: quem é, o que quer, onde está a negociação. Só fatos presentes nos dados." },
      temperatura: { type: "string", enum: ["frio", "morno", "quente"] },
      proximo_passo: { type: "string", description: "Uma ação concreta e curta para o corretor (ex.: enviar plantas do Faena 2 quartos e propor Zoom)" },
      proximo_contato: { type: "string", description: "Data AAAA-MM-DD sugerida para o próximo contato, a partir de hoje" },
      mensagem_sugerida: { type: "string", description: "Mensagem de WhatsApp pronta, no idioma do cliente, curta e cordial, assinada pelo corretor" },
      pontos_atencao: { type: "string", description: "Riscos, dados faltando ou dúvidas a confirmar (ex.: orçamento não informado, país com restrição SB 264). Vazio se nada." },
    },
    required: ["resumo", "temperatura", "proximo_passo", "proximo_contato", "mensagem_sugerida"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await usuario.from("membros").select("id, nome, ativo").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo) return json({ erro: "acesso_pendente" }, 403);

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const leadId = String(corpo.lead_id ?? "");

  // lido com o token do usuário: se ele não pode ver o lead, não há lead
  const { data: lead } = await usuario.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (!lead) return json({ erro: "lead_nao_encontrado" }, 404);

  // limite: 20 análises por membro por hora
  const umaHora = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin.from("agente_analises").select("id", { count: "exact", head: true }).eq("pedido_por", me.id).gte("criado_em", umaHora);
  if ((count ?? 0) >= 20) return json({ erro: "limite_hora" }, 429);

  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return json({ erro: "ia_nao_configurada" }, 503);

  const { data: eventos } = await usuario.from("lead_eventos").select("tipo, texto, de_etapa, para_etapa, criado_em").eq("lead_id", leadId).order("criado_em", { ascending: true }).limit(60);
  const { data: conversas } = await usuario.from("conversas").select("id").eq("lead_id", leadId).order("criado_em", { ascending: false }).limit(1);
  let transcricao = "";
  if (conversas?.length) {
    const { data: msgs } = await usuario.from("mensagens").select("papel, texto").eq("conversa_id", conversas[0].id).order("id", { ascending: true }).limit(60);
    transcricao = (msgs ?? []).map((m) => (m.papel === "cliente" ? "Cliente: " : "Atendente: ") + m.texto).join("\n");
  }
  const dadosLead = Object.fromEntries(Object.entries(lead).filter(([k, v]) => v != null && v !== "" && !["id", "corretor_id", "utm"].includes(k)));
  const historico = (eventos ?? []).map((e) => `${e.criado_em.slice(0, 10)} · ${e.tipo}${e.para_etapa ? " → " + e.para_etapa : ""}${e.texto ? ": " + e.texto : ""}`).join("\n");

  const pergunta = [lead.empreendimento, lead.objetivo, lead.orcamento, lead.perfil, lead.mensagem, transcricao.slice(-600)].filter(Boolean).join(" \n");
  const trechos = await buscar(admin, pergunta, 6);
  const base = trechos.length ? formatar(trechos) : CONHECIMENTO;
  const system = `Você é o assistente de vendas interno da danova AI e ajuda o corretor ${me.nome} a conduzir um lead.
Regras: use apenas os dados fornecidos e a base de conhecimento; não invente fatos sobre o cliente. Se algo não foi dito, trate como desconhecido e liste em pontos_atencao. Não prometa preço final, desconto, retorno ou aprovação de visto. Hoje é ${new Date().toISOString().slice(0, 10)}. Leads quentes: próximo contato em até 1 dia; mornos: 2 a 4 dias; frios: 7 a 14 dias.
${base}`;
  const conteudo = `DADOS DO LEAD:\n${JSON.stringify(dadosLead, null, 2)}\n\nHISTÓRICO NO CRM:\n${historico || "(vazio)"}\n\nCONVERSA NO CHAT DO SITE:\n${transcricao || "(não houve)"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("AGENTE_MODELO") || "claude-sonnet-5-5", max_tokens: 900, system,
      tools: [FERRAMENTA], tool_choice: { type: "tool", name: "registrar_analise" },
      messages: [{ role: "user", content: conteudo }],
    }),
  });
  if (!r.ok) { console.error(await r.text()); return json({ erro: "falha_ia" }, 502); }
  const out = await r.json();
  const uso = (out.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!uso) return json({ erro: "sem_analise" }, 502);
  const a = uso.input as Record<string, string>;
  const data = /^\d{4}-\d{2}-\d{2}$/.test(a.proximo_contato ?? "") ? a.proximo_contato : null;

  const { data: salva, error } = await admin.from("agente_analises").insert({
    lead_id: leadId, origem: "crm", pedido_por: me.id,
    resumo: a.resumo?.slice(0, 2000), proximo_passo: a.proximo_passo?.slice(0, 500), proximo_contato: data,
    temperatura: ["frio", "morno", "quente"].includes(a.temperatura) ? a.temperatura : null,
    mensagem_sugerida: a.mensagem_sugerida?.slice(0, 2000), pontos_atencao: a.pontos_atencao?.slice(0, 1000) || null,
  }).select().single();
  if (error) return json({ erro: "falha_salvar" }, 500);
  return json({ analise: salva });
});
