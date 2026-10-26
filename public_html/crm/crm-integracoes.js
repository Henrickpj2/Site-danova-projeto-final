/* danova AI — Integrações: de onde vêm os leads (Google Ads, Meta Ads, landing pages e formulários externos).
   Só administradores. Landing pages usam js/danova-captura.js; formulários externos usam a função captura-lead (webhook). */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];

  var SUPA = "https://oeylfwasqvbnybzrwtgf.supabase.co";
  var WEBHOOK = SUPA + "/functions/v1/captura-lead";
  var META_WEBHOOK = SUPA + "/functions/v1/meta-leads";
  var SCRIPT = "https://danova-ai.com/js/danova-captura.js";
  var PLAT = { elementor: "Elementor (WordPress)", wordpress: "WordPress (outros plugins)", rdstation: "RD Station", typeform: "Typeform", "google-forms": "Google Forms", hubspot: "HubSpot", webflow: "Webflow", outro: "Outro" };
  var COMO = {
    elementor: "No formulário do Elementor: <b>Ações após o envio</b> → adicione <b>Webhook</b> → cole a URL abaixo no campo <b>URL do webhook</b> → salve.",
    wordpress: "No plugin (Contact Form 7, WPForms, Gravity Forms…): ative a integração/add-on de <b>Webhook</b> e cole a URL abaixo, método POST.",
    rdstation: "RD Station Marketing: <b>Conexões → Integrações → Webhooks</b> → novo webhook com gatilho <b>Conversão</b> → cole a URL abaixo.",
    typeform: "No Typeform: <b>Connect → Webhooks</b> → <b>Add a webhook</b> → cole a URL abaixo → ative.",
    "google-forms": "No Google Forms: <b>⋮ → Editor de scripts</b>, cole o script abaixo, salve e crie o acionador <b>Ao enviar formulário</b>.",
    hubspot: "No HubSpot: crie um fluxo de trabalho com gatilho de envio do formulário → ação <b>Enviar webhook</b> (POST) → cole a URL abaixo.",
    webflow: "No Webflow: <b>Site settings → Integrations → Webhooks</b> → <b>Form submission</b> → cole a URL abaixo.",
    outro: "Na ferramenta, procure por <b>Webhook</b> ou <b>Integração por URL</b>, método <b>POST</b>, e cole a URL abaixo. Aceita JSON ou formulário."
  };
  var SITE = { home: "Site · formulário principal", contato: "Site · contato", leadForm: "Site · formulário principal", "video-anuncios": "Site · pedido de vídeo", videoForm: "Site · pedido de vídeo", "chat-ia": "Chat com IA", "atendente-voz": "Agente de voz", "Cadastro manual": "Cadastro manual no CRM", "meta-lead-ads": "Meta Lead Ads" };
  var st = { fontes: [], contas: [], erroTabela: false, dias: 30 };

  function slugify(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "fonte"; }
  function copiar(txt, A) { try { navigator.clipboard.writeText(txt).then(function () { A.toast("Copiado."); }); } catch (e) { A.toast("Selecione e copie manualmente."); } }
  function snippet(f) { return '<script src="' + SCRIPT + '" data-fonte="' + f.slug + '" defer></script>'; }
  function urlWebhook(f) { return WEBHOOK + "?fonte=" + encodeURIComponent(f.slug); }
  function appsScript(f) {
    return "function aoEnviar(e) {\n  var dados = {};\n  e.response.getItemResponses().forEach(function (r) { dados[r.getItem().getTitle()] = String(r.getResponse()); });\n  UrlFetchApp.fetch('" + urlWebhook(f) + "', { method: 'post', contentType: 'application/json', payload: JSON.stringify(dados), muteHttpExceptions: true });\n}";
  }

  // classifica a origem de cada lead
  function categoria(l, slugs) {
    var u = l.utm || {}, src = String(u.last_touch_source || u.first_touch_source || l.canal || "").toLowerCase(), med = String(u.last_touch_medium || u.first_touch_medium || "").toLowerCase();
    var f = slugs[l.origem];
    if (f) return { k: f.tipo === "landing" ? "landing" : "form", nome: f.nome };
    if (l.meta_lead_id || l.origem === "meta-lead-ads") return { k: "meta", nome: "Meta Lead Ads" };
    if (u.gclid || /google|youtube/.test(src) && /cpc|paid|ppc|ads/.test(med)) return { k: "google", nome: "Google Ads" };
    if (/face|insta|meta|fb|ig/.test(src)) return { k: "meta", nome: "Meta (anúncio ou perfil)" };
    if (/organic/.test(med) || /google|bing/.test(src)) return { k: "organico", nome: "Busca orgânica" };
    if (SITE[l.origem]) return { k: l.origem === "Cadastro manual" ? "manual" : "site", nome: SITE[l.origem] };
    return { k: "outro", nome: l.origem || "Sem origem" };
  }
  var CATS = { google: ["Google Ads", "#3ec5f0"], meta: ["Meta Ads", "#8b5cf6"], landing: ["Landing pages", "#f97316"], form: ["Formulários externos", "#ec4899"], site: ["Site e atendimento IA", "#16b8a6"], organico: ["Busca orgânica", "#84cc16"], manual: ["Cadastro manual", "#94a3b8"], outro: ["Outros", "#64748b"] };

  async function carregar(A) {
    var r = await A.sb.from("fontes_lead").select("*").order("criado_em", { ascending: false });
    st.erroTabela = !!r.error; st.fontes = r.data || [];
    var c = await A.sb.from("contas_anuncio").select("id, plataforma, nome, conta_externa, estimados, ultima_sync, ultimo_erro, codigo").eq("ativo", true).order("codigo");
    st.contas = c.data || [];
    await A.carregar();
  }

  function render(el, A) {
    var slugs = {}; st.fontes.forEach(function (f) { slugs[f.slug] = f; });
    var desde = st.dias ? Date.now() - st.dias * 864e5 : 0;
    var L = A.S.leads.filter(function (l) { return !desde || new Date(l.criado_em).getTime() >= desde; });
    var porCat = {}, porFonte = {};
    L.forEach(function (l) { var c = categoria(l, slugs); porCat[c.k] = (porCat[c.k] || 0) + 1; var k = c.k + "|" + c.nome; porFonte[k] = (porFonte[k] || 0) + 1; });
    A.S.leads.forEach(function (l) { var f = slugs[l.origem]; if (f) { f._n = (f._n || 0) + 1; if (!f._ult || l.criado_em > f._ult) f._ult = l.criado_em; } });
    var total = L.length || 0, mx = Math.max.apply(null, Object.keys(CATS).map(function (k) { return porCat[k] || 0; }).concat([1]));
    var g = st.contas.filter(function (c) { return c.plataforma === "google"; }), m = st.contas.filter(function (c) { return c.plataforma === "meta"; });
    var real = function (c) { return c.conta_externa && (c.estimados || []).indexOf("conta_externa") < 0; };
    var gReal = g.filter(real).length, gSync = g.filter(function (c) { return c.ultima_sync; }).length, mSync = m.filter(function (c) { return c.ultima_sync; }).length;
    var comGclid = A.S.leads.filter(function (l) { return l.utm && l.utm.gclid; }).length, comMeta = A.S.leads.filter(function (l) { return l.meta_lead_id; }).length;
    var chip = function (k, t) { return '<span class="ig-chip ' + k + '">' + t + "</span>"; };
    var lands = st.fontes.filter(function (f) { return f.tipo === "landing"; }), forms = st.fontes.filter(function (f) { return f.tipo === "formulario"; });
    var opcContas = '<option value="">Cliente (opcional)</option>' + st.contas.map(function (c) { return '<option value="' + c.id + '">' + A.esc((c.codigo ? c.codigo + " · " : "") + (c.nome || "")) + "</option>"; }).join("");
    var nomeConta = function (id) { var c = st.contas.find(function (x) { return x.id === id; }); return c ? c.nome : ""; };
    var fonteCard = function (f) {
      var ult = f._ult ? "último " + A.dt(f._ult, true) : "nenhum lead ainda";
      var codigo = f.tipo === "landing" ? snippet(f) : urlWebhook(f);
      return '<div class="ig-fonte' + (f.ativo ? "" : " off") + '"><div class="ig-fh"><b>' + A.esc(f.nome) + "</b>" + (f.plataforma ? chip("", PLAT[f.plataforma] || f.plataforma) : "") + (nomeConta(f.conta_anuncio_id) ? chip("", A.esc(nomeConta(f.conta_anuncio_id))) : "") + '<span class="ig-n">' + (f._n || 0) + " lead(s) · " + ult + "</span></div>" +
        (f.url ? '<a class="ig-url" href="' + A.esc(f.url) + '" target="_blank" rel="noopener">' + A.esc(f.url) + "</a>" : "") +
        '<small class="ig-lbl">' + (f.tipo === "landing" ? "Cole antes de &lt;/body&gt; na landing page:" : "URL do webhook:") + '</small><div class="ig-code"><code>' + A.esc(codigo) + '</code><button type="button" class="c-btn ghost" data-copiar="' + A.esc(codigo) + '">Copiar</button></div>' +
        (f.tipo === "formulario" ? '<p class="ig-como">' + (COMO[f.plataforma] || COMO.outro) + "</p>" + (f.plataforma === "google-forms" ? '<div class="ig-code"><code class="pre">' + A.esc(appsScript(f)) + '</code><button type="button" class="c-btn ghost" data-copiar="' + A.esc(appsScript(f)) + '">Copiar script</button></div>' : "") : "") +
        '<div class="ig-acts"><label class="switch" title="Ativa/desativa"><input type="checkbox" data-ativo="' + f.id + '"' + (f.ativo ? " checked" : "") + "><span></span></label><span>" + (f.ativo ? "Ativa" : "Pausada") + '</span><span class="spacer"></span><span class="ig-slug">código: ' + A.esc(f.slug) + '</span><button type="button" class="c-x" data-rm="' + f.id + '" title="Excluir">×</button></div></div>';
    };
    var semTabela = st.erroTabela ? '<div class="ig-aviso">O cadastro de landing pages e formulários precisa de uma atualização no banco (aguardando aprovação). O código e as URLs abaixo já funcionam — use um código próprio na URL, ex.: <code>?fonte=lp-meu-cliente</code>.</div>' : "";

    el.innerHTML = '<div class="cads ig">' +
      '<section class="c-box"><div class="c-h"><h3>De onde vêm os leads</h3><div class="c-seg sm">' + [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [0, "Tudo"]].map(function (d) { return '<button data-dias="' + d[0] + '"' + (st.dias === d[0] ? ' class="on"' : "") + ">" + d[1] + "</button>"; }).join("") + '</div></div>' +
      (total ? '<div class="ig-barras">' + Object.keys(CATS).filter(function (k) { return porCat[k]; }).sort(function (a, b) { return porCat[b] - porCat[a]; }).map(function (k) {
        return '<div class="ig-bar"><span>' + CATS[k][0] + '</span><div class="ig-trilho"><i style="width:' + (porCat[k] / mx * 100).toFixed(1) + "%;background:" + CATS[k][1] + '"></i></div><b>' + porCat[k] + '</b><em>' + Math.round(porCat[k] / total * 100) + "%</em></div>";
      }).join("") + '</div><details class="ig-det"><summary>Ver por fonte (' + Object.keys(porFonte).length + ")</summary><ul>" + Object.keys(porFonte).sort(function (a, b) { return porFonte[b] - porFonte[a]; }).map(function (k) { var p = k.split("|"); return '<li><i style="background:' + (CATS[p[0]] || CATS.outro)[1] + '"></i>' + A.esc(p[1]) + "<b>" + porFonte[k] + "</b></li>"; }).join("") + "</ul></details>"
        : '<div class="c-vazio">Nenhum lead no período. Assim que chegarem, aparecem aqui separados por origem.</div>') + "</section>" +

      '<div class="ig-grid">' +
      '<section class="c-box ig-card g"><div class="ig-top"><span class="ig-logo g">G</span><div><h3>Google Ads</h3><small>' + g.length + " conta(s) cadastrada(s) · " + gReal + " com ID real</small></div>" + (gSync ? chip("on", "Sincronizando") : gReal ? chip("warn", "Falta credencial da API") : chip("off", "Aguardando IDs reais")) + "</div>" +
        '<ul class="ck"><li><b>Leads de anúncios:</b> o site guarda o identificador do clique (GCLID) em cada lead — ' + comGclid + " lead(s) com GCLID.</li><li><b>Métricas das campanhas:</b> com o ID real da conta e as credenciais da API, o sistema puxa investimento, cliques e conversões.</li><li><b>Conversões offline:</b> qualificado, visita, proposta e venda voltam para o Google Ads otimizar os lances.</li></ul>" +
        '<div class="ig-acts"><button class="c-btn" data-ir="campanhas">Abrir Campanhas e contas</button></div></section>' +
      '<section class="c-box ig-card m"><div class="ig-top"><span class="ig-logo m">∞</span><div><h3>Meta Ads</h3><small>' + m.length + " conta(s) · " + comMeta + " lead(s) do Lead Ads</small></div>" + (mSync || comMeta ? chip("on", "Recebendo") : chip("off", "Não conectado")) + "</div>" +
        '<ul class="ck"><li><b>Formulários instantâneos (Lead Ads):</b> cada lead entra sozinho no CRM com campanha e anúncio.</li><li><b>Métricas:</b> com o token de usuário do sistema (ads_read), o sistema puxa investimento e resultados.</li><li><b>API de Conversões:</b> as etapas do funil voltam para o Meta.</li></ul>' +
        '<small class="ig-lbl">URL de retorno (webhook) para o app do Meta — objeto Page, campo leadgen:</small><div class="ig-code"><code>' + META_WEBHOOK + '</code><button type="button" class="c-btn ghost" data-copiar="' + META_WEBHOOK + '">Copiar</button></div>' +
        '<div class="ig-acts"><button class="c-btn" data-ir="campanhas">Contas de anúncio</button></div></section>' +
      "</div>" +

      '<section class="c-box"><div class="c-h"><h3>Landing pages <small>páginas de captura dos clientes</small></h3></div>' + semTabela +
        '<p class="ig-como">Cadastre a página e cole o código gerado nela (WordPress, Elementor, Webflow, Wix, HTML…). Todo formulário da página passa a enviar o lead ao CRM com a origem da campanha (UTM, GCLID, FBCLID), sem mexer no formulário que já existe.</p>' +
        '<form class="ig-nova" data-nova="landing"><input name="nome" placeholder="Nome da landing page (ex.: Jumil · Colheitadeira)" required maxlength="120"><input name="url" type="url" placeholder="https://… (endereço da página)"><select name="conta">' + opcContas + '</select><button class="c-btn">+ Gerar código</button></form>' +
        '<div class="ig-lista">' + (lands.map(fonteCard).join("") || '<p class="c-sub">Nenhuma landing page cadastrada.</p>') + "</div></section>" +

      '<section class="c-box"><div class="c-h"><h3>Formulários externos <small>Elementor, RD Station, Typeform, Google Forms…</small></h3></div>' + semTabela +
        '<p class="ig-como">Para formulários de outras ferramentas: cadastre e cole a URL de webhook na ferramenta. O sistema reconhece sozinho nome, e-mail, telefone e mensagem.</p>' +
        '<form class="ig-nova" data-nova="formulario"><input name="nome" placeholder="Nome do formulário (ex.: Coplana · Orçamento)" required maxlength="120"><select name="plataforma">' + Object.keys(PLAT).map(function (k) { return '<option value="' + k + '">' + PLAT[k] + "</option>"; }).join("") + '</select><select name="conta">' + opcContas + '</select><button class="c-btn">+ Gerar webhook</button></form>' +
        '<div class="ig-lista">' + (forms.map(fonteCard).join("") || '<p class="c-sub">Nenhum formulário externo cadastrado.</p>') + "</div></section>" +

      '<section class="c-box"><div class="c-h"><h3>Fontes do próprio site <small>já conectadas</small></h3></div><div class="ig-proprias">' +
        [["Formulário de contato", "home / contato"], ["Pedido de vídeo para anúncios", "video-anuncios"], ["Chat com IA (texto)", "chat-ia"], ["Agente de voz (ElevenLabs)", "atendente-voz"], ["Cadastro manual no CRM", "Cadastro manual"]].map(function (x) { var n = A.S.leads.filter(function (l) { return x[1].split(" / ").indexOf(l.origem) >= 0; }).length; return '<div><span class="ig-dot"></span><b>' + x[0] + "</b><small>" + n + " lead(s)</small></div>"; }).join("") + "</div></section>" +
      "</div>";

    // eventos
    el.querySelectorAll("[data-dias]").forEach(function (b) { b.addEventListener("click", function () { st.dias = +b.dataset.dias; render(el, A); }); });
    el.querySelectorAll("[data-copiar]").forEach(function (b) { b.addEventListener("click", function () { copiar(b.dataset.copiar, A); }); });
    el.querySelectorAll("[data-ir]").forEach(function (b) { b.addEventListener("click", function () { A.irPara(b.dataset.ir); }); });
    el.querySelectorAll("[data-nova]").forEach(function (f) { f.addEventListener("submit", async function (e) {
      e.preventDefault(); var fd = new FormData(f), nome = String(fd.get("nome") || "").trim(); if (!nome) return;
      var conta = st.contas.find(function (c) { return c.id === fd.get("conta"); });
      var base = slugify((f.dataset.nova === "landing" ? "lp-" : "form-") + nome), slug = base, i = 2;
      while (st.fontes.some(function (x) { return x.slug === slug; })) slug = base.slice(0, 46) + "-" + i++;
      if (slug.length < 3) slug = slug + "-01";
      var r = await A.sb.from("fontes_lead").insert({ tipo: f.dataset.nova, nome: nome, slug: slug, url: fd.get("url") || null, plataforma: fd.get("plataforma") || null, conta_anuncio_id: conta ? conta.id : null });
      if (r.error) { A.toast(/fontes_lead/.test(r.error.message) ? "O cadastro aguarda a atualização do banco. Use a URL com ?fonte=" + slug : r.error.message, true); return; }
      A.toast(f.dataset.nova === "landing" ? "Landing page cadastrada. Copie o código e cole na página." : "Formulário cadastrado. Copie a URL do webhook.");
      await carregar(A); render(el, A);
    }); });
    el.querySelectorAll("[data-ativo]").forEach(function (i) { i.addEventListener("change", async function () { var r = await A.sb.from("fontes_lead").update({ ativo: i.checked }).eq("id", i.dataset.ativo); if (r.error) return A.falha(r.error); await carregar(A); render(el, A); }); });
    el.querySelectorAll("[data-rm]").forEach(function (b) { b.addEventListener("click", async function () {
      var f = st.fontes.find(function (x) { return x.id === b.dataset.rm; }); if (!f || !window.confirm('Excluir "' + f.nome + '"? Os leads que já chegaram continuam no CRM.')) return;
      var r = await A.sb.from("fontes_lead").delete().eq("id", f.id); if (r.error) return A.falha(r.error); await carregar(A); render(el, A);
    }); });
  }

  D.modulos.push({
    id: "integracoes", titulo: "Integrações", tituloLongo: "Integrações · origem dos leads", icone: "⛓", papeis: ["admin"],
    render: async function (el, A) { el.innerHTML = '<div class="empty">Carregando integrações…</div>'; await carregar(A); render(el, A); }
  });
})();
