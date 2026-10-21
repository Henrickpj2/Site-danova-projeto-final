/* danova AI — chat do atendente virtual (site) */
(function () {
  "use strict";
  var crm = window.DANOVA_CRM || {};
  if (!crm.url) return;
  var ENDPOINT = crm.url + "/functions/v1/atendente";
  var CHAVE = "dn_chat_v1";
  var idioma = ((navigator.language || "pt").slice(0, 2).toLowerCase());
  if (["pt", "en", "es"].indexOf(idioma) < 0) idioma = "pt";
  var T = {
    pt: { titulo: "Atendimento danova AI", sub: "Assistente virtual · responde em PT, EN e ES", ola: "Olá! Sou o assistente virtual da equipe da Danielle Lisboa Martins. Posso falar sobre os empreendimentos em Miami e Palm Beach, formas de pagamento, EB-5 e compra com cripto. Como posso ajudar?", ph: "Escreva sua mensagem…", enviar: "Enviar", pessoa: "Falar com uma pessoa", wpp: "Continuar no WhatsApp", aviso: "Assistente com IA. Pode cometer erros — a equipe confirma valores e condições.", erro: "Não consegui responder agora. Você pode falar direto com a equipe pelo WhatsApp.", chips: ["Quais empreendimentos vocês têm?", "Opções até US$ 1 milhão", "Como funciona o EB-5?", "Posso comprar com cripto?"], abrir: "Abrir atendimento", fechar: "Fechar", novo: "Nova conversa", registrado: "Seus dados foram enviados à equipe." },
    en: { titulo: "danova AI concierge", sub: "Virtual assistant · replies in EN, PT and ES", ola: "Hi! I'm the virtual assistant for Danielle Lisboa Martins' team. I can help with our Miami and Palm Beach developments, payment plans, EB-5 and buying with crypto. How can I help?", ph: "Type your message…", enviar: "Send", pessoa: "Talk to a person", wpp: "Continue on WhatsApp", aviso: "AI assistant. It can make mistakes — our team confirms prices and terms.", erro: "I couldn't reply right now. You can reach the team directly on WhatsApp.", chips: ["Which developments do you have?", "Options under US$ 1M", "How does EB-5 work?", "Can I buy with crypto?"], abrir: "Open chat", fechar: "Close", novo: "New conversation", registrado: "Your details were sent to our team." },
    es: { titulo: "Atención danova AI", sub: "Asistente virtual · responde en ES, PT y EN", ola: "¡Hola! Soy el asistente virtual del equipo de Danielle Lisboa Martins. Puedo ayudarte con los proyectos en Miami y Palm Beach, planes de pago, EB-5 y compra con cripto. ¿En qué te ayudo?", ph: "Escribe tu mensaje…", enviar: "Enviar", pessoa: "Hablar con una persona", wpp: "Continuar por WhatsApp", aviso: "Asistente con IA. Puede equivocarse — el equipo confirma precios y condiciones.", erro: "No pude responder ahora. Puedes hablar con el equipo por WhatsApp.", chips: ["¿Qué proyectos tienen?", "Opciones hasta US$ 1 millón", "¿Cómo funciona el EB-5?", "¿Puedo comprar con cripto?"], abrir: "Abrir chat", fechar: "Cerrar", novo: "Nueva conversación", registrado: "Tus datos fueron enviados al equipo." }
  }[idioma];

  function ler() { try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (e) { return null; } }
  function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(S)); } catch (e) {} }
  var S = ler() || { conversa_id: null, token: null, msgs: [], lead: false };
  if (!Array.isArray(S.msgs)) S.msgs = [];

  var raiz = document.createElement("div");
  raiz.className = "dn-chat";
  raiz.innerHTML =
    '<button class="dn-chat-launcher" type="button" aria-expanded="false" aria-controls="dnChatPanel"><span class="dn-chat-dot"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.4c-.5.4-1.3 0-1.3-.6V16H6.5A2.5 2.5 0 0 1 4 13.5v-8Z" fill="currentColor"/></svg><span class="dn-chat-label"></span></button>' +
    '<section class="dn-chat-panel" id="dnChatPanel" role="dialog" aria-label="" hidden>' +
    '<header class="dn-chat-head"><div class="dn-chat-avatar">d</div><div><strong></strong><small></small></div><button class="dn-chat-x" type="button">✕</button></header>' +
    '<div class="dn-chat-msgs" role="log" aria-live="polite"></div>' +
    '<div class="dn-chat-chips"></div>' +
    '<form class="dn-chat-form"><textarea rows="1" maxlength="1000" required></textarea><button type="submit">➤</button></form>' +
    '<footer class="dn-chat-foot"><span></span><button type="button" class="dn-chat-new"></button></footer>' +
    "</section>";
  document.body.appendChild(raiz);

  var $ = function (s) { return raiz.querySelector(s); };
  var launcher = $(".dn-chat-launcher"), panel = $(".dn-chat-panel"), box = $(".dn-chat-msgs"), chips = $(".dn-chat-chips"), form = $(".dn-chat-form"), input = $("textarea");
  $(".dn-chat-label").textContent = T.abrir;
  launcher.setAttribute("aria-label", T.abrir);
  panel.setAttribute("aria-label", T.titulo);
  $(".dn-chat-head strong").textContent = T.titulo;
  $(".dn-chat-head small").textContent = T.sub;
  $(".dn-chat-x").setAttribute("aria-label", T.fechar);
  input.placeholder = T.ph;
  form.querySelector("button").setAttribute("aria-label", T.enviar);
  $(".dn-chat-foot span").textContent = T.aviso;
  $(".dn-chat-new").textContent = T.novo;

  function balao(papel, texto, extra) {
    var d = document.createElement("div");
    d.className = "dn-msg dn-" + papel;
    d.textContent = texto;
    if (extra && extra.url) {
      var a = document.createElement("a");
      a.href = extra.url; a.target = "_blank"; a.rel = "noopener"; a.className = "dn-wpp"; a.textContent = T.wpp;
      d.appendChild(document.createElement("br")); d.appendChild(a);
    }
    box.appendChild(d); box.scrollTop = box.scrollHeight;
    return d;
  }
  function render() {
    box.innerHTML = "";
    balao("agente", T.ola);
    S.msgs.forEach(function (m) { balao(m.p, m.t, m.a); });
    chips.innerHTML = "";
    var lista = S.msgs.length ? [T.pessoa] : T.chips.concat([T.pessoa]);
    lista.forEach(function (c) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = c;
      b.addEventListener("click", function () { enviar(c); });
      chips.appendChild(b);
    });
  }
  function abrir(sim) {
    panel.hidden = !sim; launcher.setAttribute("aria-expanded", String(sim));
    raiz.classList.toggle("open", sim);
    if (sim) { render(); setTimeout(function () { input.focus(); }, 50); }
  }
  launcher.addEventListener("click", function () { abrir(panel.hidden); });
  $(".dn-chat-x").addEventListener("click", function () { abrir(false); launcher.focus(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) abrir(false); });
  $(".dn-chat-new").addEventListener("click", function () { S = { conversa_id: null, token: null, msgs: [], lead: false }; salvar(); render(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 110) + "px"; });
  form.addEventListener("submit", function (e) { e.preventDefault(); enviar(input.value); });

  var ocupado = false;
  function enviar(texto) {
    texto = String(texto || "").trim();
    if (!texto || ocupado) return;
    ocupado = true; input.value = ""; input.style.height = "auto";
    S.msgs.push({ p: "cliente", t: texto }); salvar(); balao("cliente", texto);
    chips.innerHTML = "";
    var dig = balao("agente dn-digitando", "•••");
    if (window.dataLayer) window.dataLayer.push({ event: "chat_message", lead_page: "chat-ia" });
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: crm.anonKey, Authorization: "Bearer " + crm.anonKey },
      body: JSON.stringify({ conversa_id: S.conversa_id, token: S.token, mensagem: texto, idioma: idioma, pagina: (location.hash || "home").slice(0, 60) })
    }).then(function (r) { return r.json(); }).then(function (d) {
      dig.remove();
      if (d.conversa_id && d.token) { S.conversa_id = d.conversa_id; S.token = d.token; }
      var acao = d.acao && d.acao.url ? { url: d.acao.url } : null;
      S.msgs.push({ p: "agente", t: d.resposta || T.erro, a: acao });
      if (d.lead_registrado && !S.lead) { S.lead = true; if (window.dataLayer) window.dataLayer.push({ event: "generate_lead", lead_source: "chat-ia" }); }
      salvar(); render();
    }).catch(function () {
      dig.remove();
      S.msgs.push({ p: "agente", t: T.erro, a: { url: "https://wa.me/17863826782" } }); salvar(); render();
    }).then(function () { ocupado = false; });
  }
  window.danovaAbrirChat = function (msg) { abrir(true); if (msg) enviar(msg); };
  Array.prototype.forEach.call(document.querySelectorAll("[data-abrir-chat]"), function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); abrir(true); });
  });
})();
