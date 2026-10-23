/* danova AI — Dashboard do administrador (tempo real).
   Período com comparação, KPIs animados com minigráficos, leads por dia por canal, funil com conversão,
   origem, ranking de corretores, empreendimentos, mapa de calor de horários, alertas e feed ao vivo.
   Carregado antes do crm.js; só aparece para administradores. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];

  var CORES = { meta: "#6b3fd4", google: "#3ec5f0", seo: "#16b8a6", ia: "#ec3d8f", direto: "#94a3b8", outro: "#f7a24a" };
  var NOMES_CANAL = { meta: "Meta Ads", google: "Google Ads", seo: "SEO / orgânico", ia: "Chat de IA", direto: "Direto", outro: "Outros" };
  var PERIODOS = [["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["365", "12 meses"]];
  var QUALIF = ["qualificado", "visita", "proposta", "contrato", "fechado"];
  var DIA = 864e5;
  var st = { periodo: "30", metrica: "leads", extras: null, carregadoEm: 0, canal: null, timer: null, relogio: null, fila: null, el: null, A: null };

  function canalDe(l) {
    var c = String(l.canal || l.origem || "direto").toLowerCase();
    if (/face|insta|meta|fb|ig|paid-social/.test(c)) return "meta";
    if (/google|gclid|youtube|cpc/.test(c)) return "google";
    if (/chat-ia|atendente/.test(c)) return "ia";
    if (/organic|seo|bing|chatgpt|perplexity|duckduckgo|yahoo/.test(c)) return "seo";
    if (c === "direto" || c === "(direct)" || c === "home" || !c) return "direto";
    return "outro";
  }
  function intervalo(p) {
    var fim = Date.now(), ini;
    if (p === "hoje") { var d = new Date(); d.setHours(0, 0, 0, 0); ini = d.getTime(); }
    else ini = fim - Number(p) * DIA;
    return { ini: ini, fim: fim, antIni: ini - (fim - ini), antFim: ini };
  }
  function dentro(v, a, b) { var t = new Date(v).getTime(); return t >= a && t < b; }
  function fmtNum(v) { return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); }
  function fmtUSD(v) {
    v = Number(v || 0);
    if (v >= 1e6) return "US$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
    if (v >= 1e3) return "US$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil";
    return "US$ " + fmtNum(v);
  }
  function rel(t) {
    var s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "agora"; if (s < 3600) return Math.floor(s / 60) + " min";
    if (s < 86400) return Math.floor(s / 3600) + " h"; return Math.floor(s / 86400) + " d";
  }
  function delta(atual, ant) {
    if (!ant && !atual) return '<em class="dl neutro">—</em>';
    if (!ant) return '<em class="dl sobe">novo</em>';
    var p = Math.round((atual - ant) / ant * 100);
    return '<em class="dl ' + (p > 0 ? "sobe" : p < 0 ? "desce" : "neutro") + '">' + (p > 0 ? "▲ " : p < 0 ? "▼ " : "") + Math.abs(p) + "%</em>";
  }

  // ---------- séries por período ----------
  function baldes(iv, periodo) {
    var b = [], passo = periodo === "hoje" ? 3600e3 : periodo === "365" ? 7 * DIA : DIA;
    var ini = iv.ini;
    if (periodo !== "hoje") { var d = new Date(ini); d.setHours(0, 0, 0, 0); ini = d.getTime() + (periodo === "365" ? 0 : DIA); }
    for (var t = ini; t < iv.fim; t += passo) b.push({ ini: t, fim: t + passo });
    if (!b.length) b.push({ ini: iv.ini, fim: iv.fim });
    return b;
  }
  function rotulo(t, periodo) {
    var d = new Date(t);
    if (periodo === "hoje") return d.getHours() + "h";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  // ---------- SVG ----------
  function spark(vals, cor) {
    var w = 120, h = 34, n = vals.length, max = Math.max.apply(null, vals.concat([1]));
    if (n < 2) return "";
    var pts = vals.map(function (v, i) { return (i / (n - 1) * w).toFixed(1) + "," + (h - 3 - v / max * (h - 6)).toFixed(1); });
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none"><polyline points="0,' + h + " " + pts.join(" ") + " " + w + "," + h + '" fill="' + cor + '22" stroke="none"/><polyline points="' + pts.join(" ") + '" fill="none" stroke="' + cor + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
  }
  function donut(fatias) {
    var total = fatias.reduce(function (s, f) { return s + f.v; }, 0), r = 52, c = 2 * Math.PI * r, acc = 0;
    var arcs = total ? fatias.map(function (f) {
      var len = f.v / total * c, s = '<circle r="' + r + '" cx="70" cy="70" fill="none" stroke="' + f.cor + '" stroke-width="18" stroke-dasharray="' + len.toFixed(2) + " " + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" class="arc"><title>' + f.nome + ": " + f.v + "</title></circle>";
      acc += len; return s;
    }).join("") : '<circle r="' + r + '" cx="70" cy="70" fill="none" stroke="#eef2f6" stroke-width="18"/>';
    return '<svg viewBox="0 0 140 140" class="donut"><g transform="rotate(-90 70 70)">' + arcs + '</g><text x="70" y="68" text-anchor="middle" class="dn-n">' + fmtNum(total) + '</text><text x="70" y="86" text-anchor="middle" class="dn-l">leads</text></svg>';
  }
  function grafico(bs, series, periodo) {
    var w = 760, h = 230, pl = 34, pb = 26, pt = 10, n = bs.length;
    var tot = bs.map(function (_, i) { return series.reduce(function (s, se) { return s + se.vals[i]; }, 0); });
    var max = Math.max.apply(null, tot.concat([4])); max = Math.ceil(max / 4) * 4;
    var bw = (w - pl - 8) / n, gx = function (i) { return pl + i * bw; }, gy = function (v) { return h - pb - v / max * (h - pb - pt); };
    var grid = [0, .25, .5, .75, 1].map(function (f) { var y = gy(max * f); return '<line x1="' + pl + '" x2="' + w + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ax">' + Math.round(max * f) + "</text>"; }).join("");
    var barras = bs.map(function (_, i) {
      var y0 = h - pb, out = "";
      series.forEach(function (se) {
        var v = se.vals[i]; if (!v) return; var hh = v / max * (h - pb - pt);
        out += '<rect x="' + (gx(i) + bw * .14).toFixed(1) + '" y="' + (y0 - hh).toFixed(1) + '" width="' + Math.max(1, bw * .72).toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="2" fill="' + se.cor + '" class="br" style="animation-delay:' + (i * 12) + 'ms"/>';
        y0 -= hh;
      });
      return out;
    }).join("");
    var passoRot = Math.max(1, Math.ceil(n / 10));
    var rots = bs.map(function (b, i) { return i % passoRot ? "" : '<text x="' + (gx(i) + bw / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" class="ax">' + rotulo(b.ini, periodo) + "</text>"; }).join("");
    var hit = bs.map(function (b, i) { return '<rect x="' + gx(i).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (h - pb) + '" fill="transparent" data-i="' + i + '"/>'; }).join("");
    return '<svg viewBox="0 0 ' + w + " " + h + '" class="chart-main" preserveAspectRatio="none">' + grid + barras + rots + '<line class="cursor" x1="0" x2="0" y1="' + pt + '" y2="' + (h - pb) + '" style="display:none"/>' + hit + "</svg>";
  }
  function contar(el) {
    el.querySelectorAll("[data-contar]").forEach(function (n) {
      var alvo = Number(n.dataset.contar), fmt = n.dataset.fmt, ini = performance.now(), dur = 700;
      var de = Number(n.dataset.de || 0);
      function passo(t) {
        var k = Math.min(1, (t - ini) / dur), e = 1 - Math.pow(1 - k, 3), v = de + (alvo - de) * e;
        n.textContent = fmt === "usd" ? fmtUSD(v) : fmt === "pct" ? Math.round(v) + "%" : fmtNum(v);
        if (k < 1) requestAnimationFrame(passo);
      }
      requestAnimationFrame(passo);
    });
  }

  // ---------- dados extras (vendas, visitas, mídia, eventos, faturas) ----------
  async function carregarExtras(A) {
    var r = await Promise.all([
      A.sb.from("vendas").select("id, lead_id, corretor_id, empreendimento_id, status, valor, moeda, data_fechamento, data_proposta, canal, criado_em"),
      A.sb.from("visitas").select("id, lead_id, corretor_id, empreendimento_id, inicio, status"),
      A.sb.from("investimentos").select("mes, canal, valor, moeda"),
      A.sb.from("lead_eventos").select("id, lead_id, autor_id, tipo, texto, de_etapa, para_etapa, criado_em").order("criado_em", { ascending: false }).limit(25),
      A.sb.from("faturas").select("status, vencimento, valor, moeda"),
      A.sb.from("empreendimentos").select("id, nome, slug"),
      A.sb.from("unidades").select("empreendimento_id, status")
    ]);
    st.extras = { vendas: r[0].data || [], visitas: r[1].data || [], inv: r[2].data || [], eventos: r[3].data || [], faturas: r[4].data || [], emps: r[5].data || [], unidades: r[6].data || [] };
    st.carregadoEm = Date.now();
  }

  // ---------- render ----------
  function montarCasca(el) {
    el.innerHTML =
      '<div class="dsh-top"><div class="dsh-per" role="group" aria-label="Período">' + PERIODOS.map(function (p) { return '<button data-per="' + p[0] + '"' + (p[0] === st.periodo ? ' class="on"' : "") + ">" + p[1] + "</button>"; }).join("") + "</div>" +
      '<div class="dsh-live"><i></i><b>Ao vivo</b><span data-atualizado>agora</span><button class="btn ghost small" data-recarregar title="Atualizar">↻</button></div></div>' +
      '<div class="dsh-kpis" data-kpis></div>' +
      '<div class="dsh-row r21"><div class="card"><div class="dsh-h"><h3>Entrada de leads</h3><div class="dsh-tabs">' +
      [["leads", "Leads"], ["qualif", "Qualificados"]].map(function (m) { return '<button data-met="' + m[0] + '"' + (m[0] === st.metrica ? ' class="on"' : "") + ">" + m[1] + "</button>"; }).join("") +
      '</div></div><div class="dsh-chart" data-chart></div><div class="dsh-leg" data-leg></div></div>' +
      '<div class="card"><div class="dsh-h"><h3>Origem dos leads</h3></div><div data-origem></div></div></div>' +
      '<div class="dsh-row r12"><div class="card"><div class="dsh-h"><h3>Funil e conversão</h3><small>leads do período por etapa atual</small></div><div data-funil></div></div>' +
      '<div class="card"><div class="dsh-h"><h3>Corretores</h3><small>no período</small></div><div data-corretores></div></div></div>' +
      '<div class="dsh-row r111"><div class="card"><div class="dsh-h"><h3>Alertas</h3></div><div data-alertas></div></div>' +
      '<div class="card"><div class="dsh-h"><h3>Empreendimentos</h3><small>leads no período</small></div><div data-emps></div></div>' +
      '<div class="card"><div class="dsh-h"><h3>Ao vivo</h3><small>últimas movimentações</small></div><div data-feed class="dsh-feed"></div></div></div>' +
      '<div class="card dsh-heat-card"><div class="dsh-h"><h3>Quando os leads chegam</h3><small>dia da semana × hora · use para programar anúncios e plantões</small></div><div data-heat></div></div>';
    el.querySelectorAll("[data-per]").forEach(function (b) { b.addEventListener("click", function () { st.periodo = b.dataset.per; el.querySelectorAll("[data-per]").forEach(function (x) { x.classList.toggle("on", x === b); }); preencher(true); }); });
    el.querySelectorAll("[data-met]").forEach(function (b) { b.addEventListener("click", function () { st.metrica = b.dataset.met; el.querySelectorAll("[data-met]").forEach(function (x) { x.classList.toggle("on", x === b); }); preencher(false); }); });
    el.querySelector("[data-recarregar]").addEventListener("click", function () { atualizarTudo(true); });
  }

  function preencher(animar) {
    var el = st.el, A = st.A; if (!el || !st.extras || !document.body.contains(el)) return;
    var L = A.S.leads, X = st.extras, iv = intervalo(st.periodo);
    var noP = L.filter(function (l) { return dentro(l.criado_em, iv.ini, iv.fim); });
    var noAnt = L.filter(function (l) { return dentro(l.criado_em, iv.antIni, iv.antFim); });
    var qP = noP.filter(function (l) { return QUALIF.indexOf(l.etapa) >= 0; }), qA = noAnt.filter(function (l) { return QUALIF.indexOf(l.etapa) >= 0; });
    var visP = X.visitas.filter(function (v) { return v.status !== "cancelada" && dentro(v.inicio, iv.ini, iv.fim); });
    var visA = X.visitas.filter(function (v) { return v.status !== "cancelada" && dentro(v.inicio, iv.antIni, iv.antFim); });
    var fech = function (a, b) { return X.vendas.filter(function (v) { return v.status === "fechada" && v.moeda === "USD" && dentro(v.data_fechamento || v.criado_em, a, b); }); };
    var vP = fech(iv.ini, iv.fim), vA = fech(iv.antIni, iv.antFim);
    var soma = function (arr) { return arr.reduce(function (s, v) { return s + Number(v.valor || 0); }, 0); };
    var abertos = L.filter(function (l) { return A.ABERTAS.indexOf(l.etapa) >= 0; });
    var pipeline = abertos.reduce(function (s, l) { return s + Number(l.valor_estimado || 0); }, 0);
    var PROB = { novo: .03, contato: .06, qualificado: .12, visita: .25, proposta: .45, contrato: .8 };
    var prev = abertos.reduce(function (s, l) { return s + Number(l.valor_estimado || 0) * (PROB[l.etapa] || 0); }, 0);
    var conv = noP.length ? qP.length / noP.length * 100 : 0, convA = noAnt.length ? qA.length / noAnt.length * 100 : 0;
    var bs = baldes(iv, st.periodo);
    var serie = function (arr, campo) { return bs.map(function (b) { return arr.filter(function (x) { var t = new Date(x[campo]).getTime(); return t >= b.ini && t < b.fim; }).length; }); };
    var serieValor = bs.map(function (b) { return vP.filter(function (x) { var t = new Date(x.data_fechamento || x.criado_em).getTime(); return t >= b.ini && t < b.fim; }).reduce(function (s, x) { return s + Number(x.valor); }, 0); });
    var antigos = el.querySelectorAll("[data-contar]"), anterior = {};
    antigos.forEach(function (n) { anterior[n.dataset.k] = n.dataset.contar; });
    function kpi(k, titulo, valor, fmt, dlt, sp, cor, sub) {
      return '<div class="dsh-kpi" style="--c:' + cor + '"><small>' + titulo + '</small><strong data-k="' + k + '" data-contar="' + valor + '" data-fmt="' + (fmt || "") + '" data-de="' + (animar ? 0 : (anterior[k] || valor)) + '">' + (fmt === "usd" ? fmtUSD(valor) : fmt === "pct" ? Math.round(valor) + "%" : fmtNum(valor)) + "</strong><div class=\"dsh-kpi-f\">" + (dlt || "") + "<span>" + (sub || "vs. período anterior") + "</span></div>" + (sp || "") + "</div>";
    }
    el.querySelector("[data-kpis]").innerHTML =
      kpi("leads", "Leads novos", noP.length, "", delta(noP.length, noAnt.length), spark(serie(noP, "criado_em"), "#3ec5f0"), "#3ec5f0") +
      kpi("qualif", "Qualificados", qP.length, "", delta(qP.length, qA.length), spark(serie(qP, "criado_em"), "#6b3fd4"), "#6b3fd4") +
      kpi("conv", "Taxa de qualificação", conv, "pct", delta(conv, convA), "", "#16b8a6") +
      kpi("visitas", "Visitas", visP.length, "", delta(visP.length, visA.length), spark(serie(visP, "inicio"), "#f7a24a"), "#f7a24a") +
      kpi("vendido", "Vendido", soma(vP), "usd", delta(soma(vP), soma(vA)), spark(serieValor, "#2fa86b"), "#2fa86b", vP.length + " venda(s) · vs. anterior") +
      kpi("pipe", "Pipeline aberto", pipeline, "usd", "", "", "#ec3d8f", abertos.length + " leads · previsão " + fmtUSD(prev));
    if (animar) contar(el.querySelector("[data-kpis]")); else contar(el.querySelector("[data-kpis]"));

    // gráfico principal empilhado por canal
    var base = st.metrica === "qualif" ? qP : noP;
    var canais = ["meta", "google", "ia", "seo", "outro", "direto"];
    var series = canais.map(function (c) { var arr = base.filter(function (l) { return canalDe(l) === c; }); return { c: c, cor: CORES[c], vals: serie(arr, "criado_em"), tot: arr.length }; }).filter(function (s) { return s.tot; });
    var ch = el.querySelector("[data-chart]");
    ch.innerHTML = base.length ? grafico(bs, series, st.periodo) + '<div class="dsh-tip" hidden></div>' : '<div class="empty">Nenhum lead neste período.</div>';
    el.querySelector("[data-leg]").innerHTML = series.map(function (s) { return '<span><i style="background:' + s.cor + '"></i>' + NOMES_CANAL[s.c] + " · " + s.tot + "</span>"; }).join("");
    var svg = ch.querySelector("svg");
    if (svg) {
      var tip = ch.querySelector(".dsh-tip"), cur = svg.querySelector(".cursor");
      svg.querySelectorAll("[data-i]").forEach(function (r) {
        r.addEventListener("mousemove", function (ev) {
          var i = Number(r.dataset.i), b = bs[i];
          var linhas = series.filter(function (s) { return s.vals[i]; }).map(function (s) { return '<div><i style="background:' + s.cor + '"></i>' + NOMES_CANAL[s.c] + "<b>" + s.vals[i] + "</b></div>"; }).join("");
          var tot = series.reduce(function (s, x) { return s + x.vals[i]; }, 0);
          tip.innerHTML = "<strong>" + (st.periodo === "hoje" ? new Date(b.ini).getHours() + "h" : st.periodo === "365" ? "Semana de " + rotulo(b.ini) : new Date(b.ini).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })) + " · " + tot + "</strong>" + (linhas || "<div>Sem leads</div>");
          tip.hidden = false;
          var box = ch.getBoundingClientRect(); var x = ev.clientX - box.left;
          tip.style.left = Math.min(box.width - 170, Math.max(0, x + 12)) + "px"; tip.style.top = "8px";
          var vx = Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2; cur.setAttribute("x1", vx); cur.setAttribute("x2", vx); cur.style.display = "";
        });
        r.addEventListener("mouseleave", function () { tip.hidden = true; cur.style.display = "none"; });
      });
    }

    // origem: donut + custo por lead
    var porCanal = canais.map(function (c) { return { c: c, nome: NOMES_CANAL[c], cor: CORES[c], v: noP.filter(function (l) { return canalDe(l) === c; }).length }; }).filter(function (f) { return f.v; }).sort(function (a, b) { return b.v - a.v; });
    var mesesP = {}; X.inv.forEach(function (i) { var t = new Date(i.mes + "T12:00:00").getTime(); if (t >= iv.ini - 31 * DIA && t < iv.fim) { var k = i.canal + ":" + i.moeda; mesesP[k] = (mesesP[k] || 0) + Number(i.valor); } });
    el.querySelector("[data-origem]").innerHTML = '<div class="dsh-origem">' + donut(porCanal) + '<div class="dsh-olist">' + (porCanal.map(function (f) {
      var custo = ["BRL", "USD"].map(function (m) { var g = mesesP[f.c + ":" + m]; return g ? (m === "BRL" ? "R$ " : "US$ ") + (g / f.v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "/lead" : ""; }).filter(Boolean).join(" · ");
      return '<div><i style="background:' + f.cor + '"></i><span>' + f.nome + (custo ? "<small>" + custo + "</small>" : "") + "</span><b>" + Math.round(f.v / noP.length * 100) + "%</b></div>";
    }).join("") || '<p class="note">Sem leads no período.</p>') + "</div></div>";

    // funil
    var etapas = A.ETAPAS.filter(function (e) { return e.id !== "perdido"; });
    var alcancou = function (id) { var idx = etapas.findIndex(function (e) { return e.id === id; }); return noP.filter(function (l) { var j = etapas.findIndex(function (e) { return e.id === l.etapa; }); return j >= idx; }).length; };
    var topo = noP.length || 1, perd = noP.filter(function (l) { return l.etapa === "perdido"; }).length;
    el.querySelector("[data-funil]").innerHTML = '<div class="dsh-funil">' + etapas.map(function (e, i) {
      var n = i === 0 ? noP.length : alcancou(e.id), antes = i === 0 ? n : alcancou(etapas[i - 1].id);
      return '<div class="fz"><span>' + e.nome + '</span><div class="fz-t"><i style="width:' + (n / topo * 100).toFixed(1) + '%"></i></div><b>' + n + '</b><em>' + (i ? (antes ? Math.round(n / antes * 100) : 0) + "%" : "") + "</em></div>";
    }).join("") + '</div><p class="note">' + perd + " perdido(s) no período. A % mostra quantos passaram da etapa anterior para esta.</p>";

    // corretores
    var cor = A.S.membros.filter(function (m) { return m.papel === "corretor" || m.papel === "admin"; });
    var linhas = cor.map(function (m) {
      var meus = noP.filter(function (l) { return l.corretor_id === m.id; });
      var vis = visP.filter(function (v) { return v.corretor_id === m.id; }).length;
      var ven = vP.filter(function (v) { return v.corretor_id === m.id; });
      var parados = abertos.filter(function (l) { return l.corretor_id === m.id && Date.now() - new Date(l.atualizado_em).getTime() > 7 * DIA; }).length;
      return { m: m, leads: meus.length, qual: meus.filter(function (l) { return QUALIF.indexOf(l.etapa) >= 0; }).length, vis: vis, ven: ven.length, valor: soma(ven), parados: parados, abertos: abertos.filter(function (l) { return l.corretor_id === m.id; }).length };
    }).filter(function (x) { return x.leads || x.abertos || x.ven; }).sort(function (a, b) { return b.valor - a.valor || b.qual - a.qual || b.leads - a.leads; });
    var maxL = Math.max.apply(null, linhas.map(function (x) { return x.leads; }).concat([1]));
    var semDono = noP.filter(function (l) { return !l.corretor_id; }).length;
    el.querySelector("[data-corretores]").innerHTML = linhas.length ? '<table class="dsh-rank"><thead><tr><th>#</th><th>Corretor</th><th>Leads</th><th>Qualif.</th><th class="hide-sm">Visitas</th><th>Vendas</th><th class="hide-sm">Parados</th></tr></thead><tbody>' + linhas.map(function (x, i) {
      return "<tr><td>" + (i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1) + "</td><td><strong>" + A.esc(x.m.nome) + '</strong><div class="mini-bar"><i style="width:' + (x.leads / maxL * 100) + '%"></i></div></td><td>' + x.leads + "</td><td>" + x.qual + (x.leads ? ' <small class="muted">' + Math.round(x.qual / x.leads * 100) + "%</small>" : "") + '</td><td class="hide-sm">' + x.vis + "</td><td>" + x.ven + (x.valor ? '<small class="muted"> ' + fmtUSD(x.valor) + "</small>" : "") + '</td><td class="hide-sm' + (x.parados ? " quente" : "") + '">' + x.parados + "</td></tr>";
    }).join("") + "</tbody></table>" + (semDono ? '<p class="note" style="margin-top:8px">' + semDono + " lead(s) do período sem corretor.</p>" : "") : '<div class="empty">Sem leads atribuídos no período.</div>';

    // alertas
    var hoje = A.hojeISO();
    var al = [];
    var novos24 = L.filter(function (l) { return l.etapa === "novo" && Date.now() - new Date(l.criado_em).getTime() > DIA; });
    var semCor = abertos.filter(function (l) { return !l.corretor_id; });
    var atras = abertos.filter(function (l) { return l.proximo_contato && l.proximo_contato < hoje; });
    var visHoje = X.visitas.filter(function (v) { return ["agendada", "confirmada"].indexOf(v.status) >= 0 && A.isoLocal(new Date(v.inicio)) === hoje; });
    var quentes = abertos.filter(function (l) { return l.temperatura === "quente" && Date.now() - new Date(l.atualizado_em).getTime() > 2 * DIA; });
    var venc = X.faturas.filter(function (f) { return f.status === "aberta" && f.vencimento && f.vencimento < hoje; });
    if (novos24.length) al.push(["vermelho", novos24.length + " lead(s) novos há mais de 24h sem contato", "novo"]);
    if (semCor.length) al.push(["laranja", semCor.length + " lead(s) abertos sem corretor", "semcor"]);
    if (atras.length) al.push(["laranja", atras.length + " follow-up(s) atrasado(s)", "atrasados"]);
    if (quentes.length) al.push(["rosa", quentes.length + " lead(s) quentes parados há 2+ dias", "quentes"]);
    if (visHoje.length) al.push(["azul", visHoje.length + " visita(s) hoje", "agenda"]);
    if (venc.length) al.push(["vermelho", venc.length + " fatura(s) vencida(s)", "cobranca"]);
    el.querySelector("[data-alertas]").innerHTML = al.length ? '<div class="dsh-alertas">' + al.map(function (a) { return '<button class="al ' + a[0] + '" data-alerta="' + a[2] + '"><i></i>' + a[1] + "<span>→</span></button>"; }).join("") + "</div>" : '<div class="dsh-ok">✓ Tudo em dia. Nenhum lead esperando.</div>';
    el.querySelectorAll("[data-alerta]").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = b.dataset.alerta;
        if (t === "agenda" || t === "cobranca") return A.irPara(t);
        A.S.f = A.S.f || {}; A.S.f.etapa = t === "novo" ? "novo" : ""; A.S.f.corretor = t === "semcor" ? "_sem" : ""; A.S.f.periodo = "";
        A.irPara("leads");
      });
    });

    // empreendimentos
    var porEmp = {}; noP.forEach(function (l) { var k = l.empreendimento || "Não informado"; porEmp[k] = (porEmp[k] || 0) + 1; });
    var listaE = Object.keys(porEmp).map(function (k) { return [k, porEmp[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 7);
    var maxE = listaE.length ? listaE[0][1] : 1;
    el.querySelector("[data-emps]").innerHTML = listaE.length ? '<div class="dsh-emps">' + listaE.map(function (e, i) {
      var emp = X.emps.find(function (x) { return x.nome === e[0]; }), u = emp ? X.unidades.filter(function (x) { return x.empreendimento_id === emp.id; }) : [];
      var disp = u.filter(function (x) { return x.status === "disponivel"; }).length;
      return '<div><span>' + A.esc(e[0]) + (u.length ? "<small>" + disp + " de " + u.length + " unidades disponíveis</small>" : "") + '</span><div class="fz-t"><i style="width:' + (e[1] / maxE * 100) + "%;animation-delay:" + i * 60 + 'ms"></i></div><b>' + e[1] + "</b></div>";
    }).join("") + "</div>" : '<div class="empty">Sem leads no período.</div>';

    // feed ao vivo
    var nomeLead = function (id) { var l = L.find(function (x) { return x.id === id; }); return l ? (l.nome || l.email || "Lead") : "Lead"; };
    var nomeMembro = function (id) { var m = A.S.membros.find(function (x) { return x.id === id; }); return m ? m.nome.split(" ")[0] : "Sistema"; };
    var desc = function (e) {
      if (e.tipo === "criado") return "<b>" + A.esc(nomeLead(e.lead_id)) + "</b> chegou" + (e.texto ? " · " + A.esc(e.texto.replace(/^Lead recebido pelo /, "")) : "");
      if (e.tipo === "etapa") return A.esc(nomeMembro(e.autor_id)) + " moveu <b>" + A.esc(nomeLead(e.lead_id)) + "</b> para " + A.esc(A.etapaNome(e.para_etapa));
      if (e.tipo === "atribuicao") return "<b>" + A.esc(nomeLead(e.lead_id)) + "</b> " + A.esc(e.texto || "foi atribuído");
      return A.esc(nomeMembro(e.autor_id)) + " · <b>" + A.esc(nomeLead(e.lead_id)) + "</b>: " + A.esc((e.texto || e.tipo).slice(0, 80));
    };
    el.querySelector("[data-feed]").innerHTML = X.eventos.length ? X.eventos.slice(0, 12).map(function (e) {
      return '<button class="fd ' + e.tipo + '" data-lead="' + e.lead_id + '"><i></i><span>' + desc(e) + '</span><time data-t="' + e.criado_em + '">' + rel(e.criado_em) + "</time></button>";
    }).join("") : '<div class="empty">Nada por aqui ainda.</div>';
    el.querySelectorAll(".fd[data-lead]").forEach(function (b) { b.addEventListener("click", function () { A.abrirLead(b.dataset.lead); }); });

    // mapa de calor
    var H = []; for (var d = 0; d < 7; d++) { H.push(new Array(24).fill(0)); }
    noP.forEach(function (l) { var t = new Date(l.criado_em); H[t.getDay()][t.getHours()]++; });
    var maxH = Math.max.apply(null, H.map(function (r) { return Math.max.apply(null, r); }).concat([1]));
    var dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    var melhor = { v: 0 }; H.forEach(function (r, di) { r.forEach(function (v, h) { if (v > melhor.v) melhor = { v: v, d: di, h: h }; }); });
    el.querySelector("[data-heat]").innerHTML = '<div class="dsh-heat"><div></div>' + Array.from({ length: 24 }, function (_, h) { return "<small>" + (h % 3 ? "" : h + "h") + "</small>"; }).join("") +
      H.map(function (r, di) { return "<small>" + dias[di] + "</small>" + r.map(function (v, h) { return '<i title="' + dias[di] + " " + h + "h: " + v + ' lead(s)" style="--a:' + (v ? (.15 + v / maxH * .85).toFixed(2) : 0) + '"></i>'; }).join(""); }).join("") + "</div>" +
      (melhor.v ? '<p class="note" style="margin-top:8px">Pico: <b>' + dias[melhor.d] + " às " + melhor.h + "h</b> (" + melhor.v + " lead(s)). Garanta corretor de plantão e verba nesse horário.</p>" : "");
  }

  function tique() {
    if (!st.el || !document.body.contains(st.el) || st.A.S.view !== "dash") return;
    var s = Math.round((Date.now() - st.carregadoEm) / 1000);
    var a = st.el.querySelector("[data-atualizado]"); if (a) a.textContent = s < 10 ? "agora" : "há " + (s < 60 ? s + " s" : Math.floor(s / 60) + " min");
    st.el.querySelectorAll("time[data-t]").forEach(function (t) { t.textContent = rel(t.dataset.t); });
  }
  async function atualizarTudo(manual) {
    if (!st.A) return;
    await st.A.carregar(); await carregarExtras(st.A);
    if (st.A.S.view === "dash") preencher(false);
    if (manual) st.A.toast("Dashboard atualizado.");
  }
  function ouvir(A) {
    if (st.canal) return;
    var agenda = function () { clearTimeout(st.fila); st.fila = setTimeout(function () { if (A.S.view === "dash") atualizarTudo(false); }, 800); };
    st.canal = A.sb.channel("dash-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, function (p) {
        agenda();
        if (p.eventType === "INSERT" && A.S.view === "dash" && st.el) { var k = st.el.querySelector('.dsh-kpi strong[data-k="leads"]'); if (k) { k.parentNode.classList.remove("flash"); void k.offsetWidth; k.parentNode.classList.add("flash"); } }
      })
      .subscribe();
    st.timer = setInterval(function () { if (A.S.view === "dash" && Date.now() - st.carregadoEm > 60000) atualizarTudo(false); }, 15000);
    st.relogio = setInterval(tique, 5000);
  }

  D.modulos.push({
    id: "dash", titulo: "Dashboard", tituloLongo: "Dashboard do administrador", icone: "◉", papeis: ["admin"], antes: "painel",
    render: async function (el, A) {
      st.el = el; st.A = A;
      if (!el.querySelector("[data-kpis]")) montarCasca(el);
      if (!st.extras || Date.now() - st.carregadoEm > 30000) { el.classList.add("carregando"); await carregarExtras(A); el.classList.remove("carregando"); }
      preencher(true);
      ouvir(A);
    }
  });
})();
