/* danova AI — CRM / área de membros */
(function () {
  "use strict";
  var cfg = window.DANOVA_CRM || {};
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });

  var ETAPAS = [
    { id: "novo", nome: "Novo" }, { id: "contato", nome: "Em contato" }, { id: "qualificado", nome: "Qualificado" },
    { id: "visita", nome: "Visita / apresentação" }, { id: "proposta", nome: "Proposta" }, { id: "contrato", nome: "Contrato" },
    { id: "fechado", nome: "Fechado" }, { id: "perdido", nome: "Perdido" }
  ];
  var CORES = { novo: "#3ec5f0", contato: "#6b3fd4", qualificado: "#ec3d8f", visita: "#f7a24a", proposta: "#d4a300", contrato: "#16b8a6", fechado: "#2fa86b", perdido: "#9aa5b4" };
  var ABERTAS = ["novo", "contato", "qualificado", "visita", "proposta", "contrato"];
  var EMPREENDIMENTOS = ["Domus Brickell Park", "Meliá Brickell", "The Residences at 1428 Brickell", "Casa Bella Residences by B&B Italia", "Nobu Residences Brickell", "Faena Residences Miami", "Continuum Club & Residences", "The Residences at Mandarin Oriental, Miami", "Mandarin Oriental Residences West Palm Beach", "Estates by Turnberry", "Quero vender meu imóvel", "Quero cadastrar um empreendimento", "Outro"];

  var S = { user: null, me: null, leads: [], membros: [], view: "painel", busca: "", f: { etapa: "", corretor: "", emp: "", periodo: "" }, aberto: null, canal: null };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function etapaNome(id) { var e = ETAPAS.find(function (x) { return x.id === id; }); return e ? e.nome : id; }
  function tag(id) { return '<span class="tag t-' + esc(id) + '"><i></i>' + esc(etapaNome(id)) + "</span>"; }
  function dt(v, hora) { if (!v) return "—"; var d = new Date(v); return d.toLocaleDateString("pt-BR") + (hora ? " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""); }
  function diasAtras(v) { var d = Math.floor((Date.now() - new Date(v)) / 864e5); return d <= 0 ? "hoje" : d === 1 ? "ontem" : d + " dias"; }
  function money(v) { return v == null || v === "" ? "—" : "US$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); }
  function hojeISO() { return new Date().toISOString().slice(0, 10); }
  function isAdmin() { return S.me && S.me.papel === "admin"; }
  function nomeMembro(id) { var m = S.membros.find(function (x) { return x.id === id; }); return m ? m.nome : ""; }
  var toastT;
  function toast(msg, err) { var t = $("#toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(function () { t.className = "toast"; }, 4200); }
  function falha(e) { console.error(e); toast((e && e.message) || "Não foi possível concluir. Tente novamente.", true); }

  // =============== ACESSO ===============
  function mostrarAuth(modo, msg, tipo) {
    $("#app").hidden = true; $("#pendingScreen").hidden = true; $("#authScreen").hidden = false;
    ["login", "cadastro", "recuperar", "novaSenha"].forEach(function (m) { $("#" + m + "Form").hidden = m !== modo; });
    $("#authTitle").textContent = { login: "Área de membros", cadastro: "Solicitar acesso", recuperar: "Recuperar senha", novaSenha: "Definir nova senha" }[modo];
    var box = $("#authMsg"); box.textContent = msg || ""; box.className = "auth-msg" + (tipo ? " " + tipo : "");
  }
  $$("[data-auth]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); mostrarAuth(a.dataset.auth); }); });

  $("#loginForm").addEventListener("submit", async function (e) {
    e.preventDefault(); var f = new FormData(e.target), b = e.target.querySelector("button"); b.disabled = true;
    var r = await sb.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("senha") });
    b.disabled = false;
    if (r.error) return mostrarAuth("login", r.error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : r.error.message === "Email not confirmed" ? "Confirme seu e-mail pelo link que enviamos antes de entrar." : r.error.message, "err");
  });
  $("#cadastroForm").addEventListener("submit", async function (e) {
    e.preventDefault(); var f = new FormData(e.target), b = e.target.querySelector("button"); b.disabled = true;
    var r = await sb.auth.signUp({ email: f.get("email").trim(), password: f.get("senha"), options: { data: { nome: f.get("nome").trim(), telefone: f.get("telefone").trim() }, emailRedirectTo: location.origin + location.pathname } });
    b.disabled = false;
    if (r.error) return mostrarAuth("cadastro", r.error.message, "err");
    e.target.reset();
    mostrarAuth("login", "Cadastro recebido! Confirme seu e-mail pelo link enviado. Depois, um administrador libera seu acesso.", "ok");
  });
  $("#recuperarForm").addEventListener("submit", async function (e) {
    e.preventDefault(); var f = new FormData(e.target);
    var r = await sb.auth.resetPasswordForEmail(f.get("email").trim(), { redirectTo: location.origin + location.pathname });
    if (r.error) return mostrarAuth("recuperar", r.error.message, "err");
    mostrarAuth("login", "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.", "ok");
  });
  $("#novaSenhaForm").addEventListener("submit", async function (e) {
    e.preventDefault(); var f = new FormData(e.target);
    var r = await sb.auth.updateUser({ password: f.get("senha") });
    if (r.error) return mostrarAuth("novaSenha", r.error.message, "err");
    toast("Senha atualizada."); iniciar();
  });
  $$("[data-action=sair]").forEach(function (b) { b.addEventListener("click", async function () { await sb.auth.signOut(); location.reload(); }); });

  var recuperando = false;
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "PASSWORD_RECOVERY") { recuperando = true; mostrarAuth("novaSenha"); }
    else if (ev === "SIGNED_IN" && !recuperando && !S.me) { iniciar(); }
  });

  async function iniciar() {
    var s = (await sb.auth.getSession()).data.session;
    if (!s) return mostrarAuth("login");
    S.user = s.user;
    var r = await sb.from("membros").select("*").eq("id", S.user.id).maybeSingle();
    if (r.error) return falha(r.error);
    if (!r.data) return mostrarAuth("login", "Perfil não encontrado. Fale com um administrador.", "err");
    S.me = r.data;
    if (!S.me.ativo) { $("#authScreen").hidden = true; $("#pendingScreen").hidden = false; $("#pendingName").textContent = S.me.nome; return; }
    $("#authScreen").hidden = true; $("#pendingScreen").hidden = true; $("#app").hidden = false;
    $("#meNome").textContent = S.me.nome || S.me.email;
    $("#mePapel").textContent = isAdmin() ? "Administrador" : "Corretor";
    $$("[data-admin]").forEach(function (el) { el.hidden = !isAdmin(); });
    await carregar();
    tempoReal();
    var v = (location.hash || "").replace("#", "");
    irPara(["painel", "funil", "leads", "corretores", "conta"].indexOf(v) >= 0 && (v !== "corretores" || isAdmin()) ? v : "painel");
  }

  async function carregar() {
    var a = await sb.from("leads_resumo").select("*").order("criado_em", { ascending: false }).limit(5000);
    if (a.error) return falha(a.error);
    S.leads = a.data || [];
    var b = await sb.from("membros").select("*").order("nome");
    if (b.error) return falha(b.error);
    S.membros = b.data || [];
  }

  function tempoReal() {
    if (S.canal) return;
    S.canal = sb.channel("leads-crm")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, async function (p) {
        toast("Novo lead: " + (p.new.nome || p.new.email || p.new.telefone));
        await carregar(); render();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads" }, async function () { await carregar(); if (!S.aberto) render(); })
      .subscribe();
  }

  // =============== NAVEGAÇÃO ===============
  var TITULOS = { painel: "Painel", funil: "Funil de vendas", leads: "Leads", corretores: "Corretores", conta: "Minha conta" };
  function irPara(v) {
    S.view = v; history.replaceState(null, "", "#" + v);
    $$(".side-nav button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === v); });
    $$(".view").forEach(function (el) { el.hidden = el.id !== "view-" + v; });
    $("#viewTitle").textContent = TITULOS[v];
    $("#side").classList.remove("open");
    render();
  }
  $$(".side-nav button").forEach(function (b) { b.addEventListener("click", function () { irPara(b.dataset.view); }); });
  $("#menuBtn").addEventListener("click", function () { $("#side").classList.toggle("open"); });
  $("#busca").addEventListener("input", function (e) { S.busca = e.target.value.trim().toLowerCase(); if (S.view === "painel" || S.view === "corretores" || S.view === "conta") irPara("leads"); else render(); });
  $("[data-action=novo-lead]").addEventListener("click", function () { abrirLead(null); });

  function filtrados() {
    var q = S.busca, f = S.f, lim = f.periodo ? Date.now() - Number(f.periodo) * 864e5 : 0;
    return S.leads.filter(function (l) {
      if (q && [l.nome, l.email, l.telefone, l.empreendimento, l.corretor_nome].join(" ").toLowerCase().indexOf(q) < 0) return false;
      if (f.etapa && l.etapa !== f.etapa) return false;
      if (f.corretor === "_sem" && l.corretor_id) return false;
      if (f.corretor && f.corretor !== "_sem" && l.corretor_id !== f.corretor) return false;
      if (f.emp && l.empreendimento !== f.emp) return false;
      if (lim && new Date(l.criado_em) < lim) return false;
      return true;
    });
  }
  function render() {
    if (!S.me) return;
    ({ painel: rPainel, funil: rFunil, leads: rLeads, corretores: rCorretores, conta: rConta })[S.view]();
  }

  // =============== PAINEL ===============
  function contar(arr, fn) { var o = {}; arr.forEach(function (x) { var k = fn(x) || "Não informado"; o[k] = (o[k] || 0) + 1; }); return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function barras(pares, cor, max) {
    if (!pares.length) return '<div class="empty">Sem dados ainda.</div>';
    max = max || Math.max.apply(null, pares.map(function (p) { return p[1]; }));
    return '<div class="bars">' + pares.map(function (p) {
      var c = typeof cor === "function" ? cor(p[0]) : cor;
      return '<div class="bar-row"><span title="' + esc(p[0]) + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p[2] || p[0]) + '</span><div class="track"><div class="fill" style="width:' + (max ? (p[1] / max * 100) : 0).toFixed(1) + "%;background:" + c + '"></div></div><b>' + p[1] + "</b></div>";
    }).join("") + "</div>";
  }
  function rPainel() {
    var L = S.leads, agora = Date.now();
    var novos7 = L.filter(function (l) { return agora - new Date(l.criado_em) < 7 * 864e5; }).length;
    var abertos = L.filter(function (l) { return ABERTAS.indexOf(l.etapa) >= 0; });
    var fechados = L.filter(function (l) { return l.etapa === "fechado"; });
    var decididos = fechados.length + L.filter(function (l) { return l.etapa === "perdido"; }).length;
    var pipeline = abertos.reduce(function (s, l) { return s + (Number(l.valor_estimado) || 0); }, 0);
    var semDono = L.filter(function (l) { return !l.corretor_id && ABERTAS.indexOf(l.etapa) >= 0; }).length;

    var porEtapa = ETAPAS.map(function (e) { return [e.id, L.filter(function (l) { return l.etapa === e.id; }).length, e.nome]; });
    var dias = []; for (var i = 29; i >= 0; i--) { var d = new Date(agora - i * 864e5).toISOString().slice(0, 10); dias.push([d, 0]); }
    L.forEach(function (l) { var k = new Date(l.criado_em).toISOString().slice(0, 10); var x = dias.find(function (p) { return p[0] === k; }); if (x) x[1]++; });
    var maxD = Math.max(1, Math.max.apply(null, dias.map(function (p) { return p[1]; })));
    var limite = new Date(agora + 7 * 864e5).toISOString().slice(0, 10);
    var agenda = abertos.filter(function (l) { return l.proximo_contato && l.proximo_contato <= limite; }).sort(function (a, b) { return a.proximo_contato < b.proximo_contato ? -1 : 1; }).slice(0, 8);
    var parados = abertos.filter(function (l) { return agora - new Date(l.atualizado_em) > 5 * 864e5; }).length;

    $("#view-painel").innerHTML =
      '<div class="kpis">' +
      kpi("Leads no total", L.length, novos7 + " nos últimos 7 dias") +
      kpi("Em negociação", abertos.length, semDono ? semDono + " sem corretor" : "todos atribuídos") +
      kpi("Fechados", fechados.length, decididos ? "conversão " + Math.round(fechados.length / decididos * 100) + "%" : "conversão —") +
      kpi("Pipeline estimado", pipeline ? money(pipeline) : "—", "soma dos leads abertos") +
      kpi("Sem atualização", parados, "abertos há 5+ dias") + "</div>" +
      '<div class="grid2">' +
      '<div class="card"><h3>Leads por dia <small>últimos 30 dias</small></h3><div class="spark">' + dias.map(function (p) { return '<i title="' + esc(dt(p[0])) + ": " + p[1] + '" style="height:' + (p[1] / maxD * 100) + '%"></i>'; }).join("") + '</div><div class="spark-axis"><span>' + dt(dias[0][0]) + "</span><span>hoje</span></div></div>" +
      '<div class="card"><h3>Funil <small>leads por etapa</small></h3>' + barras(porEtapa, function (k) { return CORES[k]; }) + "</div>" +
      '<div class="card"><h3>Empreendimentos mais procurados</h3>' + barras(contar(L, function (l) { return l.empreendimento; }).slice(0, 8), "linear-gradient(90deg,#3ec5f0,#6b3fd4)") + "</div>" +
      '<div class="card"><h3>Próximos contatos <small>até 7 dias</small></h3>' + (agenda.length ? '<div class="list">' + agenda.map(function (l) {
        var atrasado = l.proximo_contato < hojeISO();
        return '<div class="list-item" data-lead="' + l.id + '"><div><strong>' + esc(l.nome || l.email) + "</strong><br><small>" + esc(l.proximo_passo || "Sem próximo passo definido") + '</small></div><small class="' + (atrasado ? "temp quente" : "") + '">' + (atrasado ? "atrasado · " : "") + dt(l.proximo_contato) + "</small></div>";
      }).join("") + "</div>" : '<div class="empty">Nenhum contato agendado.</div>') + "</div>" +
      '<div class="card"><h3>Origem dos leads</h3>' + barras(contar(L, function (l) { return l.canal; }).slice(0, 6), "#f7a24a") + "</div>" +
      '<div class="card"><h3>Perfil dos leads</h3>' + barras(contar(L, function (l) { return l.perfil; }).slice(0, 6), "#ec3d8f") + "</div>" +
      "</div>";
    ligarAberturas($("#view-painel"));
  }
  function kpi(t, v, s) { return '<div class="kpi"><small>' + esc(t) + "</small><strong>" + esc(v) + "</strong><span>" + esc(s) + "</span></div>"; }
  function ligarAberturas(root) { $$("[data-lead]", root).forEach(function (el) { el.addEventListener("click", function () { abrirLead(el.dataset.lead); }); }); }

  // =============== FUNIL ===============
  function rFunil() {
    var L = filtrados();
    $("#view-funil").innerHTML = filtrosHTML(false) + '<div class="kanban">' + ETAPAS.map(function (e) {
      var itens = L.filter(function (l) { return l.etapa === e.id; });
      var soma = itens.reduce(function (s, l) { return s + (Number(l.valor_estimado) || 0); }, 0);
      return '<div class="col" data-etapa="' + e.id + '"><div class="col-head">' + tag(e.id) + "<small>" + itens.length + (soma ? " · " + money(soma) : "") + "</small></div>" +
        itens.slice(0, 200).map(function (l) {
          var atras = l.proximo_contato && l.proximo_contato < hojeISO() && ABERTAS.indexOf(l.etapa) >= 0;
          return '<div class="kcard" draggable="true" data-id="' + l.id + '"><strong>' + esc(l.nome || l.email || l.telefone) + '</strong><div class="meta">' + esc(l.empreendimento || "Empreendimento não informado") + '</div><div class="foot"><span>' + esc(l.corretor_nome || "Sem corretor") + "</span>" +
            (atras ? '<span class="due">contato atrasado</span>' : l.temperatura ? '<span class="temp ' + l.temperatura + '">' + l.temperatura + "</span>" : "<span>" + diasAtras(l.criado_em) + "</span>") + "</div></div>";
        }).join("") + "</div>";
    }).join("") + "</div>";
    ligarFiltros($("#view-funil"));
    $$(".kcard").forEach(function (c) {
      c.addEventListener("click", function () { abrirLead(c.dataset.id); });
      c.addEventListener("dragstart", function (e) { c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.id); });
      c.addEventListener("dragend", function () { c.classList.remove("dragging"); });
    });
    $$(".col").forEach(function (col) {
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", function () { col.classList.remove("over"); });
      col.addEventListener("drop", async function (e) {
        e.preventDefault(); col.classList.remove("over");
        var id = e.dataTransfer.getData("text/plain"), etapa = col.dataset.etapa, l = S.leads.find(function (x) { return x.id === id; });
        if (!l || l.etapa === etapa) return;
        var antes = l.etapa; l.etapa = etapa; rFunil();
        var r = await sb.from("leads").update({ etapa: etapa }).eq("id", id);
        if (r.error) { l.etapa = antes; rFunil(); return falha(r.error); }
        toast(esc(l.nome || "Lead") + " → " + etapaNome(etapa));
        if (etapa === "perdido") abrirLead(id, "motivo_perda");
      });
    });
  }

  // =============== LISTA ===============
  function filtrosHTML(comExport) {
    var f = S.f;
    return '<div class="filters">' +
      '<select data-f="etapa"><option value="">Todas as etapas</option>' + ETAPAS.map(function (e) { return '<option value="' + e.id + '"' + (f.etapa === e.id ? " selected" : "") + ">" + e.nome + "</option>"; }).join("") + "</select>" +
      (isAdmin() ? '<select data-f="corretor"><option value="">Todos os corretores</option><option value="_sem"' + (f.corretor === "_sem" ? " selected" : "") + ">Sem corretor</option>" + S.membros.filter(function (m) { return m.ativo; }).map(function (m) { return '<option value="' + m.id + '"' + (f.corretor === m.id ? " selected" : "") + ">" + esc(m.nome) + "</option>"; }).join("") + "</select>" : "") +
      '<select data-f="emp"><option value="">Todos os empreendimentos</option>' + EMPREENDIMENTOS.map(function (n) { return '<option' + (f.emp === n ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select>" +
      '<select data-f="periodo"><option value="">Todo o período</option>' + [[7, "Últimos 7 dias"], [30, "Últimos 30 dias"], [90, "Últimos 90 dias"]].map(function (p) { return '<option value="' + p[0] + '"' + (String(f.periodo) === String(p[0]) ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select>" +
      '<span class="spacer"></span>' + (comExport ? '<button class="btn ghost small" data-action="csv">Exportar CSV</button>' : "") + "</div>";
  }
  function ligarFiltros(root) {
    $$("[data-f]", root).forEach(function (s) { s.addEventListener("change", function () { S.f[s.dataset.f] = s.value; render(); }); });
    var c = $("[data-action=csv]", root); if (c) c.addEventListener("click", exportarCSV);
  }
  function rLeads() {
    var L = filtrados();
    $("#view-leads").innerHTML = filtrosHTML(true) + '<div class="table-wrap"><table><thead><tr><th>Lead</th><th class="hide-sm">Empreendimento</th><th>Etapa</th><th class="hide-sm">Corretor</th><th class="hide-sm">Próximo contato</th><th class="hide-sm">Recebido</th></tr></thead><tbody>' +
      (L.length ? L.slice(0, 1000).map(function (l) {
        return '<tr data-lead="' + l.id + '"><td><strong>' + esc(l.nome || "—") + '</strong><span class="sub">' + esc([l.email, l.telefone].filter(Boolean).join(" · ")) + '</span></td><td class="hide-sm">' + esc(l.empreendimento || "—") + "<span class=sub>" + esc(l.perfil || "") + "</span></td><td>" + tag(l.etapa) + (l.temperatura ? ' <span class="temp ' + l.temperatura + '">' + l.temperatura + "</span>" : "") + '</td><td class="hide-sm">' + esc(l.corretor_nome || "—") + '</td><td class="hide-sm">' + (l.proximo_contato ? dt(l.proximo_contato) : "—") + '</td><td class="hide-sm">' + dt(l.criado_em) + '<span class="sub">' + esc(l.canal || "") + "</span></td></tr>";
      }).join("") : '<tr><td colspan="6"><div class="empty">Nenhum lead encontrado.</div></td></tr>') + "</tbody></table></div>" +
      '<p class="note" style="margin-top:10px">' + L.length + " lead(s)" + (L.length > 1000 ? " · mostrando os 1.000 mais recentes" : "") + "</p>";
    ligarFiltros($("#view-leads")); ligarAberturas($("#view-leads"));
  }
  function exportarCSV() {
    var cols = ["criado_em", "nome", "email", "telefone", "perfil", "empreendimento", "objetivo", "etapa", "temperatura", "valor_estimado", "corretor_nome", "proximo_passo", "proximo_contato", "canal", "origem", "mensagem"];
    var linhas = [cols.join(";")].concat(filtrados().map(function (l) {
      return cols.map(function (c) { var v = l[c] == null ? "" : String(l[c]); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""').replace(/\r?\n/g, " ") + '"'; }).join(";");
    }));
    var blob = new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "leads-danova-" + hojeISO() + ".csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  // =============== CORRETORES ===============
  function rCorretores() {
    if (!isAdmin()) return;
    var rows = S.membros.slice().sort(function (a, b) { return (a.ativo === b.ativo ? 0 : a.ativo ? 1 : -1) || (a.nome || "").localeCompare(b.nome || ""); }).map(function (m) {
      var meus = S.leads.filter(function (l) { return l.corretor_id === m.id; });
      var ab = meus.filter(function (l) { return ABERTAS.indexOf(l.etapa) >= 0; }).length;
      var fe = meus.filter(function (l) { return l.etapa === "fechado"; }).length;
      var pe = meus.filter(function (l) { return l.etapa === "perdido"; }).length;
      var eu = m.id === S.me.id;
      return '<tr class="' + (m.ativo ? "" : "pending-row") + '"><td><strong>' + esc(m.nome) + (eu ? " (você)" : "") + '</strong><span class="sub">' + esc(m.email) + (m.telefone ? " · " + esc(m.telefone) : "") + "</span>" + (m.ativo ? "" : '<span class="sub" style="color:#c06a12;font-weight:700">Aguardando aprovação</span>') + "</td>" +
        '<td><select data-papel="' + m.id + '"' + (eu ? " disabled" : "") + '><option value="corretor"' + (m.papel === "corretor" ? " selected" : "") + '>Corretor</option><option value="admin"' + (m.papel === "admin" ? " selected" : "") + ">Administrador</option></select></td>" +
        '<td><label class="switch" title="Acesso liberado"><input type="checkbox" data-ativo="' + m.id + '"' + (m.ativo ? " checked" : "") + (eu ? " disabled" : "") + "><span></span></label></td>" +
        "<td>" + meus.length + '</td><td class="hide-sm">' + ab + '</td><td class="hide-sm">' + fe + '</td><td class="hide-sm">' + (fe + pe ? Math.round(fe / (fe + pe) * 100) + "%" : "—") + "</td>" +
        '<td><button class="btn ghost small" data-ver="' + m.id + '">Ver leads</button></td></tr>';
    }).join("");
    var pend = S.membros.filter(function (m) { return !m.ativo; }).length;
    $("#view-corretores").innerHTML =
      '<div class="card" style="margin-bottom:16px"><h3>Como adicionar um corretor</h3><p class="muted" style="margin:0">Envie o link <strong>' + esc(location.origin + location.pathname) + '</strong> e peça para clicar em “Sou corretor · solicitar acesso”. O cadastro aparece aqui como pendente' + (pend ? " — há <strong>" + pend + "</strong> aguardando agora" : "") + '. Ative a chave para liberar o acesso. Cada corretor vê apenas os leads atribuídos a ele.</p></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Membro</th><th>Papel</th><th>Acesso</th><th>Leads</th><th class="hide-sm">Abertos</th><th class="hide-sm">Fechados</th><th class="hide-sm">Conversão</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    $$("[data-ativo]").forEach(function (i) { i.addEventListener("change", async function () {
      var r = await sb.from("membros").update({ ativo: i.checked }).eq("id", i.dataset.ativo);
      if (r.error) { i.checked = !i.checked; return falha(r.error); }
      toast(i.checked ? "Acesso liberado." : "Acesso suspenso."); await carregar(); rCorretores();
    }); });
    $$("[data-papel]").forEach(function (s) { s.addEventListener("change", async function () {
      var r = await sb.from("membros").update({ papel: s.value }).eq("id", s.dataset.papel);
      if (r.error) return falha(r.error); toast("Papel atualizado."); await carregar(); rCorretores();
    }); });
    $$("[data-ver]").forEach(function (b) { b.addEventListener("click", function () { S.f.corretor = b.dataset.ver; irPara("leads"); }); });
  }

  // =============== CONTA ===============
  function rConta() {
    var m = S.me;
    $("#view-conta").innerHTML = '<div class="grid2"><form class="card stack" id="contaForm"><h3>Seus dados</h3>' +
      '<label>Nome<input name="nome" value="' + esc(m.nome) + '" required></label><label>WhatsApp<input name="telefone" value="' + esc(m.telefone || "") + '"></label>' +
      '<label>Licença / CRECI<input name="licenca" value="' + esc(m.licenca || "") + '"></label><label>E-mail<input value="' + esc(m.email) + '" disabled></label><button class="btn primary">Salvar</button></form>' +
      '<form class="card stack" id="senhaForm"><h3>Trocar senha</h3><label>Nova senha<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label><button class="btn primary">Atualizar senha</button></form></div>';
    $("#contaForm").addEventListener("submit", async function (e) {
      e.preventDefault(); var f = new FormData(e.target);
      var dados = { nome: f.get("nome").trim(), telefone: f.get("telefone").trim() || null, licenca: f.get("licenca").trim() || null };
      var r = await sb.from("membros").update(dados).eq("id", m.id);
      if (r.error) return falha(r.error); Object.assign(S.me, dados); $("#meNome").textContent = dados.nome; toast("Dados salvos.");
    });
    $("#senhaForm").addEventListener("submit", async function (e) {
      e.preventDefault(); var r = await sb.auth.updateUser({ password: new FormData(e.target).get("senha") });
      if (r.error) return falha(r.error); e.target.reset(); toast("Senha atualizada.");
    });
  }

  // =============== LEAD (gaveta) ===============
  function fecharGaveta() { $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); $("#drawerBg").hidden = true; S.aberto = null; render(); }
  $("#drawerBg").addEventListener("click", fecharGaveta);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && S.aberto) fecharGaveta(); });

  async function abrirLead(id, focar) {
    var novo = !id, l = novo ? { etapa: "novo", corretor_id: isAdmin() ? null : S.me.id } : S.leads.find(function (x) { return x.id === id; });
    if (!l) return;
    S.aberto = id || "novo";
    var ev = [];
    if (!novo) { var r = await sb.from("lead_eventos").select("*").eq("lead_id", id).order("criado_em", { ascending: false }); if (r.error) falha(r.error); ev = r.data || []; }
    var idx = ETAPAS.findIndex(function (e) { return e.id === l.etapa; });
    var fone = (l.telefone || "").replace(/\D/g, "");
    var D = $("#drawer");
    D.innerHTML =
      '<div class="d-head"><div><h3>' + (novo ? "Novo lead" : esc(l.nome || "Lead sem nome")) + '</h3><div class="sub">' + (novo ? "Cadastro manual" : "Recebido em " + dt(l.criado_em, true) + (l.origem ? " · " + esc(l.origem) : "")) + '</div></div><button class="icon-btn" data-close aria-label="Fechar">✕</button></div>' +
      (novo ? "" : '<div class="d-quick">' +
        (fone ? '<a class="btn small primary" target="_blank" rel="noopener" data-contato="WhatsApp" href="https://wa.me/' + fone + "?text=" + encodeURIComponent("Olá " + (l.nome || "").split(" ")[0] + ", aqui é " + (S.me.nome || "").split(" ")[0] + " da danova AI.") + '">WhatsApp</a>' : "") +
        (l.email ? '<a class="btn small ghost" data-contato="E-mail" href="mailto:' + esc(l.email) + "?subject=" + encodeURIComponent("danova AI · " + (l.empreendimento || "sua solicitação")) + '">E-mail</a>' : "") +
        (fone ? '<a class="btn small ghost" data-contato="Ligação" href="tel:+' + fone + '">Ligar</a>' : "") + "</div>") +
      '<form class="d-body" id="leadForm">' +
      (novo ? "" : '<div><div class="steps">' + ETAPAS.filter(function (e) { return e.id !== "perdido"; }).map(function (e, i) { return '<button type="button" title="' + e.nome + '" data-etapa="' + e.id + '" class="' + (l.etapa === e.id ? "cur" : (idx > i && l.etapa !== "perdido") ? "done" : "") + '"></button>'; }).join("") + '</div><div class="steps-label"><span>Novo</span><span>' + tag(l.etapa) + "</span><span>Fechado</span></div></div>") +
      '<div class="section-title">Andamento</div><div class="fgrid">' +
      '<label>Etapa<select name="etapa">' + ETAPAS.map(function (e) { return '<option value="' + e.id + '"' + (l.etapa === e.id ? " selected" : "") + ">" + e.nome + "</option>"; }).join("") + "</select></label>" +
      '<label>Temperatura<select name="temperatura"><option value="">—</option>' + ["quente", "morno", "frio"].map(function (t) { return '<option value="' + t + '"' + (l.temperatura === t ? " selected" : "") + ">" + t[0].toUpperCase() + t.slice(1) + "</option>"; }).join("") + "</select></label>" +
      (isAdmin() ? '<label>Corretor responsável<select name="corretor_id"><option value="">Sem corretor</option>' + S.membros.filter(function (m) { return m.ativo; }).map(function (m) { return '<option value="' + m.id + '"' + (l.corretor_id === m.id ? " selected" : "") + ">" + esc(m.nome) + "</option>"; }).join("") + "</select></label>" : '<label>Corretor responsável<input value="' + esc(l.corretor_nome || S.me.nome) + '" disabled></label>') +
      '<label>Valor estimado (US$)<input name="valor_estimado" type="number" min="0" step="1000" value="' + esc(l.valor_estimado == null ? "" : l.valor_estimado) + '"></label>' +
      '<label class="full">Próximo passo<input name="proximo_passo" value="' + esc(l.proximo_passo || "") + '" placeholder="Ex.: enviar plantas do Faena e agendar Zoom"></label>' +
      '<label>Data do próximo contato<input name="proximo_contato" type="date" value="' + esc(l.proximo_contato || "") + '"></label>' +
      '<label' + (l.etapa === "perdido" || focar === "motivo_perda" ? "" : " hidden") + ' id="motivoWrap">Motivo da perda<input name="motivo_perda" value="' + esc(l.motivo_perda || "") + '"></label>' +
      '</div><div class="section-title">Contato e interesse</div><div class="fgrid">' +
      '<label>Nome<input name="nome" value="' + esc(l.nome || "") + '"' + (novo ? " required" : "") + "></label>" +
      '<label>E-mail<input name="email" type="email" value="' + esc(l.email || "") + '"></label>' +
      '<label>Telefone / WhatsApp<input name="telefone" value="' + esc(l.telefone || "") + '"></label>' +
      '<label>País<input name="pais" value="' + esc(l.pais || "") + '"></label>' +
      '<label>Perfil<select name="perfil"><option value="">—</option>' + ["Investidor ou comprador", "Corretor de imóveis", "Imobiliária", "Construtora ou incorporadora", "Family office", "Outro"].map(function (p) { return "<option" + (l.perfil === p ? " selected" : "") + ">" + p + "</option>"; }).join("") + "</select></label>" +
      '<label>Empreendimento<select name="empreendimento"><option value="">—</option>' + EMPREENDIMENTOS.concat(l.empreendimento && EMPREENDIMENTOS.indexOf(l.empreendimento) < 0 ? [l.empreendimento] : []).map(function (p) { return "<option" + (l.empreendimento === p ? " selected" : "") + ">" + esc(p) + "</option>"; }).join("") + "</select></label>" +
      '<label>Objetivo<input name="objetivo" value="' + esc(l.objetivo || "") + '"></label>' +
      '<label>Orçamento<input name="orcamento" value="' + esc(l.orcamento || "") + '"></label>' +
      '<label class="full">Mensagem / observações<textarea name="mensagem">' + esc(l.mensagem || "") + "</textarea></label></div>" +
      '<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap"><button class="btn primary" type="submit">' + (novo ? "Cadastrar lead" : "Salvar alterações") + "</button>" + (!novo && isAdmin() ? '<button class="btn danger" type="button" data-apagar>Excluir lead</button>' : "") + "</div>" +
      (novo ? "" : '<div class="section-title">Histórico</div><div class="note-box"><textarea id="novaNota" placeholder="Registrar ligação, reunião, envio de material…"></textarea><button class="btn primary" type="button" data-nota>Anotar</button></div><ul class="timeline">' + ev.map(evHTML).join("") + "</ul>" +
        (l.utm && Object.keys(l.utm).length ? '<div class="section-title">Origem do contato</div><dl class="kv">' + Object.keys(l.utm).map(function (k) { return "<dt>" + esc(k.replace(/_/g, " ")) + "</dt><dd>" + esc(l.utm[k]) + "</dd>"; }).join("") + "</dl>" : "")) +
      "</form>";
    $("#drawerBg").hidden = false; D.classList.add("open"); D.setAttribute("aria-hidden", "false");
    $("[data-close]", D).addEventListener("click", fecharGaveta);
    var form = $("#leadForm", D);
    form.etapa.addEventListener("change", function () { $("#motivoWrap").hidden = form.etapa.value !== "perdido"; });
    $$("[data-etapa]", D).forEach(function (b) { b.addEventListener("click", function () { form.etapa.value = b.dataset.etapa; $("#motivoWrap").hidden = true; form.requestSubmit(); }); });
    if (focar) { var el = form.querySelector("[name=" + focar + "]"); if (el) setTimeout(function () { el.focus(); }, 300); }
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = new FormData(form), dados = {};
      ["etapa", "temperatura", "proximo_passo", "proximo_contato", "motivo_perda", "nome", "email", "telefone", "pais", "perfil", "empreendimento", "objetivo", "orcamento", "mensagem", "valor_estimado"].forEach(function (k) {
        if (!f.has(k)) return; var v = String(f.get(k)).trim(); dados[k] = v === "" ? null : v;
      });
      if (dados.nome == null) dados.nome = "";
      if (isAdmin()) dados.corretor_id = f.get("corretor_id") || null;
      if (!dados.email && !dados.telefone) return toast("Informe e-mail ou telefone.", true);
      var r;
      if (novo) {
        dados.origem = "Cadastro manual"; dados.canal = "manual";
        if (!isAdmin()) dados.corretor_id = S.me.id;
        r = await sb.from("leads").insert(dados).select().single();
        if (!r.error) await sb.from("lead_eventos").insert({ lead_id: r.data.id, autor_id: S.me.id, tipo: "nota", texto: "Lead cadastrado manualmente por " + S.me.nome });
      } else r = await sb.from("leads").update(dados).eq("id", id);
      if (r.error) return falha(r.error);
      toast(novo ? "Lead cadastrado." : "Alterações salvas.");
      await carregar();
      if (novo) { fecharGaveta(); } else abrirLead(id);
    });
    if (!novo) {
      $("[data-nota]", D).addEventListener("click", async function () {
        var t = $("#novaNota").value.trim(); if (!t) return;
        var r = await sb.from("lead_eventos").insert({ lead_id: id, autor_id: S.me.id, tipo: "nota", texto: t });
        if (r.error) return falha(r.error); abrirLead(id);
      });
      $$("[data-contato]", D).forEach(function (a) { a.addEventListener("click", function () {
        sb.from("lead_eventos").insert({ lead_id: id, autor_id: S.me.id, tipo: "contato", texto: a.dataset.contato }).then(function () {});
        if (l.etapa === "novo") sb.from("leads").update({ etapa: "contato" }).eq("id", id).then(function () { carregar(); });
      }); });
      var ap = $("[data-apagar]", D);
      if (ap) ap.addEventListener("click", async function () {
        if (ap.dataset.confirm !== "1") { ap.dataset.confirm = "1"; ap.textContent = "Confirmar exclusão"; return; }
        var r = await sb.from("leads").delete().eq("id", id);
        if (r.error) return falha(r.error); toast("Lead excluído."); await carregar(); fecharGaveta();
      });
    }
  }
  function evHTML(e) {
    var autor = e.autor_id ? nomeMembro(e.autor_id) || "Membro" : "Sistema";
    var txt = e.tipo === "etapa" ? "Etapa: " + etapaNome(e.de_etapa) + " → <strong>" + esc(etapaNome(e.para_etapa)) + "</strong>"
      : e.tipo === "atribuicao" ? "Atribuído a <strong>" + esc(e.texto) + "</strong>"
      : e.tipo === "contato" ? "Contato por " + esc(e.texto)
      : e.tipo === "criado" ? esc(e.texto || "Lead criado") : esc(e.texto);
    return '<li class="' + esc(e.tipo) + '">' + txt + "<small>" + esc(autor) + " · " + dt(e.criado_em, true) + "</small></li>";
  }

  iniciar();
})();
