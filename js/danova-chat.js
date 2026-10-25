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
    pt: { titulo: "Atendimento danova AI", sub: "Assistente virtual · responde em PT, EN e ES", ola: "Olá! Sou o assistente virtual da equipe da Danielle Lisboa Martins. Posso falar sobre os empreendimentos em Miami e Palm Beach, formas de pagamento, EB-5 e compra com cripto. Como posso ajudar?", ph: "Escreva sua mensagem…", enviar: "Enviar", pessoa: "Falar com uma pessoa", wpp: "Continuar no WhatsApp", aviso: "Assistente com IA. Pode cometer erros — a equipe confirma valores e condições.", erro: "Não consegui responder agora. Você pode falar direto com a equipe pelo WhatsApp.", chips: ["Quais empreendimentos vocês têm?", "Opções até US$ 1 milhão", "Como funciona o EB-5?", "Posso comprar com cripto?"], abrir: "Abrir atendimento", fechar: "Fechar", novo: "Nova conversa", registrado: "Seus dados foram enviados à equipe.",
      voz: "Falar por voz", vozTit: "Atendimento por voz", toque: "Toque para falar", ouvindo: "Ouvindo… fale à vontade", transcrevendo: "Entendendo o que você disse…", pensando: "Pensando na resposta…", falando: "Falando… toque para interromper", continua: "Conversa contínua", voltar: "Voltar ao texto", ouvir: "Ouvir", ditar: "Ditar mensagem", semSuporte: "Seu navegador não permite falar por aqui. Use o Chrome, o Edge ou o Safari atualizado.", semMic: "Não consegui acessar o microfone. Libere a permissão do microfone no navegador.", naoEntendi: "Não captei sua fala. Toque e tente de novo.", e1: "Fala → texto", e2: "IA responde", e3: "Texto → fala", nav: "navegador" },
    en: { titulo: "danova AI concierge", sub: "Virtual assistant · replies in EN, PT and ES", ola: "Hi! I'm the virtual assistant for Danielle Lisboa Martins' team. I can help with our Miami and Palm Beach developments, payment plans, EB-5 and buying with crypto. How can I help?", ph: "Type your message…", enviar: "Send", pessoa: "Talk to a person", wpp: "Continue on WhatsApp", aviso: "AI assistant. It can make mistakes — our team confirms prices and terms.", erro: "I couldn't reply right now. You can reach the team directly on WhatsApp.", chips: ["Which developments do you have?", "Options under US$ 1M", "How does EB-5 work?", "Can I buy with crypto?"], abrir: "Open chat", fechar: "Close", novo: "New conversation", registrado: "Your details were sent to our team.",
      voz: "Talk by voice", vozTit: "Voice assistant", toque: "Tap to speak", ouvindo: "Listening… go ahead", transcrevendo: "Understanding what you said…", pensando: "Thinking…", falando: "Speaking… tap to interrupt", continua: "Continuous conversation", voltar: "Back to text", ouvir: "Listen", ditar: "Dictate message", semSuporte: "Your browser doesn't support voice here. Use an up-to-date Chrome, Edge or Safari.", semMic: "I couldn't access the microphone. Please allow microphone access in your browser.", naoEntendi: "I didn't catch that. Tap and try again.", e1: "Speech → text", e2: "AI replies", e3: "Text → speech", nav: "browser" },
    es: { titulo: "Atención danova AI", sub: "Asistente virtual · responde en ES, PT y EN", ola: "¡Hola! Soy el asistente virtual del equipo de Danielle Lisboa Martins. Puedo ayudarte con los proyectos en Miami y Palm Beach, planes de pago, EB-5 y compra con cripto. ¿En qué te ayudo?", ph: "Escribe tu mensaje…", enviar: "Enviar", pessoa: "Hablar con una persona", wpp: "Continuar por WhatsApp", aviso: "Asistente con IA. Puede equivocarse — el equipo confirma precios y condiciones.", erro: "No pude responder ahora. Puedes hablar con el equipo por WhatsApp.", chips: ["¿Qué proyectos tienen?", "Opciones hasta US$ 1 millón", "¿Cómo funciona el EB-5?", "¿Puedo comprar con cripto?"], abrir: "Abrir chat", fechar: "Cerrar", novo: "Nueva conversación", registrado: "Tus datos fueron enviados al equipo.",
      voz: "Hablar por voz", vozTit: "Atención por voz", toque: "Toca para hablar", ouvindo: "Escuchando… habla con calma", transcrevendo: "Entendiendo lo que dijiste…", pensando: "Pensando la respuesta…", falando: "Hablando… toca para interrumpir", continua: "Conversación continua", voltar: "Volver al texto", ouvir: "Escuchar", ditar: "Dictar mensaje", semSuporte: "Tu navegador no permite voz aquí. Usa Chrome, Edge o Safari actualizado.", semMic: "No pude acceder al micrófono. Permite el micrófono en el navegador.", naoEntendi: "No capté tu voz. Toca e intenta de nuevo.", e1: "Voz → texto", e2: "IA responde", e3: "Texto → voz", nav: "navegador" }
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
    '<header class="dn-chat-head"><div class="dn-chat-avatar">d</div><div><strong></strong><small></small></div><button class="dn-chat-vozbtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button><button class="dn-chat-x" type="button">✕</button></header>' +
    '<div class="dn-voz" hidden><div class="dn-voz-pipe"><div data-e="1"><b></b><small data-p1></small></div><i>↓</i><div data-e="2"><b></b><small>Claude</small></div><i>↓</i><div data-e="3"><b></b><small data-p3></small></div></div>' +
    '<button class="dn-voz-orb" type="button"><span></span><span></span><span></span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg></button>' +
    '<p class="dn-voz-status" aria-live="polite"></p><p class="dn-voz-txt"></p>' +
    '<div class="dn-voz-acts"><label><input type="checkbox" data-continua checked> <span></span></label><button type="button" class="dn-voz-sair"></button></div></div>' +
    '<div class="dn-chat-msgs" role="log" aria-live="polite"></div>' +
    '<div class="dn-chat-chips"></div>' +
    '<form class="dn-chat-form"><button type="button" class="dn-chat-mic"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg></button><textarea rows="1" maxlength="1000" required></textarea><button type="submit">➤</button></form>' +
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
  $(".dn-chat-vozbtn").setAttribute("aria-label", T.voz); $(".dn-chat-vozbtn").title = T.voz;
  $(".dn-chat-mic").setAttribute("aria-label", T.ditar); $(".dn-chat-mic").title = T.ditar;
  $(".dn-voz-pipe [data-e='1'] b").textContent = T.e1; $(".dn-voz-pipe [data-e='2'] b").textContent = T.e2; $(".dn-voz-pipe [data-e='3'] b").textContent = T.e3;
  $(".dn-voz-acts span").textContent = T.continua; $(".dn-voz-sair").textContent = T.voltar;

  function balao(papel, texto, extra) {
    var d = document.createElement("div");
    d.className = "dn-msg dn-" + papel;
    d.textContent = texto;
    if (extra && extra.url) {
      var a = document.createElement("a");
      a.href = extra.url; a.target = "_blank"; a.rel = "noopener"; a.className = "dn-wpp"; a.textContent = T.wpp;
      d.appendChild(document.createElement("br")); d.appendChild(a);
    }
    if (papel === "agente" && texto && texto !== "•••") {
      var ouv = document.createElement("button"); ouv.type = "button"; ouv.className = "dn-ouvir"; ouv.title = T.ouvir; ouv.setAttribute("aria-label", T.ouvir); ouv.textContent = "🔊";
      ouv.addEventListener("click", function () { VOZ.destravar(); VOZ.falar(texto); });
      d.appendChild(ouv);
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
    if (!texto || ocupado) return Promise.resolve(null);
    ocupado = true; input.value = ""; input.style.height = "auto";
    S.msgs.push({ p: "cliente", t: texto }); salvar(); balao("cliente", texto);
    chips.innerHTML = "";
    var dig = balao("agente dn-digitando", "•••");
    if (window.dataLayer) window.dataLayer.push({ event: "chat_message", lead_page: "chat-ia" });
    return fetch(ENDPOINT, {
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
      return d.resposta || T.erro;
    }).catch(function () {
      dig.remove();
      S.msgs.push({ p: "agente", t: T.erro, a: { url: "https://wa.me/17863826782" } }); salvar(); render();
      return T.erro;
    }).then(function (resp) { ocupado = false; return resp; });
  }
  // ================= VOZ: fala → texto → IA → fala =================
  var VOZ_URL = crm.url + "/functions/v1/voz", LANG = { pt: "pt-BR", en: "en-US", es: "es-ES" }[idioma];
  var cabecalhos = { "Content-Type": "application/json", apikey: crm.anonKey, Authorization: "Bearer " + crm.anonKey };
  var VOZ = (function () {
    var status = null, audio = null, falandoAgora = null, reconhecedor = null, gravando = null;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    function obterStatus() {
      if (status) return Promise.resolve(status);
      return fetch(VOZ_URL, { method: "POST", headers: cabecalhos, body: JSON.stringify({ acao: "status" }) })
        .then(function (r) { return r.json(); }).catch(function () { return {}; })
        .then(function (j) { status = { stt: !!j.stt, tts: !!j.tts }; return status; });
    }
    var destravado = false;
    function destravar() { // iPhone: o áudio precisa nascer de um toque do usuário
      if (destravado) return; destravado = true;
      if (!audio) { audio = new Audio(); audio.setAttribute("playsinline", ""); }
      audio.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==";
      audio.play().catch(function () { });
      if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) { } }
    }
    function pararFala() {
      if (audio) { try { audio.pause(); } catch (e) { } }
      if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) { } }
      if (falandoAgora) { var f = falandoAgora; falandoAgora = null; f(); }
    }
    function falarNavegador(texto) {
      return new Promise(function (ok) {
        if (!window.speechSynthesis) return ok();
        var u = new SpeechSynthesisUtterance(texto); u.lang = LANG; u.rate = 1.02;
        var vozes = speechSynthesis.getVoices(), melhor = vozes.filter(function (v) { return v.lang && v.lang.replace("_", "-").indexOf(LANG.slice(0, 2)) === 0; });
        var pref = melhor.find(function (v) { return /natural|neural|google|luciana|francisca|thalita|samantha|paulina|monica/i.test(v.name); }) || melhor[0];
        if (pref) u.voice = pref;
        falandoAgora = ok; u.onend = u.onerror = function () { falandoAgora = null; ok(); };
        speechSynthesis.speak(u);
      });
    }
    function limpar(t) { return String(t || "").replace(/https?:\/\/\S+/g, "").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 700); }
    function falar(texto) {
      pararFala(); texto = limpar(texto); if (!texto) return Promise.resolve();
      return obterStatus().then(function (st) {
        if (!st.tts) return falarNavegador(texto);
        return fetch(VOZ_URL, { method: "POST", headers: cabecalhos, body: JSON.stringify({ acao: "falar", texto: texto, idioma: idioma }) })
          .then(function (r) { if (!r.ok) throw new Error("tts"); return r.blob(); })
          .then(function (b) {
            return new Promise(function (ok) {
              if (!audio) { audio = new Audio(); audio.setAttribute("playsinline", ""); }
              var url = URL.createObjectURL(b); audio.src = url; falandoAgora = ok;
              audio.onended = audio.onerror = function () { URL.revokeObjectURL(url); falandoAgora = null; ok(); };
              audio.play().catch(function () { falandoAgora = null; falarNavegador(texto).then(ok); });
            });
          }).catch(function () { return falarNavegador(texto); });
      });
    }
    function ouvirNavegador(aoParcial) {
      return new Promise(function (ok, erro) {
        if (!SR) return erro(new Error("sem_suporte"));
        var r = new SR(), final = "", parcial = ""; reconhecedor = r;
        r.lang = LANG; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
        r.onresult = function (e) {
          parcial = ""; for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript; else parcial += e.results[i][0].transcript; }
          if (aoParcial) aoParcial((final + " " + parcial).trim());
        };
        r.onerror = function (e) { reconhecedor = null; if (e.error === "not-allowed" || e.error === "service-not-allowed") erro(new Error("sem_mic")); else ok((final || parcial).trim()); };
        r.onend = function () { reconhecedor = null; ok((final || parcial).trim()); };
        try { r.start(); } catch (e) { erro(e); }
      });
    }
    function gravarServidor(aoNivel) {
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        return new Promise(function (ok) {
          var tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"], tipo = tipos.find(function (t) { return window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); }) || "";
          var rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined), partes = [];
          var ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(an);
          var buf = new Uint8Array(an.fftSize), falou = false, ultimoSom = Date.now(), inicio = Date.now(), timer;
          gravando = function () { try { rec.state !== "inactive" && rec.stop(); } catch (e) { } };
          function medir() {
            an.getByteTimeDomainData(buf); var soma = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; soma += v * v; }
            var rms = Math.sqrt(soma / buf.length); if (aoNivel) aoNivel(rms);
            if (rms > 0.035) { falou = true; ultimoSom = Date.now(); }
            var agora = Date.now();
            if ((falou && agora - ultimoSom > 1300) || agora - inicio > 25000 || (!falou && agora - inicio > 8000)) return gravando();
            timer = requestAnimationFrame(medir);
          }
          rec.ondataavailable = function (e) { if (e.data && e.data.size) partes.push(e.data); };
          rec.onstop = function () {
            cancelAnimationFrame(timer); stream.getTracks().forEach(function (t) { t.stop(); }); try { ctx.close(); } catch (e) { } gravando = null;
            ok(falou ? new Blob(partes, { type: rec.mimeType || tipo || "audio/webm" }) : null);
          };
          rec.start(); medir();
        });
      });
    }
    function transcrever(blob) {
      return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(String(fr.result).split(",")[1]); }; fr.readAsDataURL(blob); })
        .then(function (b64) { return fetch(VOZ_URL, { method: "POST", headers: cabecalhos, body: JSON.stringify({ acao: "transcrever", audio: b64, mime: blob.type, idioma: idioma }) }); })
        .then(function (r) { return r.json(); }).then(function (j) { if (j.erro) throw new Error(j.erro); return j.texto || ""; });
    }
    // escuta: Whisper no servidor quando configurado; senão, o reconhecimento do próprio navegador
    function ouvir(cb) {
      return obterStatus().then(function (st) {
        var podeGravar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
        if (st.stt && podeGravar) {
          return gravarServidor(cb.nivel).then(function (blob) {
            if (!blob) return "";
            cb.estado("transcrevendo");
            return transcrever(blob).catch(function () { return SR ? (cb.estado("ouvindo"), ouvirNavegador(cb.parcial)) : ""; });
          }, function () { throw new Error("sem_mic"); });
        }
        if (SR) return ouvirNavegador(cb.parcial);
        throw new Error("sem_suporte");
      });
    }
    function pararEscuta() { if (reconhecedor) { try { reconhecedor.stop(); } catch (e) { } } if (gravando) gravando(); }
    return { status: obterStatus, falar: falar, pararFala: pararFala, ouvir: ouvir, pararEscuta: pararEscuta, destravar: destravar, suporta: function () { return !!SR || !!(navigator.mediaDevices && window.MediaRecorder); } };
  })();

  // painel de voz
  var vozBox = $(".dn-voz"), orb = $(".dn-voz-orb"), vStatus = $(".dn-voz-status"), vTxt = $(".dn-voz-txt"), estadoVoz = "parado", sessao = 0;
  function definirEstado(e, texto) {
    estadoVoz = e; vozBox.dataset.estado = e;
    vStatus.textContent = texto || { parado: T.toque, ouvindo: T.ouvindo, transcrevendo: T.transcrevendo, pensando: T.pensando, falando: T.falando }[e] || "";
    Array.prototype.forEach.call(vozBox.querySelectorAll(".dn-voz-pipe > div"), function (d) {
      d.classList.toggle("on", (d.dataset.e === "1" && (e === "ouvindo" || e === "transcrevendo")) || (d.dataset.e === "2" && e === "pensando") || (d.dataset.e === "3" && e === "falando"));
    });
  }
  function abrirVoz(sim) {
    vozBox.hidden = !sim; raiz.classList.toggle("modo-voz", sim);
    if (sim) {
      VOZ.status().then(function (st) { $("[data-p1]").textContent = st.stt ? "Whisper" : T.nav; $("[data-p3]").textContent = st.tts ? "ElevenLabs" : T.nav; });
      vTxt.textContent = ""; definirEstado("parado");
      if (!VOZ.suporta()) definirEstado("parado", T.semSuporte);
    } else { sessao++; VOZ.pararEscuta(); VOZ.pararFala(); definirEstado("parado"); }
  }
  function ciclo() {
    var minha = ++sessao;
    definirEstado("ouvindo"); vTxt.textContent = "";
    VOZ.ouvir({ estado: function (e) { if (minha === sessao) definirEstado(e); }, parcial: function (t) { if (minha === sessao) vTxt.textContent = t; }, nivel: function (n) { orb.style.setProperty("--nivel", Math.min(1, n * 9).toFixed(2)); } })
      .then(function (texto) {
        if (minha !== sessao) return;
        orb.style.setProperty("--nivel", 0);
        if (!texto) return definirEstado("parado", T.naoEntendi);
        vTxt.textContent = "“" + texto + "”"; definirEstado("pensando");
        if (window.dataLayer) window.dataLayer.push({ event: "chat_voz", lead_page: "chat-ia" });
        return enviar(texto).then(function (resp) {
          if (minha !== sessao || !resp) return;
          definirEstado("falando"); vTxt.textContent = resp.length > 220 ? resp.slice(0, 220) + "…" : resp;
          return VOZ.falar(resp).then(function () {
            if (minha !== sessao) return;
            if ($("[data-continua]").checked && !vozBox.hidden) ciclo(); else definirEstado("parado");
          });
        });
      }).catch(function (e) { if (minha === sessao) definirEstado("parado", e && e.message === "sem_mic" ? T.semMic : T.semSuporte); });
  }
  orb.addEventListener("click", function () {
    VOZ.destravar();
    if (estadoVoz === "parado") return ciclo();
    if (estadoVoz === "ouvindo") return VOZ.pararEscuta();
    if (estadoVoz === "falando") { VOZ.pararFala(); return ciclo(); } // interromper e falar
  });
  $(".dn-chat-vozbtn").addEventListener("click", function () { VOZ.destravar(); abrirVoz(vozBox.hidden); });
  $(".dn-voz-sair").addEventListener("click", function () { abrirVoz(false); input.focus(); });
  // ditado rápido no campo de texto
  var mic = $(".dn-chat-mic"), ditando = false;
  mic.addEventListener("click", function () {
    VOZ.destravar();
    if (ditando) { VOZ.pararEscuta(); return; }
    ditando = true; mic.classList.add("on"); var antes = input.value;
    VOZ.ouvir({ estado: function () { }, parcial: function (t) { input.value = (antes ? antes + " " : "") + t; }, nivel: function () { } })
      .then(function (t) { if (t) input.value = (antes ? antes + " " : "") + t; input.focus(); input.dispatchEvent(new Event("input")); })
      .catch(function (e) { balao("agente", e && e.message === "sem_mic" ? T.semMic : T.semSuporte); })
      .then(function () { ditando = false; mic.classList.remove("on"); });
  });
  if (!VOZ.suporta()) { mic.hidden = true; }

  window.danovaAbrirChat = function (msg) { abrir(true); if (msg) enviar(msg); };
  Array.prototype.forEach.call(document.querySelectorAll("[data-abrir-chat]"), function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); abrir(true); });
  });
})();
