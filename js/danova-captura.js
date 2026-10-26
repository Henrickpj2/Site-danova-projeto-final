/*!
 * danova AI — captura de leads para landing pages e formulários externos.
 * Cole antes de </body> na página:
 *   <script src="https://danova-ai.com/js/danova-captura.js" data-fonte="SEU-CODIGO" defer></script>
 * O que faz: guarda a origem do visitante (UTM, gclid, fbclid, página de entrada) e, quando qualquer formulário
 * da página é enviado com e-mail ou telefone, manda uma cópia do lead para o CRM da danova marcada com a fonte.
 * Não bloqueia o formulário original: ele continua indo para onde já ia.
 */
(function () {
  "use strict";
  if (window.__danovaCaptura) return;
  window.__danovaCaptura = true;

  var URL_CRM = "https://oeylfwasqvbnybzrwtgf.supabase.co/rest/v1/rpc/enviar_lead";
  var CHAVE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leWxmd2FzcXZibnlienJ3dGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDkxNDYsImV4cCI6MjEwODEyNTE0Nn0.xfl5HyVe4RGqs0VYNt-a7Rox1Ro9ORQlkdNirxG3FeY"; // chave pública (anon)
  var eu = document.currentScript || document.querySelector('script[src*="danova-captura"]');
  var FONTE = ((eu && eu.getAttribute("data-fonte")) || "landing-page").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60) || "landing-page";
  var EMPREENDIMENTO = (eu && eu.getAttribute("data-empreendimento")) || "";

  function ler(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- origem do visitante ----------
  var p = {}; try { var u = new URLSearchParams(location.search); ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "gbraid", "wbraid"].forEach(function (k) { var v = u.get(k); if (v) p[k] = v.slice(0, 150); }); } catch (e) {}
  var toque = null;
  if (p.utm_source || p.gclid || p.fbclid || p.gbraid || p.wbraid) {
    toque = { source: p.utm_source || (p.fbclid ? "facebook" : "google"), medium: p.utm_medium || (p.fbclid ? "paid_social" : "cpc"), campaign: p.utm_campaign || "", content: p.utm_content || "", term: p.utm_term || "", gclid: p.gclid || p.gbraid || p.wbraid || "", fbclid: p.fbclid || "" };
  } else if (document.referrer) {
    var host = ""; try { host = new URL(document.referrer).hostname.replace(/^www\./, ""); } catch (e) {}
    if (host && host !== location.hostname.replace(/^www\./, "")) {
      var m = /google\.|bing\.|yahoo\.|duckduckgo\./.test(host) ? "organic" : /facebook|instagram|linkedin|t\.co|youtube/.test(host) ? "social" : "referral";
      toque = { source: host.split(".")[0], medium: m, campaign: "", content: "", term: "", gclid: "", fbclid: "" };
    }
  }
  if (toque) {
    toque.landing_page = location.href.split("#")[0].slice(0, 300); toque.referrer = (document.referrer || "").slice(0, 300);
    if (!ler("dnc_primeiro")) gravar("dnc_primeiro", toque);
    gravar("dnc_ultimo", toque);
  }
  var prim = ler("dnc_primeiro") || {}, ult = ler("dnc_ultimo") || prim;

  // ---------- leitura dos campos (funciona com Elementor, WordPress, RD, HTML comum) ----------
  function campo(form, nomes, tipo) {
    var els = form.querySelectorAll("input, textarea, select");
    for (var i = 0; i < els.length; i++) {
      var el = els[i], id = ((el.name || "") + " " + (el.id || "") + " " + (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
      if (el.type === "hidden" || el.type === "password" || !el.value) continue;
      for (var j = 0; j < nomes.length; j++) if (id.indexOf(nomes[j]) >= 0) return String(el.value).trim();
    }
    if (tipo) { var t = form.querySelector('input[type="' + tipo + '"]'); if (t && t.value) return String(t.value).trim(); }
    return "";
  }
  var enviados = {};
  function enviar(form) {
    if (!form || form.closest && form.closest("[data-danova-ignorar]")) return;
    var email = campo(form, ["email", "e-mail"], "email");
    var tel = campo(form, ["whats", "telefone", "phone", "celular", "fone", "tel"], "tel");
    if (!email && !tel) return;
    var chave = (email || tel) + "|" + FONTE; if (enviados[chave] && Date.now() - enviados[chave] < 15000) return; enviados[chave] = Date.now();
    var dados = {
      name: campo(form, ["nome", "name"], "") || (form.querySelector('input[type="text"]') || {}).value || "",
      email: email, phone: tel,
      notes: campo(form, ["mensagem", "message", "coment", "duvida", "obs"], "") || "",
      project: EMPREENDIMENTO || campo(form, ["empreendimento", "imovel", "produto", "interesse"], ""),
      budget: campo(form, ["orcamento", "budget", "valor", "renda"], ""),
      country: campo(form, ["cidade", "pais", "country", "estado"], ""),
      website: campo(form, ["website"], ""), // armadilha anti-robô
      language: (document.documentElement.lang || navigator.language || "pt").slice(0, 2),
      lead_page: FONTE,
      first_touch_source: prim.source || "", first_touch_medium: prim.medium || "", first_touch_campaign: prim.campaign || "",
      last_touch_source: ult.source || "", last_touch_medium: ult.medium || "", last_touch_campaign: ult.campaign || "",
      gclid: ult.gclid || prim.gclid || "", fbclid: ult.fbclid || prim.fbclid || "",
      landing_page: prim.landing_page || location.href.split("#")[0].slice(0, 300), referrer: prim.referrer || ""
    };
    try {
      fetch(URL_CRM, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", apikey: CHAVE, Authorization: "Bearer " + CHAVE }, body: JSON.stringify({ dados: dados }) }).catch(function () {});
    } catch (e) {}
    try { (window.dataLayer = window.dataLayer || []).push({ event: "generate_lead", lead_source: FONTE }); } catch (e) {}
  }
  document.addEventListener("submit", function (e) { if (e.target && e.target.tagName === "FORM") enviar(e.target); }, true);
  window.danovaCaptura = { enviar: enviar, fonte: FONTE };
})();
