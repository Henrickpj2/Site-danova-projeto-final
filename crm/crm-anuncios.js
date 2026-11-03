/* danova AI CRM — "Meus anúncios": cada cliente conecta a própria conta Meta Ads (OAuth oficial), escolhe as contas
   de anúncio e vê o painel de desempenho: investimento, CPM, impressões, alcance, frequência, cliques, CTR, CPC,
   resultados e custo por resultado, por campanha, conjunto e anúncio, com comparação com o período anterior.
   O admin vê todos os clientes. Tokens ficam só no servidor (funções meta-conectar e ads-sync). */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {}; D.modulos = D.modulos || [];
  var CHART = "../js/vendor/chart-4.4.1.umd.min.js"; // Chart.js 4.4.1 servido pelo próprio site
  var st = { dias: 30, conta: "", campanha: "", aba: "campanha", cliente: "", grafico: null };
  var RET = window.location.hash.indexOf("anuncios?") >= 0 && window.location.hash.indexOf("meta=") >= 0 ? new URLSearchParams(window.location.hash.split("?")[1] || "") : null;
  if (RET) { try { history.replaceState(null, "", location.pathname + "#anuncios"); } catch (e) {} }

  // ---------- utilidades ----------
  function n(v) { return Number(v) || 0; }
  function fmtN(v, d) { return n(v).toLocaleString("pt-BR", { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); }
  function fmtM(v, moeda) { if (!isFinite(v)) return "—"; return n(v).toLocaleString("pt-BR", { style: "currency", currency: moeda === "USD" ? "USD" : "BRL", maximumFractionDigits: 2 }); }
  function pct(v) { return isFinite(v) ? fmtN(v * 100, 2) + "%" : "—"; }
  function div(a, b) { return b ? a / b : NaN; }
  function isoDia(d) { var z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); }
  function carregarChart() {
    if (window.Chart) return Promise.resolve();
    return new Promise(function (ok, erro) { var s = document.createElement("script"); s.src = CHART; s.onload = ok; s.onerror = erro; document.head.appendChild(s); });
  }
  async function chamar(A, fn, corpo) {
    var r = await A.sb.functions.invoke(fn, { body: corpo });
    var e = r.data && r.data.erro, det = r.data && r.data.detalhe;
    try { var j = r.error && r.error.context && await r.error.context.json(); if (j) { e = j.erro || e; det = j.detalhe || det; } } catch (x) {}
    if (r.error && !e) e = r.error.message || "falha";
    if (e) { var err = new Error(det || e); err.codigo = e; throw err; }
    return r.data;
  }
  var ERROS = {
    app_nao_configurado: "A conexão com o Meta ainda não foi ativada pela equipe danova AI.",
    sem_conta_vinculada: "Seu login ainda não está ligado a uma empresa. Fale com a equipe danova AI.",
    sem_acesso: "Seu perfil não tem acesso a esta função.", nao_autenticado: "Sua sessão expirou. Entre de novo.",
    conexao_nao_encontrada: "Conexão não encontrada. Conecte de novo.", sem_contas: "Nenhuma conta de anúncio vinculada ainda."
  };
  function msgErro(x) { return ERROS[x.codigo] || x.message || "Não foi possível concluir agora."; }

  // ---------- conexão e escolha de contas (usado aqui e na tela Integrações) ----------
  async function conectar(A, botao) {
    var t = botao.textContent; botao.disabled = true; botao.textContent = "Abrindo o Facebook…";
    try { var d = await chamar(A, "meta-conectar", { acao: "iniciar" }); window.location.href = d.url; }
    catch (x) { botao.disabled = false; botao.textContent = t; A.toast(msgErro(x), true); }
  }
  async function seletorContas(box, A, conexao, aoSalvar) {
    box.hidden = false; box.innerHTML = '<p class="an-carr">Buscando as contas de anúncio deste Facebook…</p>';
    var clientes = [];
    if (A.isAdmin()) clientes = (await A.sb.from("contas").select("id, nome").order("nome")).data || [];
    try {
      var d = await chamar(A, "meta-conectar", { acao: "listar_contas", conexao: conexao });
      if (!d.contas.length) { box.innerHTML = '<p class="an-erro">Este Facebook não tem acesso a nenhuma conta de anúncios. Entre com o perfil que administra o Gerenciador de Anúncios.</p>'; return; }
      box.innerHTML = '<h4>Quais contas de anúncio entram no painel?</h4><div class="an-sel">' + d.contas.map(function (c) {
        var bloq = c.de_outro_cliente;
        return '<label class="an-sel-item' + (bloq ? " bloq" : "") + '"><input type="checkbox" value="' + A.esc(c.id) + '"' + (c.vinculada ? " checked" : "") + (bloq ? " disabled" : "") + '><span><b>' + A.esc(c.nome) + "</b><small>" +
          (c.empresa ? A.esc(c.empresa) + " · " : "") + "ID " + A.esc(c.id) + " · " + A.esc(c.moeda || "") + " · " + A.esc(c.status) + (bloq ? " · já vinculada a outro cliente" : "") + "</small></span></label>";
      }).join("") + "</div>" +
        (A.isAdmin() ? '<label class="an-cli">Cliente das contas marcadas <select data-cli><option value="__manter">Manter como está</option><option value="">Agência (sem cliente)</option>' + clientes.map(function (c) { return '<option value="' + c.id + '">' + A.esc(c.nome) + "</option>"; }).join("") + "</select></label>" : "") +
        '<div class="an-acts"><button class="btn primary" data-salvar>Salvar contas</button><button class="btn ghost" data-fechar>Fechar</button></div>';
      box.querySelector("[data-fechar]").addEventListener("click", function () { box.hidden = true; box.innerHTML = ""; });
      box.querySelector("[data-salvar]").addEventListener("click", async function () {
        var b = this, ids = Array.prototype.map.call(box.querySelectorAll(".an-sel input:checked:not(:disabled)"), function (i) { return i.value; });
        var corpo = { acao: "vincular", conexao: conexao, ids: ids }, cli = box.querySelector("[data-cli]");
        if (cli && cli.value !== "__manter") corpo.cliente = cli.value || null;
        b.disabled = true; b.textContent = "Salvando…";
        try {
          var r = await chamar(A, "meta-conectar", corpo);
          A.toast(r.vinculadas + " conta(s) vinculada(s)." + (r.recusadas ? " " + r.recusadas + " já pertence(m) a outro cliente." : ""));
          box.hidden = true; box.innerHTML = ""; if (aoSalvar) aoSalvar(r);
        } catch (x) { A.toast(msgErro(x), true); b.disabled = false; b.textContent = "Salvar contas"; }
      });
    } catch (x) { box.innerHTML = '<p class="an-erro">' + A.esc(msgErro(x)) + "</p>"; }
  }
  D.meta = { conectar: conectar, seletorContas: seletorContas, chamar: chamar, msgErro: msgErro };

  // ---------- agregação ----------
  function somar(linhas) {
    var t = { custo: 0, impressoes: 0, alcance: 0, cliques: 0, cliques_link: 0, leads: 0, resultados: 0, valor: 0 };
    linhas.forEach(function (l) { t.custo += n(l.custo); t.impressoes += n(l.impressoes); t.alcance += n(l.alcance); t.cliques += n(l.cliques); t.cliques_link += n(l.cliques_link); t.leads += n(l.leads); t.resultados += n(l.resultados); t.valor += n(l.valor_conversoes); });
    t.cpm = div(t.custo, t.impressoes) * 1000; t.ctr = div(t.cliques, t.impressoes); t.cpc = div(t.custo, t.cliques);
    t.freq = div(t.impressoes, t.alcance); t.cpr = div(t.custo, t.resultados);
    return t;
  }
  function variacao(atual, antes, inverso, neutro) {
    if (!isFinite(atual) || !isFinite(antes) || !antes) return "";
    var v = (atual - antes) / antes, bom = inverso ? v < 0 : v > 0;
    if (Math.abs(v) < 0.0005) return ' <em class="an-var">= 0%</em>';
    return ' <em class="an-var ' + (neutro || Math.abs(v) < 0.005 ? "" : bom ? "bom" : "ruim") + '">' + (v > 0 ? "▲ " : "▼ ") + fmtN(Math.abs(v) * 100, 1) + "%</em>";
  }
  function agrupar(linhas, chave, nome) {
    var g = {};
    linhas.forEach(function (l) { var k = l[chave] || "—"; (g[k] = g[k] || { nome: l[nome] || "Sem nome", campanha: l.campanha, conjunto: l.conjunto, linhas: [] }).linhas.push(l); });
    return Object.keys(g).map(function (k) { var x = g[k]; var s = somar(x.linhas); s.nome = x.nome; s.campanha = x.campanha; s.conjunto = x.conjunto; return s; }).sort(function (a, b) { return b.custo - a.custo; });
  }

  // ---------- tela ----------
  async function render(el, A) {
    el.innerHTML = '<div class="empty">Carregando seus anúncios…</div>';
    var admin = A.isAdmin(), papel = A.S.me.papel;
    var cx = (await A.sb.rpc("meta_conexoes_status")).data || [];
    var minha = cx.filter(function (c) { return c.minha; })[0] || null;
    var qc = A.sb.from("contas_anuncio").select("id, nome, conta_externa, moeda, conta_id, conexao_id, ultima_sync, ultimo_erro, ativo, fonte_dados, situacao").eq("plataforma", "meta").eq("ativo", true).order("nome");
    var contas = (await qc).data || [];
    var clientes = admin ? ((await A.sb.from("contas").select("id, nome").order("nome")).data || []) : [];
    if (admin && st.cliente) contas = contas.filter(function (c) { return st.cliente === "__agencia" ? !c.conta_id : c.conta_id === st.cliente; });
    if (st.conta && !contas.some(function (c) { return c.id === st.conta; })) st.conta = "";
    var ativas = st.conta ? contas.filter(function (c) { return c.id === st.conta; }) : contas;
    var ids = ativas.map(function (c) { return String(c.conta_externa || "").replace(/\D/g, ""); });
    var moeda = (ativas[0] && ativas[0].moeda) || "BRL";
    var misto = ativas.some(function (c) { return (c.moeda || "BRL") !== moeda; });

    // período atual e anterior
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var fim = new Date(hoje.getTime() - 864e5), ini = new Date(fim.getTime() - (st.dias - 1) * 864e5);
    var fimAnt = new Date(ini.getTime() - 864e5), iniAnt = new Date(fimAnt.getTime() - (st.dias - 1) * 864e5);
    var linhas = [], antes = [], camps = [];
    if (ids.length) {
      var r = await A.sb.from("meta_insights").select("data, conta_anuncio, campanha_id, campanha, conjunto_id, conjunto, anuncio_id, anuncio, impressoes, alcance, cliques, cliques_link, custo, leads, resultados, valor_conversoes")
        .in("conta_anuncio", ids).gte("data", isoDia(iniAnt)).lte("data", isoDia(fim)).limit(20000);
      var todas = r.data || [];
      var camposVistos = {};
      todas.forEach(function (l) { if (!camposVistos[l.campanha_id]) { camposVistos[l.campanha_id] = 1; camps.push({ id: l.campanha_id, nome: l.campanha }); } });
      camps.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
      if (st.campanha && !camposVistos[st.campanha]) st.campanha = "";
      todas = todas.filter(function (l) { return !st.campanha || l.campanha_id === st.campanha; });
      linhas = todas.filter(function (l) { return l.data >= isoDia(ini); });
      antes = todas.filter(function (l) { return l.data < isoDia(ini); });
    }
    var T = somar(linhas), P = somar(antes);
    var ultima = ativas.map(function (c) { return c.ultima_sync; }).filter(Boolean).sort().pop();
    var erros = ativas.filter(function (c) { return c.ultimo_erro; });

    // --- módulo de conexão: ID da conta de anúncios + integrador autorizado (Make); login do Facebook como opção avançada
    var podeConectar = admin || (papel === "construtora" && A.S.me.conta_id);
    var aviso = "";
    if (RET) {
      var rr = RET.get("meta");
      aviso = rr === "ok" ? '<p class="an-ok">✓ Facebook conectado. Escolha abaixo as contas de anúncio que entram no painel.</p>' :
        rr === "cancelado" ? '<p class="an-erro">Conexão cancelada no Facebook.</p>' : '<p class="an-erro">Não foi possível conectar: ' + A.esc(RET.get("motivo") || "erro") + "</p>";
    }
    var BM = (window.DANOVA_CRM && window.DANOVA_CRM.metaBusinessId) || "";
    var SIT = { aguardando: ["Aguardando autorização", "an-p-esp"], conectada: ["Conectada", "an-p-ok"], erro: ["Sem acesso", "an-p-erro"] };
    var dias = minha && minha.expira_em ? Math.round((new Date(minha.expira_em) - Date.now()) / 864e5) : null;
    var listaContas = contas.length ? '<div class="an-lista">' + contas.map(function (c) {
      var sit = c.fonte_dados === "oauth" ? ["Conectada (login Facebook)", "an-p-ok"] : (SIT[c.situacao] || SIT.aguardando);
      return '<div class="an-conta"><div><b>' + A.esc(c.nome) + '</b><small>act_' + A.esc(String(c.conta_externa || "").replace(/\D/g, "")) + (c.ultima_sync ? " · atualizada em " + new Date(c.ultima_sync).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "") + "</small>" +
        (c.situacao === "erro" && c.ultimo_erro ? '<small class="an-txt-erro">' + A.esc(c.ultimo_erro) + "</small>" : "") + '</div><span class="pill ' + sit[1] + '">' + sit[0] + "</span>" +
        (c.fonte_dados !== "oauth" ? '<button class="btn ghost small" data-buscar="' + c.id + '">Buscar agora</button>' : "") + '<button class="btn ghost small an-perigo" data-remover="' + c.id + '">Remover</button></div>';
    }).join("") + "</div>" : "";
    var aguardando = contas.some(function (c) { return c.fonte_dados !== "oauth" && c.situacao !== "conectada"; });
    var conexaoHtml = '<div class="card an-con">' + aviso +
      '<div class="an-mod-h"><span class="an-fb">f</span><div><h3>Integração Meta Ads</h3><small>Módulo de conexão</small></div></div>' +
      (podeConectar ? '<form class="an-form" data-form-act><label>ID da conta de anúncios<input name="act" placeholder="act_000000000000000" autocomplete="off" inputmode="numeric" required></label>' +
        (admin ? '<label>Cliente<select name="cliente"><option value="">Agência (sem cliente)</option>' + clientes.map(function (c) { return '<option value="' + c.id + '"' + (st.cliente === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select></label>" : "") +
        '<button class="btn primary an-btn-fb" type="submit">Conectar conta Meta</button></form>' +
        '<p class="an-dica">O ID fica no Gerenciador de Anúncios, no seletor de contas (o número depois de <b>act_</b>).</p>'
        : '<p class="an-erro">Seu login ainda não está ligado a uma empresa. Fale com a equipe danova AI.</p>') +
      listaContas +
      (aguardando ? '<div class="an-autoriza"><b>Falta autorizar o acesso</b><p>Só o número da conta não libera os dados: o dono da conta precisa dar acesso de leitura à danova AI.</p><ol>' +
        '<li>Abra <b>business.facebook.com → Configurações do negócio → Contas → Contas de anúncios</b> e selecione a conta.</li>' +
        '<li>Clique em <b>Atribuir parceiros</b> (ou “Adicionar pessoas/parceiros”) e informe o ID do negócio da danova AI: <b>' + (BM ? A.esc(BM) : "peça à equipe danova AI") + "</b>.</li>" +
        "<li>Marque a permissão <b>Ver desempenho</b> (somente leitura) e confirme.</li><li>Volte aqui e clique em <b>Buscar agora</b>.</li></ol></div>" : "") +
      '<div class="an-dados"><b>Dados que serão importados</b><ul>' + ["Campanhas ativas e pausadas", "Investimento total", "Gastos por campanha", "Impressões e alcance", "Cliques e CTR", "CPC e CPM", "Leads e custo por lead", "Resultados por período"].map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>" +
      '<details class="an-avancado"' + (minha ? " open" : "") + '><summary>Conectar pelo login do Facebook (opção avançada)</summary>' + (minha ?
        '<p class="an-dica">Conectado como <b>' + A.esc(minha.usuario_nome || "—") + "</b> · " + (minha.status === "ativa" ? (dias !== null ? "válido até " + new Date(minha.expira_em).toLocaleDateString("pt-BR") + (dias < 15 ? ' — <b class="an-txt-erro">reconecte em breve</b>' : "") : "ativo") : '<b class="an-txt-erro">' + A.esc(minha.ultimo_erro || "reconecte") + "</b>") + "</p>" +
        '<div class="an-acts"><button class="btn ghost" data-escolher>Escolher contas</button><button class="btn ghost" data-conectar>Reconectar</button><button class="btn ghost an-perigo" data-desconectar>Desconectar</button></div>'
        : '<p class="an-dica">Alternativa para quem prefere autorizar com o próprio Facebook (exige o app Meta da danova configurado).</p><div class="an-acts"><button class="btn ghost" data-conectar>Conectar com Facebook</button></div>') +
      '</details><div class="an-selbox" data-selbox hidden></div></div>';

    // --- filtros
    var filtros = '<div class="filters an-filtros">' +
      (admin ? '<label>Cliente <select data-f="cliente"><option value="">Todos</option><option value="__agencia"' + (st.cliente === "__agencia" ? " selected" : "") + '>Agência (sem cliente)</option>' + clientes.map(function (c) { return '<option value="' + c.id + '"' + (st.cliente === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select></label>" : "") +
      (contas.length > 1 ? '<label>Conta <select data-f="conta"><option value="">Todas (' + contas.length + ')</option>' + contas.map(function (c) { return '<option value="' + c.id + '"' + (st.conta === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select></label>" : "") +
      '<label>Período <select data-f="dias">' + [[7, "Últimos 7 dias"], [14, "Últimos 14 dias"], [30, "Últimos 30 dias"], [60, "Últimos 60 dias"], [90, "Últimos 90 dias"]].map(function (p) { return '<option value="' + p[0] + '"' + (st.dias === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select></label>" +
      '<label>Campanha <select data-f="campanha"><option value="">Todas</option>' + camps.map(function (c) { return '<option value="' + A.esc(c.id) + '"' + (st.campanha === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select></label>" +
      '<span class="spacer"></span><small class="an-sync">' + (ultima ? "Atualizado em " + new Date(ultima).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não sincronizado") + '</small><button class="btn ghost" data-atualizar' + (ativas.length ? "" : " disabled") + ">Atualizar agora</button></div>";

    var kpis = '<div class="kpis an-kpis">' + [
      ["Investimento", fmtM(T.custo, moeda) + variacao(T.custo, P.custo, false, true)],
      ["Resultados", fmtN(T.resultados) + variacao(T.resultados, P.resultados), T.leads ? fmtN(T.leads) + " lead(s)" : "leads e conversões"],
      ["Custo por resultado", fmtM(T.cpr, moeda) + variacao(T.cpr, P.cpr, true)],
      ["Impressões", fmtN(T.impressoes) + variacao(T.impressoes, P.impressoes)],
      ["Alcance", fmtN(T.alcance) + variacao(T.alcance, P.alcance), "soma diária"],
      ["Frequência", fmtN(T.freq, 2) + variacao(T.freq, P.freq, true), "impressões ÷ alcance"],
      ["CPM", fmtM(T.cpm, moeda) + variacao(T.cpm, P.cpm, true), "custo por mil impressões"],
      ["Cliques", fmtN(T.cliques) + variacao(T.cliques, P.cliques), fmtN(T.cliques_link) + " no link"],
      ["CTR", pct(T.ctr) + variacao(T.ctr, P.ctr)],
      ["CPC", fmtM(T.cpc, moeda) + variacao(T.cpc, P.cpc, true)]
    ].map(function (k) { return '<div class="kpi"><small>' + k[0] + "</small><strong>" + k[1] + "</strong><span>" + (k[2] || "vs. " + st.dias + " dias anteriores") + "</span></div>"; }).join("") + "</div>";

    var nivel = { campanha: ["campanha_id", "campanha", "Campanha"], conjunto: ["conjunto_id", "conjunto", "Conjunto de anúncios"], anuncio: ["anuncio_id", "anuncio", "Anúncio"] }[st.aba];
    var grupos = agrupar(linhas, nivel[0], nivel[1]);
    var tabela = '<div class="card"><div class="an-abas">' + [["campanha", "Campanhas"], ["conjunto", "Conjuntos"], ["anuncio", "Anúncios"]].map(function (a) { return '<button class="' + (st.aba === a[0] ? "on" : "") + '" data-aba="' + a[0] + '">' + a[1] + "</button>"; }).join("") + "</div>" +
      (grupos.length ? '<div class="table-wrap"><table class="an-tab"><thead><tr><th>' + nivel[2] + "</th><th>Investimento</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Resultados</th><th>Custo/result.</th></tr></thead><tbody>" +
        grupos.map(function (g) { return "<tr><td><b>" + A.esc(g.nome) + "</b>" + (st.aba !== "campanha" ? "<small>" + A.esc(st.aba === "anuncio" ? (g.campanha || "") + (g.conjunto ? " › " + g.conjunto : "") : g.campanha || "") + "</small>" : "") + "</td><td>" + fmtM(g.custo, moeda) + "</td><td>" + fmtN(g.impressoes) + "</td><td>" + fmtN(g.cliques) + "</td><td>" + pct(g.ctr) + "</td><td>" + fmtM(g.cpc, moeda) + "</td><td>" + fmtM(g.cpm, moeda) + "</td><td>" + fmtN(g.resultados) + "</td><td>" + fmtM(g.cpr, moeda) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="an-carr">Sem dados no período.</p>') + "</div>";

    var corpo;
    if (!contas.length) corpo = '<div class="card an-demo"><p class="an-carr">Informe o ID da conta de anúncios acima para ver aqui o desempenho das suas campanhas: investimento, impressões, alcance, cliques, CTR, CPC, CPM, leads e custo por lead, por período.</p></div>';
    else if (!linhas.length && !antes.length) corpo = filtros + '<div class="card an-demo"><p class="an-carr">' + (aguardando ? "Assim que o acesso for autorizado, as campanhas, o investimento, as impressões, o alcance, os cliques, o CTR, o CPC, o CPM e os leads aparecem aqui, com gráfico por dia e comparação com o período anterior." : "Sem dados no período escolhido. Clique em “Atualizar agora” para buscar no Meta.") + "</p></div>";
    else corpo = filtros + (misto ? '<p class="an-erro">As contas escolhidas usam moedas diferentes; os totais misturam valores. Filtre por conta para ver cada moeda.</p>' : "") +
      (erros.length ? '<p class="an-erro">⚠ ' + A.esc(erros[0].nome) + ": " + A.esc(erros[0].ultimo_erro) + "</p>" : "") +
      kpis + '<div class="card an-graf"><h3>Investimento e resultados por dia</h3><div class="an-canvas"><canvas data-graf></canvas></div></div>' + tabela;

    el.innerHTML = '<div class="an">' + conexaoHtml + corpo +
      (admin && cx.length ? '<div class="card"><h3>Conexões Meta dos clientes <small>' + cx.length + "</small></h3><div class=\"table-wrap\"><table><thead><tr><th>Login</th><th>Cliente</th><th>Facebook</th><th>Situação</th><th>Contas</th><th>Última sincronização</th></tr></thead><tbody>" +
        cx.map(function (c) { return "<tr><td>" + A.esc(c.membro) + "</td><td>" + A.esc(c.cliente || "Agência") + "</td><td>" + A.esc(c.usuario_nome || "—") + '</td><td><span class="pill ' + (c.status === "ativa" ? "an-p-ok" : "an-p-erro") + '">' + A.esc(c.status) + "</span>" + (c.ultimo_erro ? "<small>" + A.esc(c.ultimo_erro) + "</small>" : "") + "</td><td>" + c.contas.filter(function (x) { return x.ativo; }).map(function (x) { return A.esc(x.nome); }).join(", ") + "</td><td>" + (c.ultima_sync ? new Date(c.ultima_sync).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—") + "</td></tr>"; }).join("") +
        "</tbody></table></div></div>" : "") + "</div>";

    // gráfico
    var canvas = el.querySelector("[data-graf]");
    if (canvas && linhas.length) {
      try {
        await carregarChart();
        var porDia = {}; for (var d = new Date(ini); d <= fim; d = new Date(d.getTime() + 864e5)) porDia[isoDia(d)] = { custo: 0, res: 0 };
        linhas.forEach(function (l) { if (porDia[l.data]) { porDia[l.data].custo += n(l.custo); porDia[l.data].res += n(l.resultados); } });
        var rot = Object.keys(porDia);
        if (st.grafico) { try { st.grafico.destroy(); } catch (e) {} }
        st.grafico = new window.Chart(canvas, {
          data: { labels: rot.map(function (x) { return x.slice(8, 10) + "/" + x.slice(5, 7); }), datasets: [
            { type: "bar", label: "Investimento", data: rot.map(function (x) { return Math.round(porDia[x].custo * 100) / 100; }), backgroundColor: "rgba(22,184,166,.55)", borderRadius: 4, yAxisID: "y" },
            { type: "line", label: "Resultados", data: rot.map(function (x) { return porDia[x].res; }), borderColor: "#6b3fd4", backgroundColor: "#6b3fd4", tension: .3, pointRadius: 2, yAxisID: "y2" }] },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + (c.datasetIndex === 0 ? fmtM(c.parsed.y, moeda) : fmtN(c.parsed.y)); } } } },
            scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return fmtM(v, moeda); } } }, y2: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } }
        });
      } catch (e) { canvas.parentNode.innerHTML = '<p class="an-carr">Não foi possível carregar o gráfico.</p>'; }
    } else if (canvas) canvas.parentNode.innerHTML = '<p class="an-carr">Sem dados no período. Clique em “Atualizar agora” para buscar no Meta.</p>';

    // eventos
    el.querySelectorAll("[data-f]").forEach(function (s) { s.addEventListener("change", function () { var k = s.dataset.f; st[k] = k === "dias" ? +s.value : s.value; if (k === "cliente") { st.conta = ""; st.campanha = ""; } if (k === "conta") st.campanha = ""; render(el, A); }); });
    el.querySelectorAll("[data-aba]").forEach(function (b) { b.addEventListener("click", function () { st.aba = b.dataset.aba; render(el, A); }); });
    el.querySelectorAll("[data-conectar]").forEach(function (b) { b.addEventListener("click", function () { conectar(A, b); }); });
    var fa = el.querySelector("[data-form-act]");
    if (fa) fa.addEventListener("submit", async function (e) {
      e.preventDefault(); var b = fa.querySelector("button"), f = new FormData(fa), act = String(f.get("act") || "").replace(/\D/g, "");
      if (act.length < 6 || act.length > 20) return A.toast("Confira o ID: são só números, como act_123456789012345.", true);
      b.disabled = true; b.textContent = "Conectando…";
      var args = { p_act: act }; if (admin) args.p_cliente = f.get("cliente") || null;
      var r = await A.sb.rpc("meta_registrar_conta", args);
      if (r.error) { b.disabled = false; b.textContent = "Conectar conta Meta"; var m = r.error.message || ""; return A.toast(/conta_de_outro_cliente/.test(m) ? "Esta conta já está vinculada a outro cliente." : /id_invalido/.test(m) ? "ID inválido." : /sem_conta/.test(m) ? "Seu login não está ligado a uma empresa." : m, true); }
      try { await chamar(A, "meta-integrador", { acao: "disparar", conta: r.data.id, dias: 30 }); A.toast("Conta " + r.data.act + " registrada. Buscando os dados no Meta…"); }
      catch (x) { A.toast(x.codigo === "integrador_nao_configurado" ? "Conta registrada. A busca automática começa assim que a integração da danova for ativada." : "Conta registrada. " + msgErro(x)); }
      st.conta = ""; render(el, A);
    });
    el.querySelectorAll("[data-buscar]").forEach(function (b) { b.addEventListener("click", async function () {
      b.disabled = true; var t = b.textContent; b.textContent = "Buscando…";
      try { await chamar(A, "meta-integrador", { acao: "disparar", conta: b.dataset.buscar, dias: 30 }); A.toast("Pedido enviado. Os dados aparecem em alguns instantes."); setTimeout(function () { render(el, A); }, 15000); }
      catch (x) { A.toast(x.codigo === "integrador_nao_configurado" ? "A integração da danova ainda não foi ativada." : msgErro(x), true); }
      b.disabled = false; b.textContent = t;
    }); });
    el.querySelectorAll("[data-remover]").forEach(function (b) { b.addEventListener("click", async function () {
      if (!window.confirm("Remover esta conta do painel? Os dados já importados ficam guardados.")) return;
      var r = await A.sb.rpc("meta_remover_conta", { p_id: b.dataset.remover }); if (r.error) return A.toast(r.error.message, true);
      A.toast("Conta removida do painel."); render(el, A);
    }); });
    var be = el.querySelector("[data-escolher]"), box = el.querySelector("[data-selbox]");
    var abrirSel = function () { seletorContas(box, A, minha.id, async function () { st.conta = ""; await sincronizar(el, A, null, true); }); };
    if (be) be.addEventListener("click", abrirSel);
    var bd = el.querySelector("[data-desconectar]");
    if (bd) bd.addEventListener("click", async function () {
      if (!window.confirm("Desconectar sua conta Meta Ads? O painel para de receber dados novos até você conectar de novo.")) return;
      try { await chamar(A, "meta-conectar", { acao: "desconectar", conexao: minha.id }); A.toast("Conta Meta desconectada."); render(el, A); } catch (x) { A.toast(msgErro(x), true); }
    });
    var ba = el.querySelector("[data-atualizar]");
    if (ba) ba.addEventListener("click", function () { sincronizar(el, A, ba); });
    if (RET && RET.get("meta") === "ok" && minha && !st.retornoFeito) { st.retornoFeito = true; abrirSel(); }
  }

  async function sincronizar(el, A, botao, silencioso) {
    var t = botao && botao.textContent; if (botao) { botao.disabled = true; botao.textContent = "Buscando no Meta…"; }
    var corpo = { plataforma: "meta", dias: Math.max(st.dias * 2, 30) };
    if (st.conta) corpo.conta = st.conta;
    try { try { await chamar(A, "meta-integrador", { acao: "disparar", conta: st.conta || undefined, dias: Math.min(Math.max(st.dias * 2, 30), 90) }); } catch (x) { if (x.codigo !== "sem_contas" && x.codigo !== "integrador_nao_configurado") throw x; }
      var d = await chamar(A, "ads-sync", corpo).catch(function (x) { if (x.codigo === "sem_contas") return { resultado: [] }; throw x; }); var ruins = (d.resultado || []).filter(function (x) { return x.erro; }); A.toast(ruins.length ? "Atualizado com aviso: " + ruins[0].erro : "Dados atualizados."); }
    catch (x) { if (!silencioso || x.codigo !== "sem_contas") A.toast(msgErro(x), true); }
    finally { if (botao) { botao.disabled = false; botao.textContent = t; } render(el, A); }
  }

  D.modulos.push({ id: "anuncios", titulo: "Meus anúncios", tituloLongo: "Meus anúncios · Meta Ads", icone: "f", papeis: ["construtora", "admin"], render: render });
})();
