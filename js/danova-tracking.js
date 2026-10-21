/*!
 * danova-tracking.js — medição de contatos do site danova-ai.com
 * Versão 2026-10-17
 *
 * O que faz:
 *  1. Guarda a ORIGEM do visitante (UTM, gclid, fbclid, referrer) — primeiro e último toque.
 *  2. Envia ao Google Tag Manager (dataLayer) um evento para cada contato:
 *       whatsapp_click · email_click · phone_click · schedule_click · generate_lead
 *     sempre com a seção/página onde o contato aconteceu (lead_page) e a origem.
 *  3. Registra cada "página" interna do site (#eb5, #crypto, #melia...) como page_view virtual,
 *     para o GA4 mostrar quais seções geram contato.
 *  4. Envia os formulários para /api/lead (substitui danova-integrations.js), com a origem anexada.
 *
 * Não bloqueia nada: os formulários e botões continuam funcionando como antes.
 */
(function () {
  'use strict';
  if (window.__danovaTracking) return;
  window.__danovaTracking = true;

  var LEAD_ENDPOINT = '/api/lead.php';
  var STORE_FIRST = 'dn_first_touch';
  var STORE_LAST = 'dn_last_touch';

  window.dataLayer = window.dataLayer || [];
  function push(obj) { try { window.dataLayer.push(obj); } catch (e) {} }

  // ---------- armazenamento seguro ----------
  function getStore(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function setStore(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- origem do visitante ----------
  function readParams() {
    var p = {};
    try {
      var s = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'].forEach(function (k) {
        var v = s.get(k); if (v) p[k] = v.slice(0, 150);
      });
    } catch (e) {}
    return p;
  }

  function classifyReferrer() {
    var r = document.referrer || '';
    if (!r) return { source: '(direct)', medium: '(none)' };
    var host = '';
    try { host = new URL(r).hostname.replace(/^www\./, ''); } catch (e) { return { source: '(direct)', medium: '(none)' }; }
    if (host === location.hostname.replace(/^www\./, '')) return null; // navegação interna
    if (/google\.|bing\.|yahoo\.|duckduckgo\.|ecosia\./.test(host)) return { source: host.split('.')[0], medium: 'organic' };
    if (/instagram\.com|l\.instagram\.com/.test(host)) return { source: 'instagram', medium: 'social' };
    if (/facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com/.test(host)) return { source: 'facebook', medium: 'social' };
    if (/linkedin\.com|lnkd\.in/.test(host)) return { source: 'linkedin', medium: 'social' };
    if (/t\.co|twitter\.com|x\.com/.test(host)) return { source: 'x', medium: 'social' };
    if (/youtube\.com|youtu\.be/.test(host)) return { source: 'youtube', medium: 'social' };
    if (/chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google/.test(host)) return { source: host, medium: 'ai_referral' };
    return { source: host, medium: 'referral' };
  }

  var params = readParams();
  var touch = null;
  if (params.utm_source || params.gclid || params.fbclid) {
    touch = {
      source: params.utm_source || (params.gclid ? 'google' : 'facebook'),
      medium: params.utm_medium || (params.gclid ? 'cpc' : 'paid_social'),
      campaign: params.utm_campaign || '',
      content: params.utm_content || '',
      term: params.utm_term || '',
      gclid: params.gclid || '',
      fbclid: params.fbclid || ''
    };
  } else {
    var ref = classifyReferrer();
    if (ref) touch = { source: ref.source, medium: ref.medium, campaign: '', content: '', term: '', gclid: '', fbclid: '' };
  }
  if (touch) {
    touch.landing_page = location.pathname + location.hash;
    touch.referrer = (document.referrer || '').slice(0, 300);
    touch.ts = new Date().toISOString();
    if (!getStore(STORE_FIRST)) setStore(STORE_FIRST, touch);
    // não sobrescreve um último toque com UTM por uma visita "direta"
    var last = getStore(STORE_LAST);
    if (!(touch.source === '(direct)' && last && last.source !== '(direct)')) setStore(STORE_LAST, touch);
  }
  var first = getStore(STORE_FIRST) || {};
  var lastT = getStore(STORE_LAST) || {};

  function attribution() {
    return {
      first_touch_source: first.source || '', first_touch_medium: first.medium || '', first_touch_campaign: first.campaign || '',
      last_touch_source: lastT.source || '', last_touch_medium: lastT.medium || '', last_touch_campaign: lastT.campaign || '',
      utm_content: lastT.content || '', utm_term: lastT.term || '',
      gclid: lastT.gclid || '', fbclid: lastT.fbclid || '',
      landing_page: first.landing_page || '', referrer: first.referrer || ''
    };
  }

  // ---------- seção/página atual ----------
  function currentSection() {
    try {
      var page = document.querySelector('.danova-page.active');
      if (page && page.id) return page.id.replace(/^page-/, ''); // page-eb5 -> eb5
    } catch (e) {}
    var h = (location.hash || '').replace(/^#/, '').split('/')[0];
    return h || 'home';
  }
  function ctaLocation(el) {
    try {
      var s = (el.parentElement || el).closest('[id]:not(form):not(input):not(button)');
      return s ? s.id : '';
    } catch (e) { return ''; }
  }
  function language() {
    try {
      var a = document.querySelector('.lang-en.active, .lang-pt.active, .lang-es.active');
      if (a) return a.classList.contains('lang-pt') ? 'pt' : a.classList.contains('lang-es') ? 'es' : 'en';
    } catch (e) {}
    return (document.documentElement.lang || navigator.language || 'pt').slice(0, 2);
  }

  // ---------- page_view virtual por seção ----------
  var lastPath = null;
  function virtualPageView() {
    var sec = currentSection();
    var path = sec === 'home' ? '/' : '/' + sec;
    if (path === lastPath) return;
    lastPath = path;
    push({ event: 'virtual_page_view', page_path: path, page_location: location.origin + path, page_title: document.title, lead_page: sec });
  }
  window.addEventListener('hashchange', function () { setTimeout(virtualPageView, 50); });
  // seções trocadas via JavaScript sem mudar a URL
  var mvTimer = null;
  try {
    new MutationObserver(function () {
      if (mvTimer) return;
      mvTimer = setTimeout(function () { mvTimer = null; virtualPageView(); }, 400);
    })
      .observe(document.body || document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  } catch (e) {}

  // ---------- eventos de contato ----------
  function contactEvent(name, el, extra) {
    var o = {
      event: name,
      lead_page: currentSection(),
      cta_location: el ? ctaLocation(el) : '',
      link_text: el ? ((el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80)) : '',
      link_url: el && el.href ? el.href.split('?')[0] : '',
      language: language()
    };
    var a = attribution(); for (var k in a) o[k] = a[k];
    if (extra) for (var j in extra) o[j] = extra[j];
    push(o);
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\//i.test(href)) contactEvent('whatsapp_click', a);
    else if (/^mailto:/i.test(href)) contactEvent('email_click', a);
    else if (/^tel:/i.test(href)) contactEvent('phone_click', a);
    else if (/calendly\.com/i.test(href)) contactEvent('schedule_click', a);
    else if (/instagram\.com|linkedin\.com/i.test(href)) contactEvent('social_click', a);
  }, true);

  // ---------- formulários ----------
  var sentRecently = {};
  // Muitos formulários do site não têm atributo name; por isso há busca por tipo de campo.
  var TYPE_FALLBACK = {
    email: 'input[type="email"]',
    phone: 'input[type="tel"]',
    name: 'input[type="text"]:not([name="address"]):not([name="website"])',
    message: 'textarea'
  };
  function pick(form, names, fallbackKey) {
    for (var i = 0; i < names.length; i++) {
      var el = form.querySelector('[name="' + names[i] + '"]');
      if (el && el.value && String(el.value).trim()) return String(el.value).trim();
    }
    if (fallbackKey && TYPE_FALLBACK[fallbackKey]) {
      var f = form.querySelector(TYPE_FALLBACK[fallbackKey]);
      if (f && f.value && String(f.value).trim()) return String(f.value).trim();
    }
    return '';
  }
  function fillHidden(form) {
    var a = attribution(); a.lead_page = currentSection();
    for (var k in a) {
      var el = form.querySelector('input[name="' + k + '"]');
      if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = k; form.appendChild(el); }
      el.value = a[k];
    }
  }
  function sendLead(form, formName) {
    if (!form) return;
    var email = pick(form, ['email', 'Email', 'EMAIL', 'e-mail'], 'email');
    var phone = pick(form, ['phone', 'tel', 'telefone', 'whatsapp', 'Phone'], 'phone');
    if (!email && !phone) return;
    formName = formName || form.id || ctaLocation(form) || 'form';
    var key = formName + '|' + (email || phone);
    if (sentRecently[key] && Date.now() - sentRecently[key] < 10000) return;
    sentRecently[key] = Date.now();

    fillHidden(form);
    var first_name = pick(form, ['firstName', 'first_name']);
    var payload = {
      email: email,
      name: pick(form, ['name', 'fullname', 'full_name', 'nome', 'fullName']) || (first_name + ' ' + pick(form, ['lastName', 'last_name'])).trim() || pick(form, [], 'name'),
      phone: phone,
      message: pick(form, ['message', 'mensagem', 'notes', 'comments', 'interest'], 'message'),
      budget: pick(form, ['budget', 'orcamento']),
      timeline: pick(form, ['timeline', 'prazo']),
      goal: pick(form, ['goal', 'objective', 'objetivo']),
      country: pick(form, ['country', 'pais', 'location']),
      source: formName || form.id || 'website',
      language: language(),
      page: currentSection(),
      lead_page: currentSection(),
      website: pick(form, ['website']) // honeypot
    };
    var a = attribution(); for (var k in a) payload[k] = a[k];

    try {
      fetch(LEAD_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true })
        .catch(function () {});
    } catch (e) {}

    contactEvent('generate_lead', form, { form_id: formName || form.id || '', lead_source: payload.source, value: 1, currency: 'USD' });
  }
  window.danovaSendLead = sendLead;

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (f && f.tagName === 'FORM') sendLead(f);
  }, true);

  // Formulários que "enviam" por botão sem disparar submit (quizzes): embrulha as funções existentes.
  // (os demais formulários disparam "submit" normalmente e já são capturados acima)
  var wrapMap = {
    submitQuiz: 'leadForm'
  };
  function wrapAll() {
    Object.keys(wrapMap).forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function' || orig.__dnWrapped) return;
      var w = function () {
        try { sendLead(document.getElementById(wrapMap[fn]), wrapMap[fn]); } catch (e) {}
        return orig.apply(this, arguments);
      };
      w.__dnWrapped = true;
      window[fn] = w;
    });
  }
  // Banner de cookies do site -> Consent Mode do Google
  var G = window.dnGtag || function () { window.dataLayer.push(arguments); };
  var GRANT = { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' };
  var DENY = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
  function wrapConsent() {
    ['acceptCookies', 'declineCookies'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function' || orig.__dnWrapped) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { G('consent', 'update', fn === 'acceptCookies' ? GRANT : DENY); push({ event: 'consent_update' }); } catch (e) {}
        return r;
      };
      w.__dnWrapped = true;
      window[fn] = w;
    });
  }
  wrapConsent();
  window.addEventListener('load', wrapConsent);

  // Na primeira carga o Google Tag já envia o page_view; só marcamos a seção inicial.
  function initPath() { var s = currentSection(); lastPath = s === 'home' ? '/' : '/' + s; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { wrapAll(); initPath(); });
  else { wrapAll(); initPath(); }
  window.addEventListener('load', wrapAll);

  // Imagem que falhar ao carregar (ex.: foto externa removida) recebe o placeholder dourado do site
  var DN_PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d4b87d"/><stop offset="50%" stop-color="#b8963e"/><stop offset="100%" stop-color="#8a6d2d"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><text x="200" y="155" font-family="Georgia, serif" font-size="14" fill="#fff" text-anchor="middle" opacity="0.5" letter-spacing="3">DANOVA AI</text></svg>');
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || img.getAttribute('data-dn-fallback')) return;
    img.setAttribute('data-dn-fallback', '1');
    img.removeAttribute('srcset');
    img.src = DN_PH;
  }, true);

  // Atalho público para outros scripts do site
  window.danovaTrack = function (name, params) { contactEvent(name, null, params || {}); };
})();
