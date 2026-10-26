/* danova AI — consentimento de cookies (LGPD) + carregamento do Google Tag Manager, GA4 e Pixel do Meta.
 * - Antes da escolha: Consent Mode do Google com tudo negado; o Pixel do Meta não carrega.
 * - "Aceitar": libera análise e anúncios, carrega o Pixel. "Só essenciais": mantém negado.
 * - Sem GTM, os eventos do site (generate_lead, whatsapp_click, chat_voz…) são repassados direto ao GA4 e ao Pixel.
 * IDs em js/danova-config.js. A escolha fica no navegador; o link "Preferências de cookies" no rodapé reabre o aviso. */
(function () {
  "use strict";
  if (window.__danovaConsent) return;
  window.__danovaConsent = true;
  var C = window.DANOVA_CONFIG || {};
  var GTM = /^GTM-[A-Z0-9]+$/i.test(C.GTM_ID || "") ? C.GTM_ID : "";
  var GA4 = /^G-[A-Z0-9]+$/i.test(C.GA4_ID || "") ? C.GA4_ID : "";
  var PIXEL = /^\d{6,20}$/.test(C.META_PIXEL_ID || "") ? C.META_PIXEL_ID : "";
  var CHAVE = "dn_consent_v1";

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.dnGtag = gtag;

  function ler() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
  function gravar(v) { try { localStorage.setItem(CHAVE, v); } catch (e) {} }
  var escolha = ler(); // "todos" | "essenciais" | null
  var NEG = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" };
  var OK = { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" };
  gtag("consent", "default", Object.assign({ wait_for_update: 500 }, escolha === "todos" ? OK : NEG));
  gtag("set", "ads_data_redaction", true);
  gtag("set", "url_passthrough", true);

  function script(src) { var s = document.createElement("script"); s.async = true; s.src = src; (document.head || document.documentElement).appendChild(s); }

  // ---------- Google ----------
  if (GTM) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    script("https://www.googletagmanager.com/gtm.js?id=" + GTM);
  } else if (GA4) {
    gtag("js", new Date());
    gtag("config", GA4, { send_page_view: true });
    script("https://www.googletagmanager.com/gtag/js?id=" + GA4);
  }

  // ---------- Meta Pixel (só com consentimento) ----------
  var pixelOn = false;
  function ligarPixel() {
    if (!PIXEL || pixelOn || GTM) return; // com GTM, o Pixel é configurado dentro do GTM
    pixelOn = true;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", PIXEL);
    window.fbq("track", "PageView");
  }
  if (escolha === "todos") ligarPixel();

  // ---------- repasse dos eventos do site (sem GTM) ----------
  var GA_EVENTOS = { generate_lead: 1, whatsapp_click: 1, email_click: 1, phone_click: 1, schedule_click: 1, social_click: 1, chat_message: 1, chat_voz: 1, video_pedido: 1 };
  var PIXEL_EVENTOS = { generate_lead: ["Lead"], video_pedido: ["Lead", { content_name: "video-anuncios" }], whatsapp_click: ["Contact"], phone_click: ["Contact"], email_click: ["Contact"], schedule_click: ["Schedule"] };
  function repassar(o) {
    if (!o || typeof o !== "object" || !o.event || GTM) return;
    var ev = o.event;
    if (GA4 && ev === "virtual_page_view") gtag("event", "page_view", { page_path: o.page_path, page_location: o.page_location, page_title: o.page_title });
    else if (GA4 && GA_EVENTOS[ev]) {
      var p = {}; ["lead_page", "lead_source", "form_id", "cta_location", "language", "first_touch_source", "last_touch_source", "last_touch_campaign", "value", "currency", "motor"].forEach(function (k) { if (o[k] != null && o[k] !== "") p[k] = o[k]; });
      gtag("event", ev, p);
    }
    if (pixelOn && window.fbq && PIXEL_EVENTOS[ev]) window.fbq("track", PIXEL_EVENTOS[ev][0], Object.assign({ lead_page: o.lead_page || "" }, PIXEL_EVENTOS[ev][1] || {}));
  }
  if (!GTM && (GA4 || PIXEL)) {
    var orig = window.dataLayer.push;
    window.dataLayer.push = function () {
      var r = orig.apply(window.dataLayer, arguments);
      for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; try { if (a && typeof a === "object" && typeof a.length !== "number") repassar(a); } catch (e) {} }
      return r;
    };
  }

  // ---------- banner ----------
  var TXT = {
    pt: { t: "Usamos cookies para medir visitas e melhorar nossos anúncios. Você escolhe.", a: "Aceitar", e: "Só essenciais", p: "Política de Privacidade" },
    en: { t: "We use cookies to measure visits and improve our ads. Your choice.", a: "Accept", e: "Essential only", p: "Privacy Policy" },
    es: { t: "Usamos cookies para medir visitas y mejorar nuestros anuncios. Tú eliges.", a: "Aceptar", e: "Solo esenciales", p: "Política de Privacidad" }
  };
  var lg = (navigator.language || "pt").slice(0, 2); var T = TXT[lg] || TXT.pt;
  var precisaBanner = !escolha && (GTM || GA4 || PIXEL);

  function decidir(v) {
    gravar(v); escolha = v;
    gtag("consent", "update", v === "todos" ? OK : NEG);
    window.dataLayer.push({ event: "consent_update", consent: v });
    if (v === "todos") ligarPixel();
    var b = document.getElementById("dnCookies"); if (b) b.remove();
  }
  function banner() {
    if (document.getElementById("dnCookies")) return;
    var d = document.createElement("div");
    d.id = "dnCookies"; d.className = "dn-cookies"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Cookies");
    d.innerHTML = '<p></p><div class="dn-cookies-acts"><button type="button" class="dn-ck-e"></button><button type="button" class="dn-ck-a"></button></div>';
    d.querySelector("p").innerHTML = T.t + ' <a href="politica-de-privacidade.html" target="_blank" rel="noopener">' + T.p + "</a>";
    d.querySelector(".dn-ck-a").textContent = T.a; d.querySelector(".dn-ck-e").textContent = T.e;
    d.querySelector(".dn-ck-a").addEventListener("click", function () { decidir("todos"); });
    d.querySelector(".dn-ck-e").addEventListener("click", function () { decidir("essenciais"); });
    document.body.appendChild(d);
  }
  window.danovaCookies = { abrir: banner, escolha: function () { return escolha; } };
  function iniciar() {
    if (precisaBanner) banner();
    Array.prototype.forEach.call(document.querySelectorAll("[data-cookies]"), function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); banner(); });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
