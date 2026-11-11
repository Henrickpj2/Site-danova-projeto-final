// DANOVA Marketing Intelligence — meta-sync-all: repassa para o núcleo meta-mi (ação "sync_all").
// Toda a validação (login, papel, cliente, conta) acontece no meta-mi.
const ACAO = "sync_all";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token-interno" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const destino = new URL((Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/meta-mi");
  const h = new Headers({ "Content-Type": "application/json", "x-mi-acao": ACAO });
  for (const k of ["authorization", "apikey", "x-token-interno"]) { const v = req.headers.get(k); if (v) h.set(k, v); }
  if (req.method === "GET") {
    destino.search = new URL(req.url).search;
    const r = await fetch(destino, { headers: h, redirect: "manual" });
    return new Response(r.body, { status: r.status, headers: { Location: r.headers.get("Location") || "", "Content-Type": r.headers.get("Content-Type") || "text/plain" } });
  }
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const r = await fetch(destino, { method: "POST", headers: h, body: JSON.stringify({ ...corpo, acao: ACAO }) });
  return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
});
