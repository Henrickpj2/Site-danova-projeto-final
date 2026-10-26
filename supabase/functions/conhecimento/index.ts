// danova AI — base de conhecimento (RAG). Só administradores.
// Ações: indexar {doc_id} → divide o texto, gera embeddings e grava os trechos; buscar {consulta} → teste de busca.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buscar, dividir, embedding } from "./rag.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // chamada interna do banco (pg_net) para indexar: token secreto conferido pelo hash guardado em privado.tokens_internos
  const interno = req.headers.get("x-token-interno");
  if (interno) {
    const { data: ok } = await admin.rpc("validar_token_interno", { nome: "conhecimento", token: interno });
    if (!ok) return json({ erro: "sem_acesso" }, 403);
  } else {
    const { data: u } = await usuario.auth.getUser();
    if (!u?.user) return json({ erro: "nao_autenticado" }, 401);
    const { data: me } = await usuario.from("membros").select("ativo, papel").eq("id", u.user.id).maybeSingle();
    if (!me?.ativo || me.papel !== "admin") return json({ erro: "sem_acesso" }, 403);
  }

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }

  if (corpo.acao === "buscar") {
    const trechos = await buscar(admin, String(corpo.consulta ?? "").slice(0, 500), 6);
    return json({ trechos });
  }

  if (corpo.acao === "indexar") {
    const id = String(corpo.doc_id ?? "");
    const { data: doc } = await admin.from("conhecimento_docs").select("id, titulo, texto").eq("id", id).maybeSingle();
    if (!doc) return json({ erro: "doc_nao_encontrado" }, 404);
    await admin.from("conhecimento_docs").update({ status: "indexando", erro: null }).eq("id", id);
    try {
      const partes = dividir(doc.titulo, doc.texto);
      if (partes.length > 400) throw new Error("documento grande demais (máx. ~360 mil caracteres)");
      const linhas = [];
      for (let i = 0; i < partes.length; i++) linhas.push({ doc_id: id, ordem: i, texto: partes[i], embedding: JSON.stringify(await embedding(partes[i])) });
      await admin.from("conhecimento_trechos").delete().eq("doc_id", id);
      for (let i = 0; i < linhas.length; i += 50) {
        const { error } = await admin.from("conhecimento_trechos").insert(linhas.slice(i, i + 50));
        if (error) throw new Error(error.message);
      }
      await admin.from("conhecimento_docs").update({ status: "pronto", total_trechos: linhas.length, atualizado_em: new Date().toISOString() }).eq("id", id);
      return json({ ok: true, trechos: linhas.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from("conhecimento_docs").update({ status: "erro", erro: msg.slice(0, 300) }).eq("id", id);
      return json({ erro: "falha_indexar", detalhe: msg }, 500);
    }
  }
  return json({ erro: "acao" }, 400);
});
