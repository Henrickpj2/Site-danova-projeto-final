// danova AI — atendimento por voz do site: fala → texto (Whisper) e texto → fala (ElevenLabs).
// O meio do caminho (a IA que responde) continua sendo a função "atendente" (Claude).
// Segredos opcionais (Supabase → Edge Functions → Secrets):
//   OPENAI_API_KEY      → transcrição com Whisper (sem ela o navegador transcreve sozinho, quando suporta)
//   ELEVENLABS_API_KEY  → voz natural (sem ela o navegador lê com a voz do sistema)
//   ELEVENLABS_VOZ_ID   → ID da voz (padrão: voz multilíngue da biblioteca) · ELEVENLABS_MODELO (padrão eleven_flash_v2_5)
//   VOZ_STT_MODELO      → padrão whisper-1
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const LIMITE_IP_HORA = 40, LIMITE_GLOBAL_HORA = 600, MAX_TEXTO = 700, MAX_AUDIO_B64 = 3_000_000;
const IDIOMAS: Record<string, string> = { pt: "pt", en: "en", es: "es" };

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function limparFala(t: string) {
  return t.replace(/https?:\/\/\S+/g, "").replace(/[*_#>`]/g, "").replace(/US\$/g, "US$ ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { return json({ erro: "json" }, 400); }
  const acao = String(corpo.acao || "");
  if (acao === "status") return json({ stt: !!env("OPENAI_API_KEY"), tts: !!env("ELEVENLABS_API_KEY") });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0";
  const ipHash = await sha256(ip + "|voz-danova");
  const umaHora = new Date(Date.now() - 3600e3).toISOString();
  const [{ count: porIp }, { count: global }] = await Promise.all([
    db.from("voz_uso").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("criado_em", umaHora),
    db.from("voz_uso").select("id", { count: "exact", head: true }).gte("criado_em", umaHora),
  ]);
  if ((porIp ?? 0) >= LIMITE_IP_HORA || (global ?? 0) >= LIMITE_GLOBAL_HORA) return json({ erro: "limite" }, 429);
  const idioma = IDIOMAS[String(corpo.idioma || "pt")] || "pt";

  if (acao === "transcrever") {
    if (!env("OPENAI_API_KEY")) return json({ erro: "stt_nao_configurado" }, 503);
    const b64 = String(corpo.audio || "");
    if (!b64 || b64.length > MAX_AUDIO_B64) return json({ erro: "audio_invalido" }, 400);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const mime = /^audio\/[\w.+-]+/.exec(String(corpo.mime || ""))?.[0] || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : "webm";
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mime }), "fala." + ext);
    fd.append("model", env("VOZ_STT_MODELO") || "whisper-1");
    fd.append("language", idioma);
    fd.append("prompt", "Imóveis em Miami, Brickell, Palm Beach, Faena, Continuum, Mandarin Oriental, Nobu, EB-5, danova AI.");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + env("OPENAI_API_KEY") }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("stt", r.status, JSON.stringify(j).slice(0, 300)); return json({ erro: "stt_falhou" }, 502); }
    await db.from("voz_uso").insert({ ip_hash: ipHash, tipo: "stt", caracteres: String(j.text || "").length });
    return json({ texto: String(j.text || "").trim() });
  }

  if (acao === "falar") {
    if (!env("ELEVENLABS_API_KEY")) return json({ erro: "tts_nao_configurado" }, 503);
    const texto = limparFala(String(corpo.texto || ""));
    if (!texto) return json({ erro: "texto_vazio" }, 400);
    const voz = env("ELEVENLABS_VOZ_ID") || "21m00Tcm4TlvDq8ikWAM";
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: texto, model_id: env("ELEVENLABS_MODELO") || "eleven_flash_v2_5", language_code: idioma, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!r.ok) { console.error("tts", r.status, (await r.text()).slice(0, 300)); return json({ erro: "tts_falhou" }, 502); }
    await db.from("voz_uso").insert({ ip_hash: ipHash, tipo: "tts", caracteres: texto.length });
    return new Response(r.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  }
  return json({ erro: "acao_desconhecida" }, 400);
});
