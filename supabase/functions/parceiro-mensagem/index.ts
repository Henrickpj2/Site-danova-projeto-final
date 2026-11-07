// danova AI — escreve uma mensagem de WhatsApp personalizada para um corretor parceiro.
// Só administradores (JWT + RLS da tabela parceiros). Não envia nada: devolve o texto para o admin
// conferir e enviar pelo próprio WhatsApp. Segredos: ANTHROPIC_API_KEY, AGENTE_MODELO (opcional).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SOBRE = `danova AI (danova-ai.com): consultoria imobiliária de alto padrão no Sul da Flórida (Miami, Brickell, Palm Beach, Orlando),
liderada por Danielle Lisboa Martins — advogada (NY State Bar e OAB) e corretora licenciada na Flórida.
Há 10 anos faz tráfego pago (Meta Ads e Google Ads) para empreendimentos de alto padrão e oferece plataforma com CRM,
atendimento por IA e follow-up. Trabalha com corretores do Brasil em vendas internacionais (clientes brasileiros que querem
comprar imóvel nos EUA), apoiando o corretor até a primeira venda internacional.`;

const FERRAMENTA = {
  name: "mensagem_whatsapp",
  description: "Devolve a mensagem de WhatsApp pronta para o corretor parceiro.",
  input_schema: {
    type: "object",
    properties: { mensagem: { type: "string", description: "Mensagem curta (até 600 caracteres), em português do Brasil, cordial, sem emojis em excesso." } },
    required: ["mensagem"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });

  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
  const { data: me } = await usuario.from("membros").select("id, nome, papel, ativo").eq("id", u.user.id).maybeSingle();
  if (!me?.ativo || me.papel !== "admin") return json({ erro: "sem_acesso" }, 403);

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const id = String(corpo.parceiro_id ?? "");
  const objetivo = String(corpo.objetivo ?? "").slice(0, 400) || "Apresentar a danova AI e convidar para uma parceria em vendas internacionais.";
  const assinatura = String(corpo.assinatura ?? "").slice(0, 80) || me.nome;

  const { data: p } = await usuario.from("parceiros").select("nome, creci, cidade, imobiliaria, status, observacoes").eq("id", id).maybeSingle();
  if (!p) return json({ erro: "parceiro_nao_encontrado" }, 404);

  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return json({ erro: "ia_nao_configurada" }, 503);

  const system = `Você escreve mensagens de WhatsApp para a danova AI falar com corretores de imóveis do Brasil.
${SOBRE}
Regras: português do Brasil, tom profissional e próximo, no máximo 600 caracteres, uma pergunta clara no final para abrir conversa.
Use o primeiro nome do corretor quando ele parecer um nome de pessoa; se for nome de empresa, e-mail ou genérico, cumprimente sem nome.
Não invente números, comissões, valores, prazos, resultados ou depoimentos. Não diga que ele pediu contato.
Assine como "${assinatura} · danova AI".`;
  const conteudo = `OBJETIVO DA MENSAGEM: ${objetivo}\n\nCORRETOR:\n${JSON.stringify(Object.fromEntries(Object.entries(p).filter(([, v]) => v)), null, 2)}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("AGENTE_MODELO") || "claude-sonnet-5-5", max_tokens: 500, system,
      tools: [FERRAMENTA], tool_choice: { type: "tool", name: "mensagem_whatsapp" },
      messages: [{ role: "user", content: conteudo }],
    }),
  });
  if (!r.ok) { console.error(await r.text()); return json({ erro: "falha_ia" }, 502); }
  const out = await r.json();
  const uso = (out.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  const mensagem = String((uso?.input as Record<string, string> | undefined)?.mensagem ?? "").trim().slice(0, 1200);
  if (!mensagem) return json({ erro: "sem_mensagem" }, 502);
  return json({ mensagem });
});
