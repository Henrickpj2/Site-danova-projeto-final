// danova AI — página pública "Autorizar acesso" (danova-ai.com/autorizar-meta.html).
// O cliente atribui a conta de anúncios como parceira ao Gerenciador da DANOVA no próprio Meta e depois confirma aqui:
//   { acao: "confirmar", act, empresa, email } → cadastra a conta (aguardando) e pede ao integrador para buscar os dados
//   { acao: "status", act }                    → aguardando | conectada | erro (sem dados sensíveis)
// Sem login. Limite simples contra abuso: até 40 contas novas por dia por esta página.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  let c: Record<string, unknown> = {}; try { c = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const act = String(c.act || "").replace(/\D/g, "");
  if (act.length < 6 || act.length > 20) return json({ erro: "id_invalido" }, 400);
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: existente } = await db.from("contas_anuncio").select("id, situacao, ultima_sync, ativo").eq("plataforma", "meta").eq("conta_externa", act).maybeSingle();

  if (c.acao === "status") return json({ situacao: existente?.ativo ? existente.situacao : "nao_encontrada", atualizada: existente?.ultima_sync || null });
  if (c.acao !== "confirmar") return json({ erro: "acao_invalida" }, 400);

  const empresa = String(c.empresa || "").replace(/[<>]/g, "").trim().slice(0, 80);
  const email = String(c.email || "").trim().slice(0, 120);
  if (!empresa) return json({ erro: "empresa" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({ erro: "email" }, 400);

  let id = existente?.id as string | undefined;
  if (!id) {
    const desde = new Date(Date.now() - 864e5).toISOString();
    const { count } = await db.from("contas_anuncio").select("id", { count: "exact", head: true }).eq("plataforma", "meta").gte("criado_em", desde).like("nome", "% · via link");
    if ((count || 0) >= 40) return json({ erro: "limite" }, 429);
    const { data: nova, error } = await db.from("contas_anuncio").insert({
      plataforma: "meta", conta_externa: act, nome: `${empresa} · via link`, nicho: "outro", fonte_dados: "integrador", situacao: "aguardando", ativo: true, status: "ativa",
    }).select("id").single();
    if (error) return json({ erro: "banco" }, 500);
    id = nova.id;
  } else if (!existente?.ativo) {
    await db.from("contas_anuncio").update({ ativo: true, situacao: "aguardando", fonte_dados: "integrador" }).eq("id", id);
  }
  // registra quem confirmou (aparece para a equipe nas notas da conta)
  await db.from("contas_anuncio").update({ ultimo_erro: existente?.situacao === "conectada" ? null : `Autorização confirmada pelo cliente${email ? " (" + email + ")" : ""} em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Buscando dados…` }).eq("id", id).neq("situacao", "conectada");
  const { error: eD } = await db.rpc("disparar_meta_integrador", { p_contas: [id], p_dias: 30 });
  if (eD) console.error("meta-autorizar", eD.message);
  return json({ ok: true });
});
