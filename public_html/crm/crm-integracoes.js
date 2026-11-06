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
  var st = { fontes: [], contas: [], erroTabela: false, dias: 30, meta: null, retorno: null };

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
    var ist = await A.sb.rpc("meta_conexoes_status"); st.conexoes = ist.data || [];
    st.meta = st.conexoes.filter(function (c) { return c.minha; })[0] || null;
    var ip = await A.sb.rpc("integracoes_status"); st.paginas = (ip.data && ip.data.meta) || null;
    await A.carregar();
  }


  function chip(k, t) { return '<span class="ig-chip ' + k + '">' + t + "</span>"; }
  var RET = window.location.hash.indexOf("meta=") >= 0 ? new URLSearchParams(window.location.hash.split("?")[1] || "") : null;
  if (RET) { try { history.replaceState(null, "", location.pathname + "#integracoes"); } catch (e) {} }
  function cartaoMeta(m, comMeta, mSync, A) {
    var con = st.meta, dt = function (v) { return v ? new Date(v).toLocaleDateString("pt-BR") : "—"; };
    var dias = con && con.expira_em ? Math.round((new Date(con.expira_em) - Date.now()) / 864e5) : null;
    var aviso = "";
    if (RET) {
      var r = RET.get("meta");
      aviso = r === "ok" ? '<p class="ig-ok">✓ Facebook conectado! ' + (+RET.get("paginas") ? RET.get("paginas") + " página(s) encontrada(s), " + RET.get("assinadas") + " recebendo leads dos formulários. " : "") + "Agora escolha os gerenciadores e as campanhas abaixo.</p>" :
        r === "cancelado" ? '<p class="ig-erro">Conexão cancelada no Facebook. Clique em “Conectar com Facebook” para tentar de novo.</p>' :
        '<p class="ig-erro">Não foi possível conectar: ' + A.esc(RET.get("motivo") || "erro") + "</p>";
    }
    var topo = '<div class="ig-top"><span class="ig-logo m">∞</span><div><h3>Meta Ads</h3><small>' + m.length + " conta(s) · " + comMeta + " lead(s) do Lead Ads</small></div>" + (con ? chip("on", "Conectado") : chip("off", "Não conectado")) + "</div>";
    var corpo;
    if (con) {
      var pg = st.paginas || {};
      corpo = '<div class="ig-meta-con"><b>Conectado como ' + A.esc(con.usuario_nome || "—") + "</b><span>" + con.contas.filter(function (c) { return c.ativo; }).length + " conta(s) de anúncio vinculada(s) · " + (pg.paginas ? pg.paginas + " página(s), " + pg.paginas_assinadas + " recebendo leads dos formulários" : "nenhuma página recebendo leads") + "</span>" +
        "<span>" + (con.status === "ativa" ? "Autorização válida até " + dt(con.expira_em) + (dias !== null && dias < 15 ? ' <b class="ig-erro">— reconecte em breve</b>' : "") : '<b class="ig-erro">' + A.esc(con.ultimo_erro || "Reconecte o Facebook") + "</b>") + "</span>" +
        (st.conexoes.length > 1 ? "<span>" + (st.conexoes.length - 1) + " cliente(s) também conectaram a própria conta (veja em Meus anúncios).</span>" : "") + "</div>" +
        '<label class="ig-dias">Período das métricas <select data-imp-dias><option value="30">30 dias</option><option value="90" selected>90 dias</option><option value="180">180 dias</option><option value="365">12 meses</option></select></label>' +
        '<div class="ig-acts"><button class="c-btn" data-seletor-meta>Escolher contas e campanhas</button><button class="c-btn ghost" data-sync-meta>Atualizar métricas</button><button class="c-btn ghost" data-ir="anuncios">Ver painel</button><button class="c-btn ghost" data-conectar-meta>Reconectar</button><button class="c-btn ghost danger" data-desconectar-meta>Desconectar</button></div>' +
        '<div class="ig-sel" data-sel hidden></div>';
    } else {
      corpo = '<div class="ig-meta-imp"><b>Conecte em 1 clique</b><span>Entre com o Facebook que administra o seu Gerenciador de Negócios e autorize. O CRM passa a puxar sozinho todas as contas de anúncio, e as métricas de todas as campanhas. (Leads dos formulários instantâneos: liberar depois o caso de uso de Páginas no app.)</span></div>' +
        '<div class="ig-acts"><button class="c-btn fb" data-conectar-meta>Conectar com Facebook</button></div>';
    }
    return '<section class="c-box ig-card m">' + topo + aviso + corpo + '<div class="ig-imp-res" data-imp-res></div>' +
      '<details class="ig-avancado"><summary>Configuração do app do Meta (feita uma única vez)</summary>' +
      "<ol><li>Em <b>developers.facebook.com → Meus apps</b>, abra o app do seu negócio (ou crie um, tipo <b>Empresa</b>).</li>" +
      "<li>Adicione o produto <b>Login do Facebook para Empresas</b> e, em <b>URIs de redirecionamento do OAuth válidos</b>, cole:<div class=\"ig-code\"><code>" + SUPA + "/functions/v1/meta-conectar</code><button type=\"button\" class=\"c-btn ghost\" data-copiar=\"" + SUPA + "/functions/v1/meta-conectar\">Copiar</button></div></li>" +
      "<li>Ainda no Login para Empresas → Configurações, deixe <b>Login no OAuth do cliente</b> e <b>Login do OAuth na Web</b> em <b>Sim</b>.</li><li>Em <b>Configurações → Básico</b>: domínios do app <b>danova-ai.com</b> e <b>oeylfwasqvbnybzrwtgf.supabase.co</b>, política de privacidade <b>https://danova-ai.com/politica-de-privacidade.html</b>. Mantenha o app <b>Não publicado</b> (desenvolvimento) até a Análise da Meta.</li>" +
      "<li>No Supabase (Edge Functions → Secrets), salve <b>META_APP_ID</b> (ID do app) e <b>META_APP_SECRET</b> (Chave secreta do app).</li></ol>" +
      '<small class="ig-lbl">Webhook de leads (o CRM configura sozinho ao conectar):</small><div class="ig-code"><code>' + META_WEBHOOK + '</code><button type="button" class="c-btn ghost" data-copiar="' + META_WEBHOOK + '">Copiar</button></div></details></section>';
  }


  function invocar(A, corpo) {
    return A.sb.functions.invoke("ads-sync", { body: corpo }).then(async function (r) {
      var e = r.data && r.data.erro; try { var j = r.error && r.error.context && await r.error.context.json(); if (j && j.erro) e = j.erro; } catch (x) {}
      if (r.error && !e) e = r.error.message || "falha";
      if (e) throw new Error(e === "meta_nao_configurado" ? "O Facebook não está conectado." : e);
      return r.data;
    });
  }
  var STATUS_CAMP = { active: ["Ativa", "on"], paused: ["Pausada", "off"], archived: ["Arquivada", "off"], deleted: ["Excluída", "off"], campaign_paused: ["Pausada", "off"], in_process: ["Em análise", "off"], with_issues: ["Com problema", "off"] };
  async function abrirSeletor(el, A) {
    var box = el.querySelector("[data-sel]"); if (!box || !st.meta) return;
    box.hidden = false; box.innerHTML = '<div data-contas-box></div><div data-camp-area></div>';
    var cbox = box.querySelector("[data-contas-box]");
    var mostrar = async function () {
      var ist = await A.sb.rpc("meta_conexoes_status"); st.conexoes = ist.data || []; st.meta = st.conexoes.filter(function (c) { return c.minha; })[0] || st.meta;
      mostrarCampanhas(box, A, (st.meta.contas || []).filter(function (c) { return c.ativo; }).map(function (c) { return { conta_crm: c.id, nome: c.nome, campanhas: 0 }; }));
    };
    D.meta.seletorContas(cbox, A, st.meta.id, async function () { cbox.hidden = false; cbox.innerHTML = '<p class="ig-ok">✓ Contas salvas. Agora, se quiser, escolha as campanhas de cada uma.</p>'; await carregar(A); await mostrar(); });
    await mostrar();
  }
  function mostrarCampanhas(box, A, contas) {
    var area = box.querySelector("[data-camp-area]"); if (!area) return;
    if (!contas.length) { area.innerHTML = ""; return; }
    area.innerHTML = '<h4>2. Quais campanhas acompanhar em cada gerenciador?</h4>' + contas.map(function (c) {
      return '<div class="ig-camp" data-conta="' + A.esc(c.conta_crm) + '"><div class="ig-camp-h"><b>' + A.esc(c.nome) + '</b><small>' + (c.campanhas ? c.campanhas + " campanha(s) escolhida(s)" : "todas as campanhas") + '</small><button class="c-btn ghost" data-abrir-camp>Escolher campanhas</button></div><div class="ig-camp-lista" hidden></div></div>';
    }).join("") + '<div class="ig-acts"><button class="c-btn" data-puxar>Puxar métricas agora</button></div>';
    area.querySelectorAll("[data-abrir-camp]").forEach(function (b) { b.addEventListener("click", async function () {
      var bloco = b.closest(".ig-camp"), lista = bloco.querySelector(".ig-camp-lista"), conta = bloco.dataset.conta;
      if (!lista.hidden) { lista.hidden = true; return; }
      lista.hidden = false; lista.innerHTML = '<p class="ig-carr">Buscando campanhas…</p>';
      try {
        var d = await invocar(A, { acao: "listar_campanhas", conta: conta });
        if (!d.campanhas.length) { lista.innerHTML = '<p class="ig-carr">Nenhuma campanha nesta conta.</p>'; return; }
        lista.innerHTML = '<label class="ig-sel-item todas"><input type="checkbox" data-todas' + (d.todas ? " checked" : "") + '><span><b>Todas as campanhas</b><small>inclusive as que forem criadas depois</small></span></label>' +
          '<div class="ig-filtro"><button type="button" class="c-btn ghost" data-marcar="ativas">Só as ativas</button><button type="button" class="c-btn ghost" data-marcar="nenhuma">Desmarcar</button></div>' +
          d.campanhas.map(function (k) { var st2 = STATUS_CAMP[k.status] || [k.status || "—", "off"]; return '<label class="ig-sel-item"><input type="checkbox" data-camp value="' + A.esc(k.id) + '" data-nome="' + A.esc(k.nome) + '" data-status="' + A.esc(k.status) + '"' + (k.selecionada ? " checked" : "") + '><span><b>' + A.esc(k.nome) + "</b><small>" + chip(st2[1], st2[0]) + (k.objetivo ? " " + A.esc(k.objetivo.replace(/^OUTCOME_/, "").toLowerCase()) : "") + "</small></span></label>"; }).join("") +
          '<div class="ig-acts"><button class="c-btn" data-salvar-camp>Salvar campanhas</button></div>';
        var todas = lista.querySelector("[data-todas]"), camps = lista.querySelectorAll("[data-camp]");
        var sync = function () { camps.forEach(function (i) { i.disabled = todas.checked; if (todas.checked) i.checked = true; }); };
        todas.addEventListener("change", sync); sync();
        lista.querySelectorAll("[data-marcar]").forEach(function (m) { m.addEventListener("click", function () { todas.checked = false; sync(); camps.forEach(function (i) { i.checked = m.dataset.marcar === "ativas" && i.dataset.status === "active"; }); }); });
        lista.querySelector("[data-salvar-camp]").addEventListener("click", async function () {
          var bs = this, escolhidas = todas.checked ? [] : Array.prototype.filter.call(camps, function (i) { return i.checked; }).map(function (i) { return { id: i.value, nome: i.dataset.nome }; });
          if (!todas.checked && !escolhidas.length) return A.toast("Marque pelo menos uma campanha (ou “Todas”).", true);
          bs.disabled = true; bs.textContent = "Salvando…";
          try { await invocar(A, { acao: "salvar_campanhas", conta: conta, campanhas: escolhidas }); bloco.querySelector(".ig-camp-h small").textContent = escolhidas.length ? escolhidas.length + " campanha(s) escolhida(s)" : "todas as campanhas"; lista.hidden = true; A.toast("Campanhas salvas."); }
          catch (x) { A.toast(x.message, true); }
          finally { bs.disabled = false; bs.textContent = "Salvar campanhas"; }
        });
      } catch (x) { lista.innerHTML = '<p class="ig-erro">' + A.esc(x.message) + "</p>"; }
    }); });
    area.querySelector("[data-puxar]").addEventListener("click", function () { sincronizarMeta(box.closest(".ig-card"), A, this); });
  }
  async function sincronizarMeta(card, A, b) {
    var res = card.querySelector("[data-imp-res]"), dias = +(card.querySelector("[data-imp-dias]") || {}).value || 90, t = b.textContent;
    b.disabled = true; b.textContent = "Puxando métricas…"; res.innerHTML = "";
    try {
      var d = await invocar(A, { dias: dias, plataforma: "meta" });
      var lista = d.resultado || [], ok = lista.filter(function (x) { return !x.erro; }), ruins = lista.filter(function (x) { return x.erro; });
      res.innerHTML = "<p>✓ Métricas de " + dias + " dias atualizadas em " + ok.length + " gerenciador(es) · " + ok.reduce(function (s, x) { return s + (x.linhas || 0); }, 0) + " linha(s) de campanha/dia" + (ruins.length ? ' · <span class="ig-erro">' + ruins.length + " com erro: " + A.esc(ruins[0].erro) + "</span>" : "") + ".</p>";
      A.toast("Métricas do Meta atualizadas.");
    } catch (x) { res.innerHTML = '<p class="ig-erro">' + A.esc(x.message === "sem_contas" ? "Nenhum gerenciador escolhido ainda. Clique em “Escolher gerenciadores e campanhas”." : x.message) + "</p>"; }
    finally { b.disabled = false; b.textContent = t; }
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
    // chip(): definido no escopo do módulo
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
      cartaoMeta(m, comMeta, mSync, A) +
      '<section class="c-box"><div class="c-h"><h3>Fontes do próprio site <small>já conectadas</small></h3></div><div class="ig-proprias">' +
        [["Formulário de contato", "home / contato"], ["Pedido de vídeo para anúncios", "video-anuncios"], ["Chat com IA (texto)", "chat-ia"], ["Agente de voz (ElevenLabs)", "atendente-voz"], ["Cadastro manual no CRM", "Cadastro manual"]].map(function (x) { var n = A.S.leads.filter(function (l) { return x[1].split(" / ").indexOf(l.origem) >= 0; }).length; return '<div><span class="ig-dot"></span><b>' + x[0] + "</b><small>" + n + " lead(s)</small></div>"; }).join("") + "</div></section>" +
      "</div>";

    // eventos
    el.querySelectorAll("[data-dias]").forEach(function (b) { b.addEventListener("click", function () { st.dias = +b.dataset.dias; render(el, A); }); });
    el.querySelectorAll("[data-copiar]").forEach(function (b) { b.addEventListener("click", function () { copiar(b.dataset.copiar, A); }); });
    el.querySelectorAll("[data-ir]").forEach(function (b) { b.addEventListener("click", function () { A.irPara(b.dataset.ir); }); });
    var bSel = el.querySelector("[data-seletor-meta]");
    if (bSel) bSel.addEventListener("click", function () { abrirSeletor(el, A); });
    var bSync = el.querySelector("[data-sync-meta]");
    if (bSync) bSync.addEventListener("click", function () { sincronizarMeta(el.querySelector(".ig-card.m"), A, bSync); });
    el.querySelectorAll("[data-conectar-meta]").forEach(function (b) { b.addEventListener("click", async function () {
      if (!D.meta) return A.toast("Recarregue a página (Ctrl+Shift+R).", true);
      b.disabled = true; var t = b.textContent; b.textContent = "Abrindo o Facebook…";
      try { var d = await D.meta.chamar(A, "meta-conectar", { acao: "iniciar" }); window.location.href = d.url; }
      catch (x) {
        b.disabled = false; b.textContent = t;
        var res = el.querySelector("[data-imp-res]");
        res.innerHTML = '<p class="ig-erro">' + (x.codigo === "app_nao_configurado" ? "Falta a configuração do app do Meta (feita uma única vez): abra “Configuração do app do Meta” logo abaixo e siga os 4 passos." : A.esc(D.meta.msgErro(x))) + "</p>";
        var det = el.querySelector(".ig-avancado"); if (det && x.codigo === "app_nao_configurado") det.open = true;
      }
    }); });
    var bDes = el.querySelector("[data-desconectar-meta]");
    if (bDes) bDes.addEventListener("click", async function () {
      if (!window.confirm("Desconectar o Facebook? O CRM para de puxar métricas e leads dos formulários até você conectar de novo.")) return;
      var r = await A.sb.functions.invoke("meta-conectar", { body: { acao: "desconectar", conexao: st.meta && st.meta.id } });
      if (r.error) return A.toast("Não foi possível desconectar agora.", true);
      A.toast("Facebook desconectado."); await carregar(A); render(el, A);
    });
    if (RET && RET.get("meta") === "ok" && !st.retornoFeito) { st.retornoFeito = true; abrirSeletor(el, A); }
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
