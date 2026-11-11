/* DANOVA MARKETING INTELLIGENCE — integração própria com a Meta Marketing API (multi-cliente).
   Dados reais do Supabase (meta_ad_accounts, meta_campaigns, meta_adsets, meta_ads, meta_insights_daily),
   gravados pelas Edge Functions meta-*. Admin vê tudo; cliente (papel construtora) vê só as contas dele (RLS). */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {}; D.modulos = D.modulos || [];
  var RETORNO = (function () { try { var p = (location.hash || "").split("?")[1] || ""; return location.hash.indexOf("#marketing") === 0 ? new URLSearchParams(p) : null; } catch (e) { return null; } })();
  var st = { aba: null, dias: 30, cliente: "", conta: "", campanha: "", status: "", nivelAnalise: "campaign" };
  var ERR = {
    app_nao_configurado: "O app Meta ainda não está configurado no servidor (META_APP_ID / META_APP_SECRET).",
    chave_cripto_ausente: "Falta a chave de criptografia dos tokens (META_TOKEN_ENCRYPTION_KEY) nas Secrets do Supabase.",
    nao_autenticado: "Sua sessão expirou. Entre de novo.", sem_acesso: "Sem permissão para esta ação.", sem_conta_vinculada: "Seu login ainda não está ligado a uma empresa.",
    conexao_nao_encontrada: "Conexão não encontrada.", conta_nao_encontrada: "Conta não encontrada.", aguarde: "Atualizado há menos de 5 minutos.",
    sem_permissao_gestao: "A conexão não tem a permissão de gerenciar campanhas (ads_management). Reconecte com “gerenciar campanhas” — exige aprovação da Meta.",
    confirmacao_obrigatoria: "Confirme a alteração.", nenhuma_conta: "Escolha pelo menos uma conta."
  };
  var STATUS = { ACTIVE: ["Ativa", "ok"], PAUSED: ["Pausada", "pa"], CAMPAIGN_PAUSED: ["Campanha pausada", "pa"], ADSET_PAUSED: ["Conjunto pausado", "pa"], ARCHIVED: ["Arquivada", "ar"], DELETED: ["Excluída", "ar"], IN_PROCESS: ["Em análise", "pa"], WITH_ISSUES: ["Com problemas", "er"], DISAPPROVED: ["Reprovado", "er"], PENDING_REVIEW: ["Em revisão", "pa"] };

  // ---------- utilidades ----------
  async function chamar(A, fn, corpo) {
    var r = await A.sb.functions.invoke(fn, { body: corpo || {} });
    var e = r.data && r.data.erro, det = r.data && r.data.detalhe;
    try { var j = r.error && r.error.context && await r.error.context.json(); if (j) { e = j.erro || e; det = j.detalhe || det; } } catch (x) {}
    if (r.error && !e) e = r.error.message || "falha";
    if (e) throw new Error(ERR[e] || det || e);
    return r.data;
  }
  function n(v) { return Number(v || 0); }
  function moeda(v, m) { var s = m === "USD" ? "US$ " : m === "EUR" ? "€ " : "R$ "; return s + n(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function int(v) { return Math.round(n(v)).toLocaleString("pt-BR"); }
  function pct(v) { return v == null ? "—" : n(v).toFixed(2).replace(".", ",") + "%"; }
  function dia(d) { return new Date(Date.now() - 3 * 3600e3 - d * 864e5).toISOString().slice(0, 10); }
  function quando(iso) { return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"; }
  function selo(s) { var x = STATUS[s] || [s || "—", ""]; return '<span class="mi-st ' + x[1] + '">' + x[0] + "</span>"; }
  function periodo() { return { desde: dia(st.dias - 1), ate: dia(0) }; }

  // ---------- render ----------
  async function render(el, A) {
    var admin = A.isAdmin();
    var abas = admin
      ? [["visao", "Visão geral"], ["clientes", "Clientes"], ["contas", "Contas Meta"], ["campanhas", "Campanhas"], ["conjuntos", "Conjuntos"], ["anuncios", "Anúncios"], ["relatorios", "Relatórios"], ["gestao", "Gerenciamento"], ["historico", "Histórico de alterações"], ["config", "Configurações"]]
      : [["contas", "Minhas contas de anúncios"], ["visao", "Visão geral"], ["campanhas", "Campanhas"], ["relatorios", "Relatórios"]];
    if (!st.aba) st.aba = admin ? "visao" : "contas";
    if (RETORNO && RETORNO.get("meta")) { st.aba = "contas"; }
    el.innerHTML = '<div class="mi"><header class="mi-topo"><div><small>DANOVA</small><h2>Marketing Intelligence</h2></div>' +
      '<button class="btn primary" data-conectar>Conectar minha conta Meta Ads</button></header>' +
      '<nav class="mi-abas">' + abas.map(function (a) { return '<button data-aba="' + a[0] + '" class="' + (st.aba === a[0] ? "sel" : "") + '">' + a[1] + "</button>"; }).join("") + "</nav>" +
      '<div data-filtros></div><div data-corpo><p class="note">Carregando…</p></div></div>';
    el.querySelectorAll("[data-aba]").forEach(function (b) { b.addEventListener("click", function () { st.aba = b.dataset.aba; render(el, A); }); });
    el.querySelector("[data-conectar]").addEventListener("click", function () { conectar(A, false); });
    var base = await carregarBase(A);
    if (["visao", "campanhas", "conjuntos", "anuncios", "relatorios", "gestao"].indexOf(st.aba) >= 0) filtros(el.querySelector("[data-filtros]"), A, base, function () { render(el, A); });
    var c = el.querySelector("[data-corpo]");
    try {
      if (st.aba === "visao") await abaVisao(c, A, base);
      else if (st.aba === "clientes") await abaClientes(c, A, base, el);
      else if (st.aba === "contas") await abaContas(c, A, base, el);
      else if (st.aba === "campanhas" || st.aba === "conjuntos" || st.aba === "anuncios") await abaNivel(c, A, base, st.aba);
      else if (st.aba === "relatorios") await abaRelatorios(c, A, base);
      else if (st.aba === "gestao") await abaGestao(c, A, base, el);
      else if (st.aba === "historico") await abaHistorico(c, A);
      else if (st.aba === "config") await abaConfig(c, A, base);
    } catch (x) { c.innerHTML = '<div class="card"><p class="note">Não foi possível carregar: ' + A.esc(x.message || x) + "</p></div>"; }
  }

  async function carregarBase(A) {
    var r = await Promise.all([
      A.sb.from("meta_ad_accounts").select("id, conta_id, connection_id, act_id, nome, moeda, empresa, status_meta, ativo, ultima_sync, ultimo_erro, primeira_sync_feita").order("nome"),
      A.sb.from("meta_connections_publico").select("*").order("criado_em", { ascending: false }),
      A.isAdmin() ? A.sb.from("contas").select("id, nome, ativo").order("nome") : Promise.resolve({ data: [] }),
      A.sb.from("meta_campaigns").select("id, nome, ad_account_id, effective_status").order("nome").limit(2000)
    ]);
    return { contas: (r[0].data || []), conexoes: r[1].data || [], clientes: r[2].data || [], campanhas: r[3].data || [] };
  }

  function filtros(box, A, base, mudou) {
    var admin = A.isAdmin(), contasVis = base.contas.filter(function (a) { return a.ativo && (!st.cliente || a.conta_id === st.cliente); });
    var camps = base.campanhas.filter(function (c) { return !st.conta || c.ad_account_id === st.conta; });
    box.innerHTML = '<div class="mi-filtros">' +
      (admin ? '<select data-f="cliente"><option value="">Todos os clientes</option>' + base.clientes.map(function (c) { return '<option value="' + c.id + '"' + (st.cliente === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select>" : "") +
      '<select data-f="conta"><option value="">Todas as contas</option>' + contasVis.map(function (a) { return '<option value="' + a.id + '"' + (st.conta === a.id ? " selected" : "") + ">" + A.esc(a.nome) + "</option>"; }).join("") + "</select>" +
      '<select data-f="campanha"><option value="">Todas as campanhas</option>' + camps.slice(0, 500).map(function (c) { return '<option value="' + c.id + '"' + (st.campanha === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select>" +
      '<select data-f="dias">' + [[1, "Hoje"], [7, "7 dias"], [14, "14 dias"], [30, "30 dias"], [90, "90 dias"]].map(function (d) { return '<option value="' + d[0] + '"' + (st.dias === d[0] ? " selected" : "") + ">" + d[1] + "</option>"; }).join("") + "</select>" +
      '<select data-f="status"><option value="">Todos os status</option>' + ["ACTIVE", "PAUSED", "ARCHIVED"].map(function (s) { return '<option value="' + s + '"' + (st.status === s ? " selected" : "") + ">" + STATUS[s][0] + "</option>"; }).join("") + "</select></div>";
    box.querySelectorAll("[data-f]").forEach(function (s) { s.addEventListener("change", function () {
      var k = s.dataset.f; st[k] = k === "dias" ? +s.value : s.value;
      if (k === "cliente") { st.conta = ""; st.campanha = ""; } if (k === "conta") st.campanha = "";
      mudou();
    }); });
  }

  function kpis(lista) { return '<div class="mi-kpis">' + lista.map(function (k) { return '<div><small>' + k[0] + "</small><b>" + k[1] + "</b>" + (k[2] ? "<em>" + k[2] + "</em>" : "") + "</div>"; }).join("") + "</div>"; }
  function grafico(diario, mo) {
    if (!diario.length) return "";
    var max = Math.max.apply(null, diario.map(function (d) { return n(d.custo); })) || 1, w = 100 / diario.length;
    return '<div class="mi-graf" role="img" aria-label="Investimento por dia"><svg viewBox="0 0 100 40" preserveAspectRatio="none">' + diario.map(function (d, i) { var h = n(d.custo) / max * 38; return '<rect x="' + (i * w + w * 0.15) + '" y="' + (40 - h) + '" width="' + (w * 0.7) + '" height="' + h + '"><title>' + d.data.split("-").reverse().join("/") + ": " + moeda(d.custo, mo) + " · " + int(d.leads) + " leads</title></rect>"; }).join("") +
      '</svg><div class="mi-graf-l"><span>' + diario[0].data.split("-").reverse().join("/") + "</span><span>Investimento por dia</span><span>" + diario[diario.length - 1].data.split("-").reverse().join("/") + "</span></div></div>";
  }

  async function dashboard(A) {
    var p = periodo();
    return chamar(A, "meta-get-dashboard", { desde: p.desde, ate: p.ate, conta_id: st.cliente || null, ad_account_id: st.conta || null, campaign_id: st.campanha || null, status: st.status || null });
  }

  async function abaVisao(c, A, base) {
    if (!base.contas.some(function (a) { return a.ativo; })) { c.innerHTML = vazioConectar(A); ligarConectar(c, A); return; }
    var d = await dashboard(A), t = d.totais || {}, mo = (d.moedas || [])[0] || "BRL";
    c.innerHTML = (d.moedas && d.moedas.length > 1 ? '<p class="mi-aviso">Há contas em moedas diferentes (' + d.moedas.join(", ") + '). Filtre por conta para comparar valores.</p>' : "") +
      kpis([["Investimento total", moeda(t.investimento, mo)], ["Clientes conectados", int(d.clientes_conectados)], ["Campanhas ativas", int(d.campanhas_ativas)], ["Leads gerados", int(t.leads)],
        ["CPC médio", t.cpc != null ? moeda(t.cpc, mo) : "—"], ["CPM médio", t.cpm != null ? moeda(t.cpm, mo) : "—"], ["CTR médio", pct(t.ctr)], ["Custo por lead", t.custo_lead != null ? moeda(t.custo_lead, mo) : "—"]]) +
      '<section class="card">' + (grafico(d.diario || [], mo) || '<p class="note">Sem métricas no período. A primeira sincronização pode levar alguns minutos.</p>') + "</section>" +
      '<div class="mi-dupla">' +
      (A.isAdmin() ? '<section class="card"><h3>Ranking de clientes</h3>' + tabela(["Cliente", "Investimento", "Leads", "Custo/lead"], (d.clientes || []).slice(0, 10).map(function (r) { return [A.esc(r.nome || "Agência (sem cliente)"), moeda(r.custo, mo), int(r.leads), r.custo_lead != null ? moeda(r.custo_lead, mo) : "—"]; })) + "</section>" : "") +
      '<section class="card"><h3>Ranking de campanhas</h3>' + tabela(["Campanha", "Status", "Investimento", "Leads", "CTR", "Custo/lead"], (d.campanhas || []).slice(0, 10).map(function (r) { return [A.esc(r.nome), selo(r.status), moeda(r.custo, mo), int(r.leads), pct(r.ctr), r.custo_lead != null ? moeda(r.custo_lead, mo) : "—"]; })) + "</section></div>";
  }
  function tabela(cab, linhas) {
    if (!linhas.length) return '<p class="note">Sem dados no período.</p>';
    return '<div class="table-wrap"><table><thead><tr>' + cab.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + linhas.map(function (l) { return "<tr>" + l.map(function (x) { return "<td>" + x + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }

  async function abaClientes(c, A, base, el) {
    var d = await chamar(A, "meta-get-dashboard", { desde: dia(29), ate: dia(0) });
    var porCli = {}; (d.clientes || []).forEach(function (r) { porCli[r.conta_id || ""] = r; });
    var linhas = base.clientes.map(function (k) {
      var contas = base.contas.filter(function (a) { return a.conta_id === k.id && a.ativo; }), r = porCli[k.id] || {};
      return [A.esc(k.nome), int(contas.length), moeda(r.custo, "BRL"), int(r.leads), r.custo_lead != null ? moeda(r.custo_lead, "BRL") : "—", '<button class="btn ghost small" data-entrar="' + k.id + '">Ver painel</button>'];
    });
    var semCli = base.contas.filter(function (a) { return !a.conta_id && a.ativo; }).length;
    c.innerHTML = '<section class="card"><h3>Clientes · últimos 30 dias</h3>' + tabela(["Cliente", "Contas Meta", "Investimento", "Leads", "Custo/lead", ""], linhas) +
      (semCli ? '<p class="note">' + semCli + ' conta(s) sem cliente (agência). Defina o cliente em “Contas Meta”.</p>' : "") + "</section>";
    c.querySelectorAll("[data-entrar]").forEach(function (b) { b.addEventListener("click", function () { st.cliente = b.dataset.entrar; st.conta = ""; st.campanha = ""; st.aba = "visao"; render(el, A); }); });
  }

  function vazioConectar(A) {
    return '<section class="card mi-vazio"><h3>Nenhuma conta Meta conectada ainda</h3><p class="note">Clique no botão, entre com o Facebook que administra a conta de anúncios e autorize a DANOVA a ler o desempenho das campanhas.</p><button class="btn primary" data-conectar2>Conectar minha conta Meta Ads</button></section>';
  }
  function ligarConectar(c, A) { var b = c.querySelector("[data-conectar2]"); if (b) b.addEventListener("click", function () { conectar(A, false); }); }

  async function conectar(A, gerenciar, contaId) {
    try {
      var d = await chamar(A, "meta-oauth-start", { gerenciar: !!gerenciar, conta_id: contaId || st.cliente || null });
      location.href = d.url;
    } catch (x) { A.toast(x.message, true); }
  }

  async function abaContas(c, A, base, el) {
    var admin = A.isAdmin();
    var aviso = "";
    if (RETORNO && RETORNO.get("meta")) {
      var r = RETORNO.get("meta"), motivo = RETORNO.get("motivo") || ""; RETORNO = null;
      aviso = r === "ok" ? '<p class="mi-aviso ok">Facebook conectado. Escolha abaixo as contas de anúncios.</p>' : r === "cancelado" ? '<p class="mi-aviso">Conexão cancelada.</p>' : '<p class="mi-aviso er">A Meta não concluiu a conexão: ' + A.esc(motivo) + "</p>";
      var cx = base.conexoes[0];
      if (r === "ok" && cx) setTimeout(function () { escolherContas(A, cx.id, el); }, 300);
    }
    var cxs = base.conexoes.map(function (cx) {
      var cor = cx.status === "ativa" ? "ok" : cx.status === "expirando" ? "pa" : "er";
      return '<div class="mi-cx"><div><b>' + A.esc(cx.meta_user_name || "Facebook") + "</b><small>" + (cx.expira_em ? "válido até " + new Date(cx.expira_em).toLocaleDateString("pt-BR") : "") + ((cx.escopos || []).indexOf("ads_management") >= 0 ? " · pode gerenciar campanhas" : " · somente leitura") + "</small>" + (cx.ultimo_erro ? '<small class="mi-err">' + A.esc(cx.ultimo_erro) + "</small>" : "") + '</div><span class="mi-st ' + cor + '">' + ({ ativa: "Conectado", expirando: "Expirando", reautorizar: "Reconectar", erro: "Erro" }[cx.status] || cx.status) + "</span>" +
        '<button class="btn ghost small" data-escolher="' + cx.id + '">Selecionar conta</button><button class="btn ghost small" data-reconectar>Reconectar</button><button class="btn ghost small mi-perigo" data-desconectar="' + cx.id + '">Desconectar</button></div>';
    }).join("");
    var contas = base.contas.filter(function (a) { return a.ativo; });
    var linhas = contas.map(function (a) {
      var cli = admin ? base.clientes.find(function (k) { return k.id === a.conta_id; }) : null;
      return '<div class="mi-conta"><div><b>' + A.esc(a.nome) + "</b><small>ID " + A.esc(a.act_id) + (a.empresa ? " · " + A.esc(a.empresa) : "") + " · última sincronização " + quando(a.ultima_sync) + "</small>" + (a.ultimo_erro ? '<small class="mi-err">' + A.esc(a.ultimo_erro) + "</small>" : "") + "</div>" +
        (admin ? '<select data-cliente="' + a.id + '"><option value="">Agência (sem cliente)</option>' + base.clientes.map(function (k) { return '<option value="' + k.id + '"' + (a.conta_id === k.id ? " selected" : "") + ">" + A.esc(k.nome) + "</option>"; }).join("") + "</select>" : "") +
        '<span class="mi-st ' + (a.ultimo_erro ? "er" : a.ultima_sync ? "ok" : "pa") + '">' + (a.ultimo_erro ? "Erro" : a.ultima_sync ? "Conectada" : "Sincronizando") + "</span>" +
        '<button class="btn ghost small" data-atualizar="' + a.id + '">Atualizar dados</button><button class="btn ghost small mi-perigo" data-desvincular="' + a.id + '">Desconectar conta</button></div>';
    }).join("");
    // resumo por conta (30 dias)
    var resumo = {};
    if (contas.length) {
      var ins = (await A.sb.from("meta_insights_daily").select("ad_account_id, custo, leads").eq("nivel", "campaign").gte("data", dia(29)).in("ad_account_id", contas.map(function (a) { return a.id; })).limit(20000)).data || [];
      ins.forEach(function (l) { var r = resumo[l.ad_account_id] || (resumo[l.ad_account_id] = { custo: 0, leads: 0 }); r.custo += n(l.custo); r.leads += n(l.leads); });
    }
    c.innerHTML = aviso + '<section class="card"><h3>Facebook conectado</h3>' + (cxs || '<p class="note">Nenhum Facebook conectado.</p><button class="btn primary" data-conectar2>Conectar minha conta Meta Ads</button>') + "</section>" +
      '<section class="card"><h3>' + (admin ? "Contas de anúncios" : "Minhas contas de anúncios") + " <small>" + contas.length + "</small></h3>" + (linhas || '<p class="note">Nenhuma conta selecionada ainda. Clique em “Selecionar conta”.</p>') + "</section>" +
      (contas.length ? '<section class="card"><h3>Resumo · 30 dias</h3>' + tabela(["Conta", "ID", "Campanhas ativas", "Investimento", "Leads"], contas.map(function (a) { var r = resumo[a.id] || {}; return [A.esc(a.nome), A.esc(a.act_id), int(base.campanhas.filter(function (k) { return k.ad_account_id === a.id && k.effective_status === "ACTIVE"; }).length), moeda(r.custo, a.moeda), int(r.leads)]; })) + "</section>" : "");
    ligarConectar(c, A);
    c.querySelectorAll("[data-escolher]").forEach(function (b) { b.addEventListener("click", function () { escolherContas(A, b.dataset.escolher, el); }); });
    c.querySelectorAll("[data-reconectar]").forEach(function (b) { b.addEventListener("click", function () { conectar(A, false); }); });
    c.querySelectorAll("[data-desconectar]").forEach(function (b) { b.addEventListener("click", async function () {
      if (!confirm("Desconectar este Facebook? As contas ligadas a ele param de atualizar (o histórico fica salvo).")) return;
      try { await chamar(A, "meta-disconnect", { connection_id: b.dataset.desconectar, revogar: confirm("Também remover a autorização do app DANOVA no Facebook?") }); A.toast("Desconectado."); render(el, A); } catch (x) { A.toast(x.message, true); }
    }); });
    c.querySelectorAll("[data-atualizar]").forEach(function (b) { b.addEventListener("click", async function () {
      b.disabled = true; b.textContent = "Atualizando…";
      try { var r = await chamar(A, "meta-sync-insights", { ad_account_id: b.dataset.atualizar, dias: 7 }); await chamar(A, "meta-sync-campaigns", { ad_account_id: b.dataset.atualizar }).catch(function () {}); A.toast("Atualizado: " + int(r.insights) + " linhas de métricas."); render(el, A); }
      catch (x) { A.toast(x.message, true); b.disabled = false; b.textContent = "Atualizar dados"; }
    }); });
    c.querySelectorAll("[data-desvincular]").forEach(function (b) { b.addEventListener("click", async function () {
      if (!confirm("Desconectar esta conta de anúncios do painel? O histórico fica salvo.")) return;
      try { await chamar(A, "meta-mi", { acao: "unlink_account", ad_account_id: b.dataset.desvincular }); render(el, A); } catch (x) { A.toast(x.message, true); }
    }); });
    c.querySelectorAll("[data-cliente]").forEach(function (s) { s.addEventListener("change", async function () {
      try { await chamar(A, "meta-mi", { acao: "set_client", ad_account_id: s.dataset.cliente, conta_id: s.value || null }); A.toast("Cliente da conta atualizado."); } catch (x) { A.toast(x.message, true); }
    }); });
  }

  async function escolherContas(A, connectionId, el) {
    var box = document.createElement("div"); box.className = "ez";
    box.innerHTML = '<div class="ez-box"><div class="ez-top"><div><small>Meta Ads</small><b>Selecione as contas de anúncios</b></div><button class="icon-btn" data-x>✕</button></div><div data-lista><p class="note">Buscando as contas na Meta…</p></div></div>';
    document.body.appendChild(box);
    var fechar = function () { box.remove(); };
    box.querySelector("[data-x]").addEventListener("click", fechar);
    try {
      var d = await chamar(A, "meta-list-accounts", { connection_id: connectionId }), lista = d.contas || [];
      var admin = A.isAdmin(), base = await carregarBase(A);
      box.querySelector("[data-lista]").innerHTML = (lista.length ? '<div class="mi-sel">' + lista.map(function (a) {
        return '<label class="' + (a.de_outro_cliente ? "off" : "") + '"><input type="checkbox" value="' + a.act_id + '"' + (a.vinculada ? " checked" : "") + (a.de_outro_cliente ? " disabled" : "") + '><span><b>' + A.esc(a.nome) + "</b><small>ID " + a.act_id + (a.empresa ? " · " + A.esc(a.empresa) : "") + (a.moeda ? " · " + a.moeda : "") + (a.de_outro_cliente ? " · já vinculada a outro cliente" : "") + "</small></span></label>";
      }).join("") + "</div>" : '<p class="note">Este Facebook não tem acesso a nenhuma conta de anúncios.</p>') +
        (admin && lista.length ? '<label class="mi-cli">Cliente dono das contas<select data-dono><option value="">Agência (sem cliente)</option>' + base.clientes.map(function (k) { return '<option value="' + k.id + '"' + (st.cliente === k.id ? " selected" : "") + ">" + A.esc(k.nome) + "</option>"; }).join("") + "</select></label>" : "") +
        (lista.length ? '<div class="ez-acts"><button class="btn primary" data-salvar>Vincular contas selecionadas</button></div>' : "");
      var s = box.querySelector("[data-salvar]");
      if (s) s.addEventListener("click", async function () {
        var ids = Array.prototype.slice.call(box.querySelectorAll("input:checked:not(:disabled)")).map(function (i) { return i.value; });
        if (!ids.length) return A.toast(ERR.nenhuma_conta, true);
        s.disabled = true; s.textContent = "Vinculando…";
        try { var corpo = { connection_id: connectionId, act_ids: ids }; var dono = box.querySelector("[data-dono]"); if (dono) corpo.conta_id = dono.value || null;
          var r = await chamar(A, "meta-select-account", corpo); A.toast(r.vinculadas + " conta(s) vinculada(s). A primeira sincronização (30 dias) leva alguns minutos." + (r.recusadas ? " " + r.recusadas + " recusada(s)." : "")); fechar(); render(el, A); }
        catch (x) { A.toast(x.message, true); s.disabled = false; s.textContent = "Vincular contas selecionadas"; }
      });
    } catch (x) { box.querySelector("[data-lista]").innerHTML = '<p class="mi-aviso er">' + A.esc(x.message) + "</p>"; }
  }

  // campanhas / conjuntos / anúncios: lista + métricas somadas do período
  async function linhasNivel(A, nivel) {
    var p = periodo(), tab = nivel === "campaign" ? "meta_campaigns" : nivel === "adset" ? "meta_adsets" : "meta_ads";
    var q1 = A.sb.from(tab).select("*").limit(3000), q2 = A.sb.from("meta_insights_daily").select("objeto_id, nome, custo, impressoes, cliques, leads, resultados, alcance, moeda").eq("nivel", nivel).gte("data", p.desde).lte("data", p.ate).limit(50000);
    if (st.conta) { q1 = q1.eq("ad_account_id", st.conta); q2 = q2.eq("ad_account_id", st.conta); }
    else if (st.cliente) { q1 = q1.eq("conta_id", st.cliente); q2 = q2.eq("conta_id", st.cliente); }
    if (st.campanha) { q1 = nivel === "campaign" ? q1.eq("id", st.campanha) : q1.eq("campaign_id", st.campanha); q2 = q2.eq("campaign_id", st.campanha); }
    if (st.status) q1 = q1.eq("effective_status", st.status);
    var r = await Promise.all([q1, q2]), objs = r[0].data || [], ins = r[1].data || [], agg = {};
    ins.forEach(function (l) { var a = agg[l.objeto_id] || (agg[l.objeto_id] = { custo: 0, imp: 0, cli: 0, leads: 0, res: 0, moeda: l.moeda }); a.custo += n(l.custo); a.imp += n(l.impressoes); a.cli += n(l.cliques); a.leads += n(l.leads); a.res += n(l.resultados); });
    return objs.map(function (o) { var a = agg[o.id] || { custo: 0, imp: 0, cli: 0, leads: 0, res: 0 }; return Object.assign({}, o, { m: a }); }).sort(function (x, y) { return y.m.custo - x.m.custo; });
  }
  async function abaNivel(c, A, base, aba) {
    var nivel = aba === "campanhas" ? "campaign" : aba === "conjuntos" ? "adset" : "ad", rows = await linhasNivel(A, nivel);
    var moedaConta = function (o) { var a = base.contas.find(function (x) { return x.id === o.ad_account_id; }); return (a && a.moeda) || o.m.moeda || "BRL"; };
    c.innerHTML = '<section class="card"><h3>' + { campaign: "Campanhas", adset: "Conjuntos de anúncios", ad: "Anúncios" }[nivel] + " <small>" + rows.length + "</small></h3>" +
      tabela([nivel === "campaign" ? "Campanha" : nivel === "adset" ? "Conjunto" : "Anúncio", "Status"].concat(nivel !== "ad" ? ["Orçamento/dia"] : []).concat(["Investimento", "Impressões", "Cliques", "CTR", "CPC", "CPM", "Leads", "Resultados", "Custo/resultado"]),
        rows.map(function (o) { var m = o.m, mo = moedaConta(o); return [A.esc(o.nome || o.id), selo(o.effective_status)].concat(nivel !== "ad" ? [o.orcamento_diario != null ? moeda(o.orcamento_diario, mo) : (o.orcamento_total != null ? moeda(o.orcamento_total, mo) + " total" : "—")] : [])
          .concat([moeda(m.custo, mo), int(m.imp), int(m.cli), m.imp ? pct(m.cli / m.imp * 100) : "—", m.cli ? moeda(m.custo / m.cli, mo) : "—", m.imp ? moeda(m.custo * 1000 / m.imp, mo) : "—", int(m.leads), int(m.res), m.res ? moeda(m.custo / m.res, mo) : "—"]); })) +
      '<p class="note">Alcance e frequência não são somados entre campanhas ou dias (a mesma pessoa pode ser contada mais de uma vez). Veja-os por dia em Relatórios.</p></section>';
  }

  async function abaRelatorios(c, A, base) {
    var p = periodo();
    c.innerHTML = '<section class="card"><h3>Relatórios</h3><p class="note">Exporta as métricas diárias reais do período e dos filtros selecionados (abre no Excel/Planilhas).</p><div class="mi-rel">' +
      [["campaign", "Campanhas por dia"], ["adset", "Conjuntos por dia"], ["ad", "Anúncios por dia"]].map(function (x) { return '<button class="btn ghost" data-csv="' + x[0] + '">⬇ ' + x[1] + " (CSV)</button>"; }).join("") + "</div></section>";
    c.querySelectorAll("[data-csv]").forEach(function (b) { b.addEventListener("click", async function () {
      b.disabled = true;
      var q = A.sb.from("meta_insights_daily").select("data, nome, objeto_id, campaign_id, adset_id, moeda, impressoes, alcance, frequencia, cliques, cliques_link, custo, cpc, cpm, ctr, leads, conversoes, resultados, custo_resultado, ad_account_id").eq("nivel", b.dataset.csv).gte("data", p.desde).lte("data", p.ate).order("data").limit(50000);
      if (st.conta) q = q.eq("ad_account_id", st.conta); else if (st.cliente) q = q.eq("conta_id", st.cliente);
      if (st.campanha) q = q.eq("campaign_id", st.campanha);
      var r = await q; b.disabled = false;
      if (r.error) return A.falha(r.error);
      var nomeConta = {}; base.contas.forEach(function (a) { nomeConta[a.id] = a.nome + " (" + a.act_id + ")"; });
      var cab = ["Data", "Conta", "Nome", "ID", "Moeda", "Impressões", "Alcance", "Frequência", "Cliques", "Cliques no link", "Investimento", "CPC", "CPM", "CTR %", "Leads", "Conversões", "Resultados", "Custo por resultado"];
      var esc = function (v) { v = v == null ? "" : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var num = function (v) { return v == null ? "" : String(v).replace(".", ","); };
      var csv = [cab.join(";")].concat((r.data || []).map(function (l) { return [l.data, nomeConta[l.ad_account_id] || "", l.nome, l.objeto_id, l.moeda, l.impressoes, l.alcance, num(l.frequencia), l.cliques, l.cliques_link, num(l.custo), num(l.cpc), num(l.cpm), num(l.ctr), num(l.leads), num(l.conversoes), num(l.resultados), num(l.custo_resultado)].map(esc).join(";"); })).join("\n");
      var url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
      a.href = url; a.download = "danova-meta-" + b.dataset.csv + "-" + p.desde + "-a-" + p.ate + ".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      A.toast((r.data || []).length + " linhas exportadas.");
    }); });
  }

  async function abaGestao(c, A, base, el) {
    var podeGerir = base.conexoes.some(function (cx) { return (cx.escopos || []).indexOf("ads_management") >= 0; });
    var camps = await linhasNivel(A, "campaign"), sets = await linhasNivel(A, "adset");
    var linha = function (o, tipo) { var mo = (base.contas.find(function (x) { return x.id === o.ad_account_id; }) || {}).moeda || "BRL"; return [A.esc(o.nome), selo(o.effective_status), o.orcamento_diario != null ? moeda(o.orcamento_diario, mo) + "/dia" : (o.orcamento_total != null ? moeda(o.orcamento_total, mo) + " total" : "—"), moeda(o.m.custo, mo),
      '<div class="mi-gest"><button class="btn ghost small" data-op="status" data-t="' + tipo + '" data-id="' + o.id + '">Status</button>' + (o.status === "ACTIVE" ? '<button class="btn ghost small" data-op="pausar" data-t="' + tipo + '" data-id="' + o.id + '">Pausar</button>' : '<button class="btn ghost small" data-op="ativar" data-t="' + tipo + '" data-id="' + o.id + '">Ativar</button>') + ((o.orcamento_diario != null || o.orcamento_total != null) ? '<button class="btn ghost small" data-op="orcamento" data-t="' + tipo + '" data-id="' + o.id + '" data-nome="' + A.esc(o.nome) + '">Orçamento</button>' : "") + "</div>"]; };
    c.innerHTML = (podeGerir ? "" : '<p class="mi-aviso">Para pausar, ativar ou mudar orçamento, a conexão precisa da permissão <b>ads_management</b> (exige aprovação da Meta). <button class="btn ghost small" data-gerir>Conectar com gerenciamento</button></p>') +
      '<p class="note">Toda alteração pede confirmação, é enviada à Meta e fica registrada no Histórico de alterações.</p>' +
      '<section class="card"><h3>Campanhas</h3>' + tabela(["Campanha", "Status", "Orçamento", "Investimento (período)", "Ações"], camps.slice(0, 100).map(function (o) { return linha(o, "campaign"); })) + "</section>" +
      '<section class="card"><h3>Conjuntos de anúncios</h3>' + tabela(["Conjunto", "Status", "Orçamento", "Investimento (período)", "Ações"], sets.slice(0, 150).map(function (o) { return linha(o, "adset"); })) + "</section>";
    var g = c.querySelector("[data-gerir]"); if (g) g.addEventListener("click", function () { conectar(A, true); });
    c.querySelectorAll("[data-op]").forEach(function (b) { b.addEventListener("click", async function () {
      var op = b.dataset.op, corpo = { tipo: b.dataset.t, id: b.dataset.id, operacao: op, confirmar: true };
      if (op === "orcamento") { var v = prompt("Novo orçamento para “" + b.dataset.nome + "” (valor na moeda da conta, ex.: 150,00):"); if (!v) return; corpo.valor = Number(String(v).replace(/\./g, "").replace(",", ".")); if (!(corpo.valor > 0)) return A.toast("Valor inválido.", true); }
      if (op !== "status" && !confirm("Confirmar: " + { pausar: "PAUSAR", ativar: "ATIVAR", orcamento: "alterar o orçamento para " + corpo.valor }[op] + " na Meta?")) return;
      b.disabled = true;
      try { var r = await chamar(A, "meta-manage-campaign", corpo); if (op === "status") A.toast("Status na Meta: " + (r.atual.effective_status || r.atual.status) + (r.atual.daily_budget ? " · orçamento " + (r.atual.daily_budget / 100) : "")); else { A.toast("Alteração aplicada na Meta."); render(el, A); } }
      catch (x) { A.toast(x.message, true); } b.disabled = false;
    }); });
  }

  async function abaHistorico(c, A) {
    var r = await Promise.all([A.sb.from("meta_audit_logs").select("*").order("criado_em", { ascending: false }).limit(200), A.sb.from("meta_sync_logs").select("*").order("inicio", { ascending: false }).limit(100)]);
    c.innerHTML = '<section class="card"><h3>Alterações em campanhas</h3>' + tabela(["Quando", "Quem", "Objeto", "Ação", "Resultado"], (r[0].data || []).map(function (l) { return [quando(l.criado_em), A.esc(l.membro_nome || "—"), A.esc((l.objeto_tipo || "") + " · " + (l.objeto_nome || l.objeto_id || "")), A.esc(l.acao), l.sucesso ? '<span class="mi-st ok">Aplicada</span>' : '<span class="mi-st er" title="' + A.esc(l.erro || "") + '">Falhou</span>']; })) + "</section>" +
      '<section class="card"><h3>Sincronizações</h3>' + tabela(["Início", "Tipo", "Status", "Linhas", "Detalhe"], (r[1].data || []).map(function (l) { return [quando(l.inicio), A.esc(l.tipo), '<span class="mi-st ' + (l.status === "ok" ? "ok" : l.status === "erro" ? "er" : "pa") + '">' + A.esc(l.status) + "</span>", int(l.linhas), '<small>' + A.esc(String(l.detalhe || "").slice(0, 140)) + "</small>"]; })) + "</section>";
  }

  async function abaConfig(c, A, base) {
    var cfg = await chamar(A, "meta-mi", { acao: "config" });
    var item = function (ok, txt, dica) { return '<li class="' + (ok ? "ok" : "no") + '"><b>' + (ok ? "✓" : "✕") + "</b><span>" + txt + (dica && !ok ? "<small>" + dica + "</small>" : "") + "</span></li>"; };
    c.innerHTML = '<section class="card"><h3>Configuração da integração</h3><ul class="mi-check">' +
      item(!!cfg.app_id, "App Meta (META_APP_ID)" + (cfg.app_id ? ": " + A.esc(cfg.app_id) : ""), "Cadastre nas Secrets do Supabase.") +
      item(cfg.app_secret, "App Secret (META_APP_SECRET)", "Cadastre nas Secrets do Supabase.") +
      item(cfg.chave_cripto, "Chave de criptografia dos tokens (META_TOKEN_ENCRYPTION_KEY, 32+ caracteres)", "Sem ela, nenhum token é salvo.") +
      item(true, "Versão da Graph API: " + A.esc(cfg.versao)) +
      item(true, "URI de redirecionamento: <code>" + A.esc(cfg.redirect) + "</code>", "") +
      item(base.conexoes.some(function (x) { return x.status === "ativa"; }), "Pelo menos um Facebook conectado", "Use “Conectar minha conta Meta Ads”.") +
      item(base.contas.some(function (a) { return a.ativo && a.ultima_sync; }), "Pelo menos uma conta sincronizada com sucesso", "Depende de a Meta liberar o acesso à Marketing API para o app.") +
      '</ul><p class="note">Sincronização automática: campanhas e métricas a cada 30 minutos; consolidação diária dos últimos 7 dias; verificação diária dos tokens.</p>' +
      '<div class="mi-rel"><button class="btn ghost" data-syncall>Sincronizar todas agora</button><button class="btn ghost" data-tokens>Verificar tokens agora</button></div></section>';
    c.querySelector("[data-syncall]").addEventListener("click", async function () { try { await chamar(A, "meta-sync-all", {}); A.toast("Sincronização iniciada em segundo plano."); } catch (x) { A.toast(x.message, true); } });
    c.querySelector("[data-tokens]").addEventListener("click", async function () { try { var r = await chamar(A, "meta-token-refresh", {}); A.toast(r.verificadas + " verificada(s), " + r.renovadas + " renovada(s), " + r.problemas + " com problema."); } catch (x) { A.toast(x.message, true); } });
  }

  D.modulos.push({ id: "marketing", titulo: "Marketing Intelligence", tituloLongo: "DANOVA Marketing Intelligence", icone: "◆", papeis: ["admin", "construtora"], render: function (el, A) { render(el, A).catch(function (x) { el.innerHTML = '<div class="card"><p class="note">Erro: ' + A.esc(x.message || x) + "</p></div>"; }); } });
})();
