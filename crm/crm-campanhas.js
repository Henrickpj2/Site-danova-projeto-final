/* danova AI — Dashboard de campanhas (Google Ads + Meta Ads) cruzado com o CRM.
   Métricas diárias por campanha vêm da tabela campanhas_metricas (importação de CSV dos dois gerenciadores).
   Leads, qualificados e vendas vêm do CRM, ligados à campanha pelo nome (UTM / formulário do Meta).
   Só administradores. Carregado antes do crm.js. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];
  var DIA = 864e5;
  var COR = { google: "#3ec5f0", meta: "#8b5cf6" };
  var NOME = { google: "Google Ads", meta: "Meta Ads" };
  var QUALIF = ["qualificado", "visita", "proposta", "contrato", "fechado"];
  var st = { plat: "todas", camp: "", dias: 30, de: null, ate: null, linhas: [], moeda: "BRL", ordem: "custo", desc: true, graf: "custo", el: null, A: null, carregado: false, conta: "", nicho: "", contas: [], clientes: [], ordemCli: "investido" };

  // ---------- utilidades ----------
  function iso(d) { var x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
  function dt(s) { return new Date(s + "T12:00:00"); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function n0(v) { return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); }
  function n2(v) { return Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cur(v, m) { return (m === "USD" ? "US$ " : "R$ ") + n2(v); }
  function curK(v, m) { v = Number(v || 0); var p = m === "USD" ? "US$ " : "R$ "; return v >= 1e6 ? p + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi" : v >= 1e4 ? p + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : cur(v, m); }
  function kfmt(v) { v = Number(v || 0); return v >= 1e6 ? (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi" : v >= 1e4 ? (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : n0(v); }
  function pct(v) { return isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%" : "—"; }
  function dlt(a, b, inverso) {
    if (!b) return a ? '<em class="cd sobe">novo</em>' : '<em class="cd">—</em>';
    var p = (a - b) / b * 100, bom = inverso ? p < 0 : p > 0;
    return '<em class="cd ' + (Math.abs(p) < .5 ? "" : bom ? "sobe" : "desce") + '">' + (p > 0 ? "▲" : p < 0 ? "▼" : "") + " " + Math.abs(p).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%</em>";
  }
  function agg(rows) {
    var a = { imp: 0, cli: 0, custo: 0, conv: 0, valor: 0, views: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
    rows.forEach(function (r) { a.imp += +r.impressoes; a.cli += +r.cliques; a.custo += +r.custo; a.conv += +r.conversoes; a.valor += +r.valor_conversoes;
      a.views += +(r.visualizacoes || 0); a.p25 += +(r.video_p25 || 0); a.p50 += +(r.video_p50 || 0); a.p75 += +(r.video_p75 || 0); a.p100 += +(r.video_p100 || 0); });
    a.vtr = a.imp ? a.views / a.imp * 100 : 0; a.cpv = a.views ? a.custo / a.views : 0;
    a.ctr = a.imp ? a.cli / a.imp * 100 : 0; a.cpc = a.cli ? a.custo / a.cli : 0; a.cpm = a.imp ? a.custo / a.imp * 1000 : 0;
    a.cpa = a.conv ? a.custo / a.conv : 0; a.tx = a.cli ? a.conv / a.cli * 100 : 0; a.roas = a.custo ? a.valor / a.custo : 0;
    return a;
  }
  function campanhaDoLead(l) {
    var u = l.utm || {};
    return l.campanha || u.last_touch_campaign || u.first_touch_campaign || u.utm_campaign || "";
  }
  function platDoLead(l) {
    var c = String((l.utm && (l.utm.last_touch_source || l.utm.first_touch_source)) || l.canal || "").toLowerCase();
    if (/face|insta|meta|fb|ig/.test(c) || l.meta_lead_id) return "meta";
    if (/google|youtube/.test(c) || (l.utm && l.utm.gclid)) return "google";
    return "";
  }

  var NICHO = { imoveis: "Imóveis", agro: "Agro e máquinas agrícolas", veiculos: "Veículos", outro: "Outros" };

  // ---------- importação de CSV ----------
  function lerTexto(buf) {
    var u = new Uint8Array(buf);
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
    if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
    var t = new TextDecoder("utf-8").decode(buf);
    if (t.indexOf("\uFFFD") >= 0) t = new TextDecoder("windows-1252").decode(buf);
    return t.replace(/^﻿/, "");
  }
  function parseCSV(txt) {
    var linhas = txt.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var amostra = linhas.slice(0, 5).join("\n"), sep = (amostra.match(/\t/g) || []).length > (amostra.match(/;/g) || []).length ? "\t" : (amostra.match(/;/g) || []).length > (amostra.match(/,/g) || []).length ? ";" : ",";
    return linhas.map(function (l) {
      var out = [], cell = "", q = false;
      for (var i = 0; i < l.length; i++) {
        var ch = l[i];
        if (q) { if (ch === '"' && l[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
        else if (ch === '"') q = true; else if (ch === sep) { out.push(cell); cell = ""; } else cell += ch;
      }
      out.push(cell); return out.map(function (c) { return c.trim(); });
    });
  }
  function numero(s) {
    s = String(s == null ? "" : s).replace(/[^\d.,-]/g, "");
    if (!s || s === "-" || s === "--") return 0;
    var v = s.lastIndexOf(","), p = s.lastIndexOf(".");
    if (v >= 0 && p >= 0) { if (v > p) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, ""); }
    else {
      var sep = v >= 0 ? "," : p >= 0 ? "." : "";
      if (sep) {
        var partes = s.split(sep);
        // separador de milhar: aparece mais de uma vez, ou uma vez seguido de exatamente 3 dígitos (ex.: 3.210 · 16,060)
        if (partes.length > 2 || (partes[1].length === 3 && partes[0] !== "0" && partes[0] !== "-0")) s = partes.join("");
        else s = partes[0] + "." + partes[1];
      }
    }
    var n = parseFloat(s); return isNaN(n) ? 0 : n;
  }
  function data(s) {
    s = String(s || "").trim(); var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + "-" + m[2] + "-" + m[3];
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
    var MES = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
    if ((m = /(\d{1,2})\s+de\s+([a-zç]{3})\w*\.?\s+de\s+(\d{4})/i.exec(s))) return m[3] + "-" + ("0" + MES[m[2].toLowerCase()]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
    var d = new Date(s); return isNaN(d) ? "" : iso(d);
  }
  var COLS = {
    data: ["dia", "day", "data", "date", "inicio dos relatorios", "reporting starts", "semana", "week"],
    campanha: ["campanha", "campaign", "nome da campanha", "campaign name"],
    conjunto: ["grupo de anuncios", "ad group", "nome do conjunto de anuncios", "ad set name", "conjunto de anuncios"],
    impressoes: ["impr", "impressoes", "impressions"],
    cliques: ["cliques", "clicks", "cliques no link", "link clicks", "cliques todos", "clicks all"],
    custo: ["custo", "cost", "valor usado brl", "valor usado usd", "amount spent brl", "amount spent usd", "valor usado", "amount spent", "gasto"],
    conversoes: ["conversoes", "conversions", "resultados", "results", "leads", "cadastros", "todas as conv", "all conv"],
    valor: ["valor conv", "conv value", "valor de conversao", "conversion value", "valor de conversao das compras", "purchases conversion value", "valor total de conv"],
    alcance: ["alcance", "reach"],
    visualizacoes: ["visualizacoes", "views", "visualizacoes do video", "video views", "reproducoes do video", "video plays", "thruplays", "thruplay"],
    p25: ["video reproduzido ate 25", "video played to 25", "reproducoes do video ate 25", "video plays at 25"],
    p50: ["video reproduzido ate 50", "video played to 50", "reproducoes do video ate 50", "video plays at 50"],
    p75: ["video reproduzido ate 75", "video played to 75", "reproducoes do video ate 75", "video plays at 75"],
    p100: ["video reproduzido ate 100", "video played to 100", "reproducoes do video ate 100", "video plays at 100"],
    moeda: ["codigo da moeda", "currency code", "moeda", "currency"]
  };
  function achar(cab, nomes) {
    var c = cab.map(norm);
    for (var i = 0; i < nomes.length; i++) { var k = c.indexOf(nomes[i]); if (k >= 0) return k; }
    for (i = 0; i < nomes.length; i++) for (var j = 0; j < c.length; j++) if (c[j].indexOf(nomes[i]) === 0) return j;
    return -1;
  }
  function interpretar(txt, platEscolhida, contaAnuncio) {
    var t = parseCSV(txt), hi = -1;
    for (var i = 0; i < Math.min(t.length, 15); i++) if (achar(t[i], COLS.campanha) >= 0 && (achar(t[i], COLS.custo) >= 0 || achar(t[i], COLS.impressoes) >= 0)) { hi = i; break; }
    if (hi < 0) throw new Error("Não encontrei as colunas de campanha, custo e impressões. Exporte o relatório com as colunas Dia, Campanha, Impressões, Cliques, Custo e Conversões.");
    var cab = t[hi], ix = {}; Object.keys(COLS).forEach(function (k) { ix[k] = achar(cab, COLS[k]); });
    var cabN = cab.map(norm).join("|");
    var plat = platEscolhida !== "auto" ? platEscolhida : /valor usado|amount spent|nome do conjunto|ad set|alcance|reach|cliques no link|link clicks/.test(cabN) ? "meta" : "google";
    var moedaCab = /usd/.test(cabN) ? "USD" : "BRL";
    if (ix.data < 0) throw new Error("O relatório precisa ter a coluna de data por dia (Google: segmentar por Dia · Meta: detalhar por Dia).");
    var rows = [], ignoradas = 0;
    t.slice(hi + 1).forEach(function (r) {
      var camp = r[ix.campanha], d = data(r[ix.data]);
      if (!camp || !d || /^total/i.test(camp) || /^total/i.test(r[0] || "")) { ignoradas++; return; }
      var m = ix.moeda >= 0 && /usd/i.test(r[ix.moeda]) ? "USD" : moedaCab;
      rows.push({ data: d, plataforma: plat, campanha: camp.slice(0, 300), conjunto: ix.conjunto >= 0 ? (r[ix.conjunto] || "").slice(0, 300) : "",
        impressoes: Math.round(numero(r[ix.impressoes])), cliques: Math.round(numero(r[ix.cliques])), custo: numero(r[ix.custo]), moeda: m,
        conversoes: numero(r[ix.conversoes]), valor_conversoes: ix.valor >= 0 ? numero(r[ix.valor]) : 0, alcance: ix.alcance >= 0 ? Math.round(numero(r[ix.alcance])) : null, origem: "csv",
        conta_anuncio: contaAnuncio || "", visualizacoes: ix.visualizacoes >= 0 ? Math.round(numero(r[ix.visualizacoes])) : 0 });
      var ult = rows[rows.length - 1], imp = ult.impressoes, base = ult.visualizacoes || imp;
      ["p25", "p50", "p75", "p100"].forEach(function (k) { // Google exporta % ; Meta exporta quantidade
        var v = ix[k] >= 0 ? r[ix[k]] : ""; var n = numero(v);
        ult["video_" + k] = /%/.test(v || "") ? Math.round(n / 100 * imp) : Math.round(n);
      });
    });
    // junta linhas repetidas da mesma chave (ex.: relatório por anúncio)
    var mapa = {};
    rows.forEach(function (r) { var k = [r.data, r.plataforma, r.conta_anuncio, r.campanha, r.conjunto].join("|"); if (!mapa[k]) mapa[k] = r; else ["impressoes", "cliques", "custo", "conversoes", "valor_conversoes", "visualizacoes", "video_p25", "video_p50", "video_p75", "video_p100"].forEach(function (c) { mapa[k][c] += r[c]; }); });
    return { plat: plat, linhas: Object.keys(mapa).map(function (k) { return mapa[k]; }), ignoradas: ignoradas };
  }

  // ---------- gráficos (SVG) ----------
  function combo(bs, barras, linhas, rotulos) {
    var w = 860, h = 250, pl = 46, pr = 46, pb = 26, pt = 12, n = bs.length;
    var mb = Math.max.apply(null, barras.vals.concat([1])) * 1.1, bw = (w - pl - pr) / n;
    var y1 = function (v) { return h - pb - v / mb * (h - pb - pt); };
    var g = [0, .5, 1].map(function (f) { var y = y1(mb * f); return '<line x1="' + pl + '" x2="' + (w - pr) + '" y1="' + y + '" y2="' + y + '" class="cg"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="cx">' + kfmt(mb * f) + "</text>"; }).join("");
    var b = barras.vals.map(function (v, i) { var hh = v / mb * (h - pb - pt); return '<rect x="' + (pl + i * bw + bw * .15).toFixed(1) + '" y="' + (h - pb - hh).toFixed(1) + '" width="' + (bw * .7).toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="2" fill="' + barras.cor + '" class="cb" style="animation-delay:' + i * 8 + 'ms"/>'; }).join("");
    var l = linhas.map(function (s) {
      var m = Math.max.apply(null, s.vals.concat([1])) * 1.1;
      var pts = s.vals.map(function (v, i) { return (pl + i * bw + bw / 2).toFixed(1) + "," + (h - pb - v / m * (h - pb - pt)).toFixed(1); }).join(" ");
      return '<polyline points="' + pts + '" fill="none" stroke="' + s.cor + '" stroke-width="2.2" class="cl"/>' + s.vals.map(function (v, i) { return n <= 45 ? '<circle cx="' + (pl + i * bw + bw / 2).toFixed(1) + '" cy="' + (h - pb - v / m * (h - pb - pt)).toFixed(1) + '" r="2.6" fill="' + s.cor + '"/>' : ""; }).join("");
    }).join("");
    var passo = Math.max(1, Math.ceil(n / 12));
    var r = rotulos.map(function (t, i) { return i % passo ? "" : '<text x="' + (pl + i * bw + bw / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" class="cx">' + t + "</text>"; }).join("");
    var hit = bs.map(function (_, i) { return '<rect x="' + (pl + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (h - pb) + '" fill="transparent" data-i="' + i + '"/>'; }).join("");
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" class="c-combo">' + g + b + l + r + hit + "</svg>";
  }
  function area(vals, cor) {
    var w = 300, h = 80, n = vals.length, m = Math.max.apply(null, vals.concat([1])) * 1.15;
    if (n < 2) return "";
    var pts = vals.map(function (v, i) { return (i / (n - 1) * w).toFixed(1) + "," + (h - v / m * h).toFixed(1); });
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" class="c-area"><defs><linearGradient id="g' + cor.slice(1) + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + cor + '" stop-opacity=".55"/><stop offset="1" stop-color="' + cor + '" stop-opacity="0"/></linearGradient></defs><polygon points="0,' + h + " " + pts.join(" ") + " " + w + "," + h + '" fill="url(#g' + cor.slice(1) + ')"/><polyline points="' + pts.join(" ") + '" fill="none" stroke="' + cor + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }
  function semana(rows, campo, cor) {
    var d = [0, 0, 0, 0, 0, 0, 0], nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    rows.forEach(function (r) { d[dt(r.data).getDay()] += +r[campo]; });
    var m = Math.max.apply(null, d.concat([1]));
    return '<div class="c-sem">' + d.map(function (v, i) { return '<div><b style="height:' + (v / m * 100).toFixed(1) + "%;background:" + cor + '" title="' + nomes[i] + ": " + n0(v) + '"></b><small>' + nomes[i] + "</small></div>"; }).join("") + "</div>";
  }

  // ---------- carga ----------
  async function carregar(A) {
    var desde = iso(Date.now() - 400 * DIA);
    var r = await A.sb.from("campanhas_metricas").select("data, plataforma, conta_anuncio, campanha, conjunto, impressoes, cliques, custo, moeda, conversoes, valor_conversoes, alcance, visualizacoes, video_p25, video_p50, video_p75, video_p100").gte("data", desde).order("data").limit(50000);
    if (r.error) { A.falha(r.error); st.linhas = []; } else st.linhas = r.data || [];
    var v = await A.sb.from("vendas").select("lead_id, status, valor, moeda, campanha, canal, data_fechamento, criado_em");
    var vi = await A.sb.from("visitas").select("lead_id, status, inicio");
    st.vendas = v.data || []; st.visitas = vi.data || [];
    var ca = await A.sb.from("contas_anuncio").select("*").eq("ativo", true).order("criado_em"), cl = await A.sb.from("contas").select("id, nome").order("nome");
    st.contas = ca.data || []; st.clientes = cl.data || [];
    st.carregado = true;
    var moedas = {}; st.linhas.forEach(function (x) { moedas[x.moeda] = (moedas[x.moeda] || 0) + 1; });
    st.moeda = (moedas.USD || 0) > (moedas.BRL || 0) ? "USD" : "BRL";
  }
  function grupoDe(c) { return c.conta_id ? "cliente:" + c.conta_id : "nome:" + (c.nome || c.conta_externa); }
  function rotuloGrupo(g) {
    var c = contasVisiveis().find(function (x) { return grupoDe(x) === g; }); if (!c) return g;
    if (c.conta_id) { var cl = st.clientes.find(function (x) { return x.id === c.conta_id; }); if (cl) return cl.nome; }
    return c.nome || c.conta_externa;
  }
  function contasVisiveis() { return st.contas; }
  function fmtData(d) { return d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : ""; }
  function statusConta(c) { // programada (ainda não começou), ativa, pausada, encerrada
    var hoje = iso(new Date());
    if (c.status === "programada" && c.inicio_campanha && c.inicio_campanha <= hoje) return { k: "ativa", t: "Iniciou " + fmtData(c.inicio_campanha) };
    if (c.status === "programada") return { k: "programada", t: "Programada" + (c.inicio_campanha ? " · inicia " + fmtData(c.inicio_campanha) : "") };
    if (c.status === "pausada") return { k: "pausada", t: "Pausada" }; if (c.status === "encerrada") return { k: "encerrada", t: "Encerrada" };
    return { k: "ativa", t: "Ativa" };
  }
  function idConta(c) { return String(c.conta_externa || "").replace(/^act_/, "").replace(/\D/g, ""); }
  function fonte() { return st.linhas.filter(function (r) { return r.moeda === st.moeda; }); }

  // ---------- render ----------
  function render(el, A) {
    var hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    var ate = st.ate ? dt(st.ate) : new Date(hoje.getTime() - DIA), de = st.de ? dt(st.de) : new Date(ate.getTime() - (st.dias - 1) * DIA);
    var len = Math.round((ate - de) / DIA) + 1, antAte = new Date(de.getTime() - DIA), antDe = new Date(antAte.getTime() - (len - 1) * DIA);
    var sDe = iso(de), sAte = iso(ate), sADe = iso(antDe), sAAte = iso(antAte);
    var todas = fonte(), m = st.moeda;
    var idsNicho = st.nicho ? contasVisiveis().filter(function (c) { return c.nicho === st.nicho; }).map(idConta) : null;
    var filtro = function (r) { return (st.plat === "todas" || r.plataforma === st.plat) && (!st.camp || r.campanha === st.camp) && (!st.conta || contaGrupo(r)) && (!idsNicho || idsNicho.indexOf(String(r.conta_anuncio || "")) >= 0); };
    function contaGrupo(r) { // filtro por cliente: junta as contas Google e Meta do mesmo nome/cliente
      var alvo = contasVisiveis().filter(function (c) { return grupoDe(c) === st.conta; }).map(idConta);
      return !!r.conta_anuncio && alvo.indexOf(String(r.conta_anuncio)) >= 0;
    }
    var P = todas.filter(function (r) { return r.data >= sDe && r.data <= sAte && filtro(r); }), Q = todas.filter(function (r) { return r.data >= sADe && r.data <= sAAte && filtro(r); });
    var a = agg(P), b = agg(Q);
    var campanhas = {}; todas.forEach(function (r) { campanhas[r.campanha] = r.plataforma; });

    // CRM por campanha
    var L = A.S.leads, chaveCamp = {}; Object.keys(campanhas).forEach(function (c) { chaveCamp[norm(c)] = c; });
    function crmDe(ini, fim) {
      var porC = {}, semC = { leads: 0, qual: 0 };
      L.forEach(function (l) {
        var d = iso(l.criado_em); if (d < ini || d > fim) return;
        var c = chaveCamp[norm(campanhaDoLead(l))];
        if (!c) { var p = platDoLead(l); if (p) { semC.leads++; if (QUALIF.indexOf(l.etapa) >= 0) semC.qual++; } return; }
        var o = porC[c] = porC[c] || { leads: 0, qual: 0, vis: 0, vendas: 0, valor: 0 }; o.leads++; if (QUALIF.indexOf(l.etapa) >= 0) o.qual++;
        if (["visita", "proposta", "contrato", "fechado"].indexOf(l.etapa) >= 0) o.vis++;
      });
      st.vendas.forEach(function (v) { if (v.status !== "fechada") return; var d = (v.data_fechamento || iso(v.criado_em)); if (d < ini || d > fim) return; var c = chaveCamp[norm(v.campanha)]; if (!c) return; var o = porC[c] = porC[c] || { leads: 0, qual: 0, vis: 0, vendas: 0, valor: 0 }; o.vendas++; o.valor += v.moeda === "USD" ? +v.valor : 0; });
      return { porC: porC, semC: semC };
    }
    var crmP = crmDe(sDe, sAte), crmA = crmDe(sADe, sAAte);
    var campsP = {}, campsQ = {}; P.forEach(function (r) { campsP[r.campanha] = 1; }); Q.forEach(function (r) { campsQ[r.campanha] = 1; });
    var somaCRM = function (crm, campo) { var sel = crm === crmA ? campsQ : campsP; return Object.keys(crm.porC).filter(function (c) { return sel[c]; }).reduce(function (s, c) { return s + (crm.porC[c][campo] || 0); }, 0); };
    var mValor = "USD";
    var leadsP = somaCRM(crmP, "leads"), leadsA = somaCRM(crmA, "leads"), qualP = somaCRM(crmP, "qual"), qualA = somaCRM(crmA, "qual"), vendasP = somaCRM(crmP, "vendas"), valorP = somaCRM(crmP, "valor"), visP = somaCRM(crmP, "vis");

    // série diária
    var dias = []; for (var t = de.getTime(); t <= ate.getTime(); t += DIA) dias.push(iso(t));
    var porDia = function (rows, campo) { var o = {}; rows.forEach(function (r) { o[r.data] = (o[r.data] || 0) + +r[campo]; }); return dias.map(function (d) { return o[d] || 0; }); };
    var sCusto = porDia(P, "custo"), sCli = porDia(P, "cliques"), sImp = porDia(P, "impressoes"), sConv = porDia(P, "conversoes");
    var sCPC = dias.map(function (_, i) { return sCli[i] ? sCusto[i] / sCli[i] : 0; }), sCPM = dias.map(function (_, i) { return sImp[i] ? sCusto[i] / sImp[i] * 1000 : 0; });
    var platRows = function (p) { return P.filter(function (r) { return r.plataforma === p; }); };
    var gA = agg(platRows("google")), mA = agg(platRows("meta"));
    var leadsPlat = function (p) { return Object.keys(crmP.porC).filter(function (c) { return campanhas[c] === p && campsP[c]; }).reduce(function (s, c) { return s + crmP.porC[c].leads; }, 0); };

    // Sem métricas diárias no período: usa os totais acumulados de cada cliente (respeitando filtros de plataforma, nicho e cliente)
    var T = null;
    if (!P.length) {
      var cs = contasVisiveis().filter(function (c) { return (st.plat === "todas" || c.plataforma === st.plat) && (!st.nicho || c.nicho === st.nicho) && (!st.conta || grupoDe(c) === st.conta); });
      var smT = function (campo) { return cs.reduce(function (t, c) { return t + (c[campo] != null ? +c[campo] : 0); }, 0); };
      var tem = function (campo) { return cs.some(function (c) { return c[campo] != null; }); };
      var est = function (campo) { return cs.some(function (c) { return c[campo] != null && (c.estimados || []).indexOf(campo) >= 0; }); };
      var mT = cs.length && cs.every(function (c) { return (c.moeda || "BRL") === (cs[0].moeda || "BRL"); }) ? (cs[0].moeda || "BRL") : "BRL";
      var csM = cs.filter(function (c) { return (c.moeda || "BRL") === mT; });
      var smM = function (campo) { return csM.reduce(function (t, c) { return t + (c[campo] != null ? +c[campo] : 0); }, 0); };
      var invComLead = csM.filter(function (c) { return c.leads; }).reduce(function (t, c) { return t + (+c.investido || 0); }, 0);
      var invComVenda = csM.filter(function (c) { return c.vendas; }).reduce(function (t, c) { return t + (+c.investido || 0); }, 0);
      var invComValor = csM.filter(function (c) { return c.valor_vendas; }).reduce(function (t, c) { return t + (+c.investido || 0); }, 0);
      T = { n: cs.length, m: mT, inv: smM("investido"), cli: tem("cliques") ? smM("cliques") : null, leads: tem("leads") ? smM("leads") : null, vendas: tem("vendas") ? smM("vendas") : null, valor: tem("valor_vendas") ? smM("valor_vendas") : null,
        eCli: est("cliques"), eLeads: est("leads"), eValor: est("valor_vendas"), invL: invComLead, invV: invComVenda, invR: invComValor };
    }
    function blocoTotais() {
      var t = T, mm = t.m, q = function (v, f, e) { return v == null ? "—" : (e ? "≈ " : "") + f(v); };
      var sub = "acumulado · " + t.n + " cliente" + (t.n === 1 ? "" : "s");
      var tx = t.cli && t.leads != null ? t.leads / t.cli * 100 : null, cpl = t.leads ? t.invL / t.leads : null, cpv = t.vendas ? t.invV / t.vendas : null, roas = t.valor && t.invR ? t.valor / t.invR : null, cpc = t.cli ? t.inv / t.cli : null;
      var nada = '<em class="cd">sem dado</em>', acum = '<em class="cd">' + sub + "</em>";
      return '<div class="c-grid2"><section class="c-box"><h3>Desempenho <small>totais informados dos clientes</small></h3><div class="c-tiles">' +
        tile("t-blue", "◉", "Impressões", "—", nada, "chega com a sincronização") +
        tile("t-red", "➚", "Cliques", q(t.cli, kfmt, t.eCli), acum) +
        tile("t-purple", "↗", "Custo por clique", q(cpc, function (v) { return cur(v, mm); }, t.eCli), acum) +
        tile("t-green", "▤", "Investimento", curK(t.inv, mm), acum) +
        "</div></section>" +
        '<section class="c-box"><h3>Conversões <small>leads e vendas</small></h3><div class="c-tiles">' +
        tile("t-orange", "⏷", "Leads", q(t.leads, n0, t.eLeads), acum) +
        tile("t-orange2", "▦", "Taxa clique → lead", q(tx, pct, t.eLeads || t.eCli), acum) +
        tile("t-indigo", "◎", "Custo por lead", q(cpl, function (v) { return cur(v, mm); }, t.eLeads), acum) +
        tile("t-indigo2", "$", "Valor vendido", q(t.valor, function (v) { return curK(v, mm); }, t.eValor), acum, roas ? (t.eValor ? "≈ " : "") + "retorno " + roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x" : "") +
        "</div></section></div>" +
        '<section class="c-box c-crm"><h3>Do anúncio à venda <small>totais informados dos clientes</small></h3><div class="c-funil">' +
        [["Impressões", null, ""], ["Cliques", t.cli, "", t.eCli], ["Leads", t.leads, tx != null ? pct(tx) : "", t.eLeads], ["Qualificados", null, ""], ["Visitas", null, ""], ["Vendas", t.vendas, t.leads && t.vendas != null ? pct(t.vendas / t.leads * 100) : "", false]].map(function (f, i) {
          return '<div class="cf" style="--i:' + i + '"><small>' + f[0] + "</small><b>" + (f[1] == null ? "—" : (f[3] ? "≈ " : "") + kfmt(f[1])) + "</b>" + (f[2] ? "<em>" + f[2] + "</em>" : "") + "</div>";
        }).join("") + '</div><div class="c-kpis">' +
        '<div><small>Custo por lead</small><b>' + q(cpl, function (v) { return cur(v, mm); }, t.eLeads) + "</b><span>média ponderada pelo investimento</span></div>" +
        '<div><small>Custo por venda</small><b>' + q(cpv, function (v) { return cur(v, mm); }) + "</b><span>" + (t.vendas != null ? n0(t.vendas) + " vendas informadas" : "") + "</span></div>" +
        '<div><small>Vendido</small><b>' + q(t.valor, function (v) { return curK(v, mm); }, t.eValor) + "</b><span>" + (roas ? (t.eValor ? "≈ " : "") + roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x o investimento" : "") + "</span></div>" +
        '<div><small>Qualificados e visitas</small><b>—</b><span>aparecem quando os leads entrarem no CRM</span></div></div></section>';
    }
    var tile = function (cls, ic, t, v, d, sub) { return '<div class="ct ' + cls + '"><div class="ct-h"><small>' + t + "</small><span>" + ic + '</span></div><strong>' + v + '</strong><div class="ct-f">' + (d || "") + (sub ? "<span>" + sub + "</span>" : "") + "</div></div>"; };
    var platOpts = [["todas", "Todas"], ["google", "Google Ads"], ["meta", "Meta Ads"]];
    var camps = Object.keys(campanhas).filter(function (c) { return st.plat === "todas" || campanhas[c] === st.plat; }).sort();
    var grupos = []; contasVisiveis().forEach(function (c) { var g = grupoDe(c); if (grupos.indexOf(g) < 0) grupos.push(g); });

    function selo(p, cls, nome) { // estado: conectado (há contas ativas e dados), exemplo, ou sem conta
      var contasP = contasVisiveis().filter(function (c) { return c.plataforma === p; }).length, dadosP = todas.some(function (r) { return r.plataforma === p; });
      var est = dadosP ? "on" : contasP ? "warn" : "off";
      var txt = dadosP ? contasP + " conta" + (contasP === 1 ? "" : "s") : contasP ? contasP + " cliente" + (contasP === 1 ? "" : "s") + " · sem sincronizar" : "conectar";
      var tit = st.plat === p ? "Mostrando só " + nome + " — clique para ver todas as plataformas" : "Filtrar o dashboard por " + nome;
      return '<button type="button" class="' + cls + (st.plat === p ? " ativo" : "") + '" data-selo="' + p + '" title="' + tit + '"><i class="' + est + '"></i>' + nome + " <small>" + txt + "</small></button>";
    }
    el.innerHTML = '<div class="cads' + (T ? " modo-totais" : "") + '">' +
      (!st.linhas.length ? '<div class="c-demo"><b>SEM MÉTRICAS DIÁRIAS AINDA</b> — os números dos clientes abaixo usam os totais informados no cadastro. Para gráficos por dia e campanha, sincronize as contas ou importe o CSV do Google Ads. <button data-imp-abrir>Importar relatórios</button></div>' : "") +
      '<div class="c-bar"><div class="c-logos">' + selo("google", "lg-g", "Google Ads") + selo("meta", "lg-m", "Meta Ads") +
      '<button type="button" class="lg-c" data-ir-crm title="Ver o cruzamento das campanhas com o CRM: leads, qualificados, visitas e vendas"><i class="' + (A.S.leads.length ? "on" : "off") + '"></i>CRM <small>' + n0(A.S.leads.length) + " leads</small></button></div>" +
      '<div class="c-fil"><div class="c-seg">' + [7, 14, 30, 90].map(function (d) { return '<button data-dias="' + d + '"' + (!st.de && st.dias === d ? ' class="on"' : "") + ">" + d + "d</button>"; }).join("") + "</div>" +
      '<label class="c-dt"><input type="date" data-de value="' + sDe + '"> – <input type="date" data-ate value="' + sAte + '"></label>' +
      (grupos.length ? '<select data-conta><option value="">Todos os clientes</option>' + grupos.map(function (g) { return '<option value="' + A.esc(g) + '"' + (st.conta === g ? " selected" : "") + ">" + A.esc(rotuloGrupo(g)) + "</option>"; }).join("") + "</select>" : "") +
      (contasVisiveis().some(function (c) { return c.nicho; }) ? '<select data-nicho><option value="">Todos os nichos</option>' + Object.keys(NICHO).map(function (k) { return '<option value="' + k + '"' + (st.nicho === k ? " selected" : "") + ">" + NICHO[k] + "</option>"; }).join("") + "</select>" : "") +
      '<select data-plat>' + platOpts.map(function (o) { return '<option value="' + o[0] + '"' + (st.plat === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
      '<select data-camp><option value="">Todas as campanhas</option>' + camps.map(function (c) { return '<option' + (st.camp === c ? " selected" : "") + ">" + A.esc(c) + "</option>"; }).join("") + "</select>" +
      (st.linhas.some(function (r) { return r.moeda !== st.moeda; }) ? '<select data-moeda><option' + (st.moeda === "BRL" ? " selected" : "") + '>BRL</option><option' + (st.moeda === "USD" ? " selected" : "") + ">USD</option></select>" : "") +
      '<button class="c-btn" data-contas-abrir>⚭ Contas conectadas</button><button class="c-btn ghost" data-imp-abrir>⇪ Importar CSV</button>' + "</div></div>" +
      (T ? '<p class="c-per">Totais acumulados desde o início de cada cliente · os gráficos por dia aparecem quando as contas forem sincronizadas ou o CSV for importado</p>' : '<p class="c-per">' + dt(sDe).toLocaleDateString("pt-BR") + " a " + dt(sAte).toLocaleDateString("pt-BR") + " · comparado com " + dt(sADe).toLocaleDateString("pt-BR") + " a " + dt(sAAte).toLocaleDateString("pt-BR") + (st.camp ? ' · campanha <b>' + A.esc(st.camp) + '</b> <button class="c-x" data-limpar>×</button>' : "") + "</p>") +

      (T ? blocoTotais() : (
      '<div class="c-grid2"><section class="c-box"><h3>Desempenho no período</h3><div class="c-tiles">' +
      tile("t-blue", "◉", "Impressões", kfmt(a.imp), dlt(a.imp, b.imp)) +
      tile("t-red", "➚", "Cliques", kfmt(a.cli), dlt(a.cli, b.cli)) +
      tile("t-purple", "↗", "CTR", pct(a.ctr), dlt(a.ctr, b.ctr)) +
      tile("t-green", "▤", "Investimento", curK(a.custo, m), dlt(a.custo, b.custo), "") +
      "</div></section>" +
      '<section class="c-box"><h3>Conversões</h3><div class="c-tiles">' +
      tile("t-orange", "⏷", "Conversões (plataformas)", n0(a.conv), dlt(a.conv, b.conv)) +
      tile("t-orange2", "▦", "Taxa de conversão", pct(a.tx), dlt(a.tx, b.tx)) +
      tile("t-indigo", "◎", "Custo / conversão", cur(a.cpa, m), dlt(a.cpa, b.cpa, true)) +
      tile("t-indigo2", "$", "Valor de conversão", curK(a.valor, m), dlt(a.valor, b.valor), a.roas ? "ROAS " + a.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x" : "") +
      "</div></section></div>" +

      '<section class="c-box c-crm"><h3>Do anúncio à venda <small>cruzamento com o CRM</small></h3><div class="c-funil">' +
      [["Impressões", a.imp, ""], ["Cliques", a.cli, pct(a.ctr)], ["Leads no CRM", leadsP, a.cli ? pct(leadsP / a.cli * 100) : "—"], ["Qualificados", qualP, leadsP ? pct(qualP / leadsP * 100) : "—"], ["Visitas", visP, qualP ? pct(visP / qualP * 100) : "—"], ["Vendas", vendasP, visP ? pct(vendasP / visP * 100) : "—"]].map(function (f, i) {
        return '<div class="cf" style="--i:' + i + '"><small>' + f[0] + "</small><b>" + kfmt(f[1]) + "</b>" + (f[2] ? "<em>" + f[2] + "</em>" : "") + "</div>";
      }).join("") + '</div><div class="c-kpis">' +
      '<div><small>Custo por lead (CRM)</small><b>' + (leadsP ? cur(a.custo / leadsP, m) : "—") + "</b>" + (leadsP && leadsA ? dlt(a.custo / leadsP, b.custo / leadsA, true) : "") + "</div>" +
      '<div><small>Custo por lead qualificado</small><b>' + (qualP ? cur(a.custo / qualP, m) : "—") + "</b>" + (qualP && qualA ? dlt(a.custo / qualP, b.custo / qualA, true) : "") + "</div>" +
      '<div><small>Vendido (CRM)</small><b>' + (valorP ? curK(valorP, mValor) : "—") + "</b><span>" + vendasP + " venda(s)" + (valorP && a.custo && mValor === m ? " · " + (valorP / a.custo).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "x o investimento" : "") + "</span></div>" +
      '<div><small>Leads sem campanha identificada</small><b>' + crmP.semC.leads + "</b><span>vieram de Meta/Google sem utm_campaign</span></div></div></section>"
      )) +

      '<section class="c-box c-clis"><div class="c-h"><h3>Clientes Google Ads <small>contas com campanhas ativas</small></h3><small>clique num cliente para filtrar o dashboard</small></div><div data-clis></div></section>' +
      '<section class="c-box c-diario"><div class="c-h"><h3>Evolução diária</h3><div class="c-seg sm">' + [["custo", "Investimento"], ["conv", "Conversões"], ["cliques", "Cliques"]].map(function (g) { return '<button data-graf="' + g[0] + '"' + (st.graf === g[0] ? ' class="on"' : "") + ">" + g[1] + "</button>"; }).join("") + '</div></div><div class="c-combo-w" data-combo></div><div class="c-leg" data-leg></div></section>' +

      '<div class="c-grid2 c-diario">' + ["meta", "google"].map(function (p) {
        var x = p === "meta" ? mA : gA, rows = platRows(p), lp = leadsPlat(p);
        return '<section class="c-box c-plat ' + p + '"><div class="c-h"><h3><i></i>' + NOME[p] + '</h3><small>' + rows.length + " registros</small></div>" +
          (rows.length ? '<div class="c-mini"><div><small>Investimento</small><b>' + curK(x.custo, m) + '</b></div><div><small>' + (p === "meta" ? "Resultados" : "Conversões") + "</small><b>" + n0(x.conv) + '</b></div><div><small>Custo por resultado</small><b>' + cur(x.cpa, m) + '</b></div><div><small>CTR</small><b>' + pct(x.ctr) + '</b></div><div><small>CPC</small><b>' + cur(x.cpc, m) + '</b></div><div><small>Leads no CRM</small><b>' + n0(lp) + "</b></div></div>" +
            '<p class="c-sub">' + (p === "meta" ? "Resultados" : "Conversões") + " por dia da semana</p>" + semana(rows, "conversoes", COR[p]) : '<div class="c-vazio">Sem dados do ' + NOME[p] + ' no período.<button data-imp-abrir data-p="' + p + '">Importar relatório</button></div>') + "</section>";
      }).join("") + "</div>" +

      (a.views ? '<section class="c-box c-video c-diario"><div class="c-h"><h3>▶ Vídeo <small>campanhas de prospecção</small></h3><small>visualizações e retenção</small></div><div class="c-vgrid">' +
        '<div class="c-vk"><small>Visualizações</small><b>' + kfmt(a.views) + "</b>" + dlt(a.views, b.views) + "</div>" +
        '<div class="c-vk"><small>Taxa de visualização</small><b>' + pct(a.vtr) + "</b>" + dlt(a.vtr, b.vtr) + "</div>" +
        '<div class="c-vk"><small>Custo por visualização</small><b>' + cur(a.cpv, m) + "</b>" + dlt(a.cpv, b.cpv, true) + "</div>" +
        '<div class="c-vk"><small>Assistiram até o fim</small><b>' + kfmt(a.p100) + "</b><span>" + (a.views ? pct(a.p100 / a.views * 100) + " das visualizações" : "") + "</span></div>" +
        '<div class="c-ret">' + [["Início", a.views], ["25%", a.p25], ["50%", a.p50], ["75%", a.p75], ["100%", a.p100]].map(function (q, i) {
          var pc = a.views ? q[1] / a.views * 100 : 0; return '<div><span>' + q[0] + '</span><div class="c-ret-t"><i style="width:' + pc.toFixed(1) + "%;animation-delay:" + i * 80 + 'ms"></i></div><b>' + pct(pc) + "</b></div>";
        }).join("") + "</div></div></section>" : "") +
      '<div class="c-grid2 c-diario"><section class="c-box c-av blue"><div><small>CPC médio</small><b>' + cur(a.cpc, m) + "</b>" + dlt(a.cpc, b.cpc, true) + "</div>" + area(sCPC, "#3ec5f0") + '</section><section class="c-box c-av orange"><div><small>CPM médio</small><b>' + cur(a.cpm, m) + "</b>" + dlt(a.cpm, b.cpm, true) + "</div>" + area(sCPM, "#f97362") + "</section></div>" +

      '<section class="c-box c-diario"><div class="c-h"><h3>Campanhas</h3><small>clique numa linha para filtrar o dashboard · clique no título da coluna para ordenar</small></div><div class="c-tab" data-tab></div></section>' +
      '</div>';

    // gráfico combinado
    var cfg = { custo: { vals: sCusto, nome: "Investimento", fmt: function (v) { return cur(v, m); } }, conv: { vals: sConv, nome: "Conversões", fmt: n0 }, cliques: { vals: sCli, nome: "Cliques", fmt: n0 } }[st.graf];
    var linhas = st.graf === "cliques" ? [{ vals: sImp, cor: "#f7c948", nome: "Impressões" }, { vals: sConv, cor: "#2fdc9a", nome: "Conversões" }] : [{ vals: sCli, cor: "#f7c948", nome: "Cliques" }, { vals: st.graf === "conv" ? sCusto : sConv, cor: "#2fdc9a", nome: st.graf === "conv" ? "Investimento" : "Conversões" }];
    var cw = el.querySelector("[data-combo]");
    cw.innerHTML = P.length ? combo(dias, { vals: cfg.vals, cor: "#ff8a3d" }, linhas, dias.map(function (d) { return d.slice(8, 10) + "/" + d.slice(5, 7); })) + '<div class="c-tip" hidden></div>' : '<div class="c-vazio">Sem dados no período.</div>';
    el.querySelector("[data-leg]").innerHTML = '<span><i style="background:#ff8a3d"></i>' + cfg.nome + " (barras)</span>" + linhas.map(function (s) { return '<span><i style="background:' + s.cor + '"></i>' + s.nome + "</span>"; }).join("");
    var svg = cw.querySelector("svg");
    if (svg) svg.querySelectorAll("[data-i]").forEach(function (r) {
      r.addEventListener("mousemove", function (ev) {
        var i = +r.dataset.i, tip = cw.querySelector(".c-tip"), box = cw.getBoundingClientRect();
        tip.innerHTML = "<strong>" + dt(dias[i]).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) + "</strong><div>Investimento <b>" + cur(sCusto[i], m) + "</b></div><div>Impressões <b>" + n0(sImp[i]) + "</b></div><div>Cliques <b>" + n0(sCli[i]) + "</b></div><div>Conversões <b>" + n0(sConv[i]) + "</b></div><div>CPC <b>" + cur(sCPC[i], m) + "</b></div>";
        tip.hidden = false; tip.style.left = Math.min(box.width - 180, Math.max(0, ev.clientX - box.left + 14)) + "px";
      });
      r.addEventListener("mouseleave", function () { cw.querySelector(".c-tip").hidden = true; });
    });

    // tabela de campanhas
    var porCamp = {}, porCampA = {};
    P.forEach(function (r) { (porCamp[r.campanha] = porCamp[r.campanha] || []).push(r); });
    todas.filter(function (r) { return r.data >= sADe && r.data <= sAAte; }).forEach(function (r) { (porCampA[r.campanha] = porCampA[r.campanha] || []).push(r); });
    var tab = Object.keys(porCamp).map(function (c) {
      var x = agg(porCamp[c]), y = agg(porCampA[c] || []), k = crmP.porC[c] || { leads: 0, qual: 0, vendas: 0 };
      return { c: c, p: campanhas[c], x: x, y: y, leads: k.leads, qual: k.qual, vendas: k.vendas, cpl: k.leads ? x.custo / k.leads : 0 };
    });
    var chave = { campanha: function (o) { return o.c; }, imp: function (o) { return o.x.imp; }, cli: function (o) { return o.x.cli; }, ctr: function (o) { return o.x.ctr; }, custo: function (o) { return o.x.custo; }, conv: function (o) { return o.x.conv; }, cpa: function (o) { return o.x.cpa; }, leads: function (o) { return o.leads; }, qual: function (o) { return o.qual; }, cpl: function (o) { return o.cpl; }, vendas: function (o) { return o.vendas; }, views: function (o) { return o.x.views; }, vtr: function (o) { return o.x.vtr; } }[st.ordem];
    tab.sort(function (p, q) { var a1 = chave(p), b1 = chave(q); return (a1 > b1 ? 1 : a1 < b1 ? -1 : 0) * (st.desc ? -1 : 1); });
    var mx = { imp: 1, cli: 1, custo: 1, conv: 1 }; tab.forEach(function (o) { mx.imp = Math.max(mx.imp, o.x.imp); mx.cli = Math.max(mx.cli, o.x.cli); mx.custo = Math.max(mx.custo, o.x.custo); mx.conv = Math.max(mx.conv, o.x.conv); });
    var cel = function (v, max, cor, txt, d) { return '<td class="hb"><i style="width:' + (v / max * 100).toFixed(1) + "%;background:" + cor + '"></i><span>' + txt + "</span>" + (d || "") + "</td>"; };
    var th = function (k, t) { return '<th data-ord="' + k + '"' + (st.ordem === k ? ' class="on"' : "") + ">" + t + (st.ordem === k ? (st.desc ? " ▾" : " ▴") : "") + "</th>"; };
    el.querySelector("[data-tab]").innerHTML = tab.length ? '<div class="c-scroll"><table><thead><tr>' + th("campanha", "Campanha") + th("imp", "Impressões") + th("cli", "Cliques") + th("ctr", "CTR") + th("custo", "Investimento") + th("conv", "Conversões") + th("cpa", "Custo/conv.") + th("leads", "Leads CRM") + th("qual", "Qualif.") + th("cpl", "CPL real") + th("vendas", "Vendas") + th("views", "Views") + th("vtr", "VTR") + "</tr></thead><tbody>" +
      tab.map(function (o) {
        return '<tr data-c="' + A.esc(o.c) + '"' + (st.camp === o.c ? ' class="on"' : "") + '><td><span class="pb ' + o.p + '">' + (o.p === "meta" ? "Meta" : "Google") + "</span>" + A.esc(o.c) + "</td>" +
          cel(o.x.imp, mx.imp, "rgba(62,197,240,.25)", kfmt(o.x.imp), dlt(o.x.imp, o.y.imp)) + cel(o.x.cli, mx.cli, "rgba(239,68,68,.25)", kfmt(o.x.cli), dlt(o.x.cli, o.y.cli)) +
          "<td>" + pct(o.x.ctr) + "</td>" + cel(o.x.custo, mx.custo, "rgba(47,220,154,.22)", curK(o.x.custo, m), dlt(o.x.custo, o.y.custo)) + cel(o.x.conv, mx.conv, "rgba(255,138,61,.25)", n0(o.x.conv), dlt(o.x.conv, o.y.conv)) +
          "<td>" + (o.x.conv ? cur(o.x.cpa, m) : "—") + "</td><td>" + o.leads + "</td><td>" + o.qual + "</td><td>" + (o.leads ? cur(o.cpl, m) : "—") + "</td><td>" + (o.vendas || "—") + "</td><td>" + (o.x.views ? kfmt(o.x.views) : "—") + "</td><td>" + (o.x.views ? pct(o.x.vtr) : "—") + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr><td>Total</td><td>' + kfmt(a.imp) + "</td><td>" + kfmt(a.cli) + "</td><td>" + pct(a.ctr) + "</td><td>" + curK(a.custo, m) + "</td><td>" + n0(a.conv) + "</td><td>" + (a.conv ? cur(a.cpa, m) : "—") + "</td><td>" + leadsP + "</td><td>" + qualP + "</td><td>" + (leadsP ? cur(a.custo / leadsP, m) : "—") + "</td><td>" + vendasP + "</td><td>" + (a.views ? kfmt(a.views) : "—") + "</td><td>" + (a.views ? pct(a.vtr) : "—") + "</td></tr></tfoot></table></div>" : '<div class="c-vazio">Nenhuma campanha com dados neste período.</div>';

    // tabela de clientes Google Ads (por conta): métricas sincronizadas do período quando houver; senão, totais do cadastro (acumulado)
    var campConta = {}; todas.forEach(function (r) { campConta[r.campanha] = String(r.conta_anuncio || ""); });
    var cliG = contasVisiveis().filter(function (c) { return c.plataforma === "google" && (!st.nicho || c.nicho === st.nicho); }).map(function (c) {
      var idc = idConta(c), rows = idc ? P.filter(function (r) { return r.plataforma === "google" && String(r.conta_anuncio) === idc; }) : [], x = agg(rows), k = { leads: 0, vendas: 0, valor: 0 };
      if (idc) Object.keys(crmP.porC).forEach(function (cp) { if (campConta[cp] === idc && campanhas[cp] === "google") { var o = crmP.porC[cp]; k.leads += o.leads || 0; k.vendas += o.vendas || 0; k.valor += o.valor || 0; } });
      var sinc = rows.length > 0, mo = sinc ? m : (c.moeda || "BRL");
      var o = { c: c, sinc: sinc, moeda: mo, sc: statusConta(c),
        investido: sinc ? x.custo : +(c.investido || 0), cliques: sinc ? x.cli : (c.cliques != null ? +c.cliques : null),
        leads: sinc ? k.leads : (c.leads != null ? +c.leads : null), vendas: sinc ? k.vendas : (c.vendas != null ? +c.vendas : null),
        valor: sinc ? k.valor : (c.valor_vendas != null ? +c.valor_vendas : null) };
      o.cpl = o.leads ? o.investido / o.leads : null; o.cpv = o.vendas ? o.investido / o.vendas : null;
      o.conv = o.leads && o.vendas != null ? o.vendas / o.leads * 100 : null; o.cpc = o.cliques ? o.investido / o.cliques : null;
      o.roi = o.valor && o.investido ? o.valor / o.investido : null;
      var est = sinc ? [] : (c.estimados || []); o.est = function (campo) { return est.indexOf(campo) >= 0; };
      o.estCpl = o.est("leads"); o.estConv = o.est("leads"); o.estRoi = o.est("valor_vendas");
      return o;
    });
    var ordCli = { investido: function (o) { return o.investido; }, vendas: function (o) { return o.vendas || 0; }, cpv: function (o) { return o.cpv == null ? Infinity : o.cpv; }, cpl: function (o) { return o.cpl == null ? Infinity : o.cpl; }, leads: function (o) { return o.leads || 0; }, nome: function (o) { return o.c.nome; } }[st.ordemCli] || function (o) { return o.investido; };
    var crescente = st.ordemCli === "nome" || st.ordemCli === "cpv" || st.ordemCli === "cpl";
    cliG.sort(function (p, q) { var x1 = ordCli(p), y1 = ordCli(q); return st.ordemCli === "nome" ? String(x1).localeCompare(String(y1)) : crescente ? x1 - y1 : y1 - x1; });
    var soma = function (lista, campo) { return lista.reduce(function (t, o) { return t + (o[campo] || 0); }, 0); };
    var moedaTot = cliG.length && cliG.every(function (o) { return o.moeda === cliG[0].moeda; }) ? cliG[0].moeda : "BRL";
    var comVenda = cliG.filter(function (o) { return o.vendas; }), comLead = cliG.filter(function (o) { return o.leads; });
    var tot = { inv: soma(cliG, "investido"), vendas: soma(cliG, "vendas"), leads: soma(cliG, "leads"), cliques: soma(cliG, "cliques"), valor: soma(cliG, "valor"), invV: soma(comVenda, "investido"), invL: soma(comLead, "investido"), vendasL: soma(comLead, "vendas") };
    var invValor = soma(cliG.filter(function (o) { return o.valor; }), "investido");
    var mxI = Math.max.apply(null, cliG.map(function (o) { return o.investido; }).concat([1]));
    var thc = function (k, t, tit) { return '<th data-ordcli="' + k + '"' + (st.ordemCli === k ? ' class="on"' : "") + (tit ? ' title="' + tit + '"' : "") + ">" + t + (st.ordemCli === k ? (crescente ? " ▴" : " ▾") : "") + "</th>"; };
    var porNicho = {}; cliG.forEach(function (o) { var n = o.c.nicho || "outro"; var t = porNicho[n] = porNicho[n] || []; t.push(o); });
    var cardN = function (cls, rot, lista) {
      var inv = soma(lista, "investido"), vd = soma(lista, "vendas"), lv = lista.filter(function (o) { return o.vendas; }), iv = soma(lv, "investido");
      return '<div class="cn ' + cls + '"><small>' + rot + " · " + lista.length + " cliente" + (lista.length === 1 ? "" : "s") + '</small><b>' + curK(inv, moedaTot) + '</b><span>investido · ' + n0(vd) + " vendas · custo médio por venda " + (vd ? cur(iv / vd, moedaTot) : "—") + (soma(lista, "valor") ? " · vendido " + curK(soma(lista, "valor"), moedaTot) : "") + "</span></div>";
    };
    var mostra = function (v, f, estimado) { return v == null ? '<span class="pend">—</span>' : estimado ? '<span class="estm" title="Estimativa — informe o valor real em Contas conectadas">≈ ' + f(v) + "</span>" : f(v); };
    var temEst = cliG.some(function (o) { return o.est("cliques") || o.est("leads") || o.est("valor_vendas"); });
    el.querySelector("[data-clis]").innerHTML = cliG.length ?
      '<div class="c-nichos">' + Object.keys(porNicho).map(function (n) { return cardN(n, NICHO[n] || "Outros", porNicho[n]); }).join("") + (Object.keys(porNicho).length > 1 ? cardN("tot", "Total", cliG) : "") + "</div>" +
      (cliG.filter(function (o) { return o.investido && o.leads == null; }).length ? '<p class="c-aviso">Custo por lead e conversão aparecem quando os leads de cada cliente forem informados (em "Contas conectadas") ou quando as contas forem sincronizadas.</p>' : "") +
      '<div class="c-scroll"><table><thead><tr><th>Código</th><th>ID Google Ads</th>' + thc("nome", "Cliente") + "<th>Nicho</th><th>Status</th>" + thc("investido", "Investido", "Acumulado desde o início (ou do período, se sincronizado)") + "<th>Cliques</th>" + thc("leads", "Leads") + thc("cpl", "Custo/lead") + thc("vendas", "Vendas") + thc("cpv", "Custo/venda") + '<th title="Vendas ÷ leads">Lead → venda</th><th>Vendido</th><th title="Vendido ÷ investido">Retorno</th></tr></thead><tbody>' +
      cliG.map(function (o) {
        var g = grupoDe(o.c), mo = o.moeda;
        var verba = o.c.verba ? '<span class="cv">verba ' + cur(o.c.verba, mo) + (o.sc.k === "programada" ? " planejada" : "") + "</span>" : "";
        return '<tr data-cli="' + A.esc(g) + '"' + (st.conta === g ? ' class="on"' : "") + '><td class="mono">' + A.esc(o.c.codigo || "—") + '</td><td class="mono">' + (o.c.conta_externa ? A.esc(o.c.conta_externa) : '<span class="sem-id">informar ID</span>') + "</td><td><b>" + A.esc(o.c.nome) + "</b>" + (o.sinc ? ' <span class="nb sinc" title="Métricas do período sincronizadas">sincronizado</span>' : "") + '</td><td><span class="nb ' + (o.c.nicho || "") + '">' + (NICHO[o.c.nicho] || "—") + '</span></td><td><span class="st ' + o.sc.k + '">' + o.sc.t + "</span></td>" +
          '<td class="hb"><i style="width:' + (o.investido / mxI * 100).toFixed(1) + '%;background:rgba(47,220,154,.22)"></i><span><b>' + (o.investido ? cur(o.investido, mo) : "—") + "</b></span>" + verba + "</td><td>" + mostra(o.cliques, n0, o.est("cliques")) + "</td><td>" + mostra(o.leads, n0, o.est("leads")) + "</td><td>" + mostra(o.cpl, function (v) { return cur(v, mo); }, o.estCpl) + "</td><td>" + mostra(o.vendas, n0, o.est("vendas")) + "</td><td><b>" + mostra(o.cpv, function (v) { return cur(v, mo); }) + "</b></td><td>" + mostra(o.conv, pct, o.estConv) + "</td><td>" + mostra(o.valor, function (v) { return curK(v, mo); }, o.estRoi) + "</td><td>" + mostra(o.roi, function (v) { return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x"; }, o.estRoi) + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr><td></td><td></td><td>Total</td><td></td><td></td><td>' + cur(tot.inv, moedaTot) + "</td><td>" + (tot.cliques ? n0(tot.cliques) : "—") + "</td><td>" + (tot.leads ? n0(tot.leads) : "—") + "</td><td>" + (tot.leads ? cur(tot.invL / tot.leads, moedaTot) : "—") + "</td><td>" + n0(tot.vendas) + "</td><td>" + (tot.vendas ? cur(tot.invV / tot.vendas, moedaTot) : "—") + "</td><td>" + (tot.leads ? pct(tot.vendasL / tot.leads * 100) : "—") + "</td><td>" + (tot.valor ? curK(tot.valor, moedaTot) : "—") + "</td><td>" + (tot.valor && invValor ? (tot.valor / invValor).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x" : "—") + "</td></tr></tfoot></table></div>" +
      (temEst ? '<p class="c-leg-est"><span class="estm">≈</span> estimativa: leads e cliques calculados a partir do investimento com custo por lead de referência por perfil de cliente (R$ 32 a R$ 130) e taxa de clique → lead de 4% a 11%; valor vendido no agro proporcional ao retorno da Jumil (27,5x), em veículos pelo ticket médio de referência (R$ 75 mil) e em imóveis pelo ticket médio de mercado (R$ 350 mil por unidade). Ao informar o número real em "Contas conectadas", a marca some.</p>' : "")
      : '<div class="c-vazio">Nenhuma conta do Google Ads cadastrada. Use "Contas conectadas" para adicionar.</div>';

    // eventos
    var re = function () { render(el, A); };
    el.querySelectorAll("[data-selo]").forEach(function (x) { x.addEventListener("click", function () {
      var p = x.dataset.selo, temDados = todas.some(function (r) { return r.plataforma === p; });
      if (!temDados && !contasVisiveis().some(function (c) { return c.plataforma === p; })) { abrirContas(el, A); return; } // ainda não conectado: abre o cadastro de contas
      st.plat = st.plat === p ? "todas" : p; st.camp = ""; re();
    }); });
    var irCrm = el.querySelector("[data-ir-crm]"); if (irCrm) irCrm.addEventListener("click", function () {
      var alvo = el.querySelector(".c-crm"); if (!alvo) return;
      alvo.scrollIntoView({ behavior: "smooth", block: "start" }); alvo.classList.remove("piscar"); void alvo.offsetWidth; alvo.classList.add("piscar");
    });
    el.querySelectorAll("[data-ordcli]").forEach(function (x) { x.addEventListener("click", function () { st.ordemCli = x.dataset.ordcli; re(); }); });
    el.querySelectorAll("tr[data-cli]").forEach(function (x) { x.addEventListener("click", function () { st.conta = st.conta === x.dataset.cli ? "" : x.dataset.cli; st.camp = ""; re(); }); });
    var sn = el.querySelector("[data-nicho]"); if (sn) sn.addEventListener("change", function (e) { st.nicho = e.target.value; st.conta = ""; st.camp = ""; re(); });
    el.querySelectorAll("[data-dias]").forEach(function (x) { x.addEventListener("click", function () { st.dias = +x.dataset.dias; st.de = st.ate = null; re(); }); });
    el.querySelector("[data-de]").addEventListener("change", function (e) { st.de = e.target.value; st.ate = el.querySelector("[data-ate]").value; re(); });
    el.querySelector("[data-ate]").addEventListener("change", function (e) { st.ate = e.target.value; st.de = el.querySelector("[data-de]").value; re(); });
    el.querySelector("[data-plat]").addEventListener("change", function (e) { st.plat = e.target.value; st.camp = ""; re(); });
    var sc = el.querySelector("[data-conta]"); if (sc) sc.addEventListener("change", function (e) { st.conta = e.target.value; st.camp = ""; re(); });
    el.querySelector("[data-contas-abrir]").addEventListener("click", function () { abrirContas(el, A); });
    el.querySelector("[data-camp]").addEventListener("change", function (e) { st.camp = e.target.value; re(); });
    var sm = el.querySelector("[data-moeda]"); if (sm) sm.addEventListener("change", function (e) { st.moeda = e.target.value; re(); });
    el.querySelectorAll("[data-graf]").forEach(function (x) { x.addEventListener("click", function () { st.graf = x.dataset.graf; re(); }); });
    el.querySelectorAll("[data-ord]").forEach(function (x) { x.addEventListener("click", function () { if (st.ordem === x.dataset.ord) st.desc = !st.desc; else { st.ordem = x.dataset.ord; st.desc = x.dataset.ord !== "campanha" && x.dataset.ord !== "cpa" && x.dataset.ord !== "cpl"; } re(); }); });
    el.querySelectorAll("tr[data-c]").forEach(function (x) { x.addEventListener("click", function () { st.camp = st.camp === x.dataset.c ? "" : x.dataset.c; re(); }); });
    var lp = el.querySelector("[data-limpar]"); if (lp) lp.addEventListener("click", function () { st.camp = ""; re(); });
    el.querySelectorAll("[data-imp-abrir]").forEach(function (x) { x.addEventListener("click", function () { abrirImport(el, A, x.dataset.p || "auto"); }); });
  }

  function janela(el) { // fica fora da área redesenhada, para não fechar quando o dashboard atualiza
    var d = document.getElementById("cadsDlg");
    if (!d) { d = document.createElement("dialog"); d.id = "cadsDlg"; d.className = "c-dlg cads"; el.parentNode.appendChild(d); }
    return d;
  }
  // ---------- janela de importação ----------
  function abrirImport(el, A, plat) {
    var dlg = janela(el);
    dlg.innerHTML = '<form method="dialog" class="c-imp"><h3>Importar relatório de campanhas</h3>' +
      '<p>Exporte do gerenciador o relatório <b>por dia e por campanha</b> e envie o arquivo CSV aqui. Pode importar o mesmo período de novo: os números são atualizados, sem duplicar.</p>' +
      '<div class="c-how"><div><b>Google Ads</b><ol><li>Campanhas → selecione o período</li><li>Segmentar → Tempo → <b>Dia</b></li><li>Colunas: Impressões, Cliques, Custo, Conversões, Valor conv.</li><li>Fazer download → <b>CSV</b></li></ol></div>' +
      '<div><b>Meta Ads</b><ol><li>Gerenciador de Anúncios → Campanhas → período</li><li>Detalhamento → Por tempo → <b>Dia</b></li><li>Colunas: Impressões, Cliques no link, Valor usado, Resultados, Alcance</li><li>Exportar → <b>.csv</b></li></ol></div></div>' +
      '<label>Plataforma <select data-ip><option value="auto">Detectar automaticamente</option><option value="google"' + (plat === "google" ? " selected" : "") + '>Google Ads</option><option value="meta"' + (plat === "meta" ? " selected" : "") + ">Meta Ads</option></select></label>" +
      '<label>Conta de anúncio (cliente) <select data-iconta><option value="">Sem conta específica</option>' + st.contas.map(function (c) { return '<option value="' + idConta(c) + '" data-plat="' + c.plataforma + '">' + NOME[c.plataforma] + " · " + A.esc(c.nome || c.conta_externa) + "</option>"; }).join("") + "</select></label>" +
      '<label class="c-drop"><input type="file" accept=".csv,.tsv,.txt" data-if><span>Arraste o arquivo aqui ou clique para escolher</span></label><div data-prev class="c-prev"></div>' +
      '<div class="c-acts"><button value="cancel" class="c-btn ghost">Fechar</button><button type="button" class="c-btn" data-ok disabled>Importar</button></div></form>';
    dlg.showModal();
    var dados = null, inp = dlg.querySelector("[data-if]"), prev = dlg.querySelector("[data-prev]"), ok = dlg.querySelector("[data-ok]");
    async function processar() {
      var f = inp.files[0]; if (!f) return;
      try {
        var res = interpretar(lerTexto(await f.arrayBuffer()), dlg.querySelector("[data-ip]").value, dlg.querySelector("[data-iconta]").value);
        if (!res.linhas.length) throw new Error("O arquivo não tem linhas de dados por dia.");
        dados = res; var g = agg(res.linhas), ds = res.linhas.map(function (r) { return r.data; }).sort(), nc = {}; res.linhas.forEach(function (r) { nc[r.campanha] = 1; });
        prev.innerHTML = '<div class="ok">✓ ' + NOME[res.plat] + " · " + res.linhas.length + " linhas · " + Object.keys(nc).length + " campanha(s) · " + dt(ds[0]).toLocaleDateString("pt-BR") + " a " + dt(ds[ds.length - 1]).toLocaleDateString("pt-BR") + "<br>Impressões " + n0(g.imp) + " · Cliques " + n0(g.cli) + " · Investimento " + cur(g.custo, res.linhas[0].moeda) + " · Conversões " + n0(g.conv) + "</div>";
        ok.disabled = false;
      } catch (e) { dados = null; ok.disabled = true; prev.innerHTML = '<div class="err">' + A.esc(e.message) + "</div>"; }
    }
    inp.addEventListener("change", processar);
    dlg.querySelector("[data-ip]").addEventListener("change", processar);
    dlg.querySelector("[data-iconta]").addEventListener("change", function (e) { var o = e.target.selectedOptions[0]; if (o && o.dataset.plat) dlg.querySelector("[data-ip]").value = o.dataset.plat; processar(); });
    ok.addEventListener("click", async function () {
      if (!dados) return; ok.disabled = true; ok.textContent = "Importando…";
      var lotes = [], linhas = dados.linhas.map(function (r) { r.importado_por = A.S.me.id; return r; });
      for (var i = 0; i < linhas.length; i += 500) lotes.push(linhas.slice(i, i + 500));
      for (var j = 0; j < lotes.length; j++) {
        var r = await A.sb.from("campanhas_metricas").upsert(lotes[j], { onConflict: "data,plataforma,conta_anuncio,campanha,conjunto" });
        if (r.error) { ok.textContent = "Importar"; ok.disabled = false; return A.falha(r.error); }
      }
      dlg.close(); A.toast(linhas.length + " linhas importadas do " + NOME[dados.plat] + ".");
      await carregar(A); render(el, A);
    });
  }

  // ---------- contas de anúncio dos clientes ----------
  function abrirContas(el, A) {
    var dlg = janela(el);
    function desenhar() {
      dlg.innerHTML = '<div class="c-imp"><h3>Contas de anúncio dos clientes</h3>' +
        '<p>Cadastre o ID de cada conta. A sincronização puxa as métricas diárias por campanha direto das APIs do Google Ads e do Meta (últimos 30 dias por vez).</p>' +
        '<div class="c-contas">' + (st.contas.length ? st.contas.map(function (c) {
          var cl = st.clientes.find(function (x) { return x.id === c.conta_id; });
          var sc = statusConta(c);
          return '<div class="cc ' + c.plataforma + '"><span class="pb ' + c.plataforma + '">' + (c.plataforma === "meta" ? "Meta" : "Google") + "</span><div><b>" + (c.codigo ? '<span class="cod">' + A.esc(c.codigo) + "</span> " : "") + A.esc(c.nome || "Conta " + (c.conta_externa || "")) + ' <span class="st ' + sc.k + '">' + sc.t + "</span></b><small>" + (c.conta_externa ? "ID " + A.esc(c.conta_externa) : "ID da conta ainda não informado") + (c.nicho ? " · " + (NICHO[c.nicho] || c.nicho) : "") + (c.verba ? " · verba " + cur(c.verba, c.moeda || "BRL") : "") + (cl ? " · cliente " + A.esc(cl.nome) : "") + " · " + (c.ultima_sync ? "sincronizada " + new Date(c.ultima_sync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca sincronizada") + "</small>" +
            (c.ultimo_erro && c.conta_externa ? '<small class="cc-err">' + A.esc(traduzErro(c.ultimo_erro)) + "</small>" : "") +
            '<div class="cc-ed"><input data-ed-id="' + c.id + '" value="' + A.esc(c.conta_externa || "") + '" placeholder="ID da conta (ex.: 123-456-7890)"><select data-ed-st="' + c.id + '">' + [["programada", "Programada"], ["ativa", "Ativa"], ["pausada", "Pausada"], ["encerrada", "Encerrada"]].map(function (o) { return '<option value="' + o[0] + '"' + ((c.status || "ativa") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select><input type="date" data-ed-ini="' + c.id + '" value="' + (c.inicio_campanha || "") + '" title="Início da campanha"></div>' +
            '<div class="cc-num">' + [["investido", "Investido (" + (c.moeda || "BRL") + ")", c.investido], ["cliques", "Cliques", c.cliques], ["leads", "Leads", c.leads], ["vendas", "Vendas", c.vendas], ["valor_vendas", "Valor vendido", c.valor_vendas]].map(function (f) {
              return '<label>' + f[1] + ((c.estimados || []).indexOf(f[0]) >= 0 ? ' <em class="estm">≈ estimado</em>' : "") + '<input type="number" min="0" step="' + (f[0] === "investido" || f[0] === "valor_vendas" ? "0.01" : "1") + '" data-ed-num="' + c.id + '" data-campo="' + f[0] + '" value="' + (f[2] == null ? "" : f[2]) + '" placeholder="—"></label>';
            }).join("") + "</div>" +
            '</div><button class="c-btn ghost" data-sync="' + c.id + '"' + (c.conta_externa ? "" : " disabled title=\"Informe o ID da conta para sincronizar\"") + '>↻ Sincronizar</button><button class="c-x" data-rm="' + c.id + '" title="Desativar">×</button></div>';
        }).join("") : '<p class="c-sub">Nenhuma conta cadastrada.</p>') + "</div>" +
        '<form class="c-nova" data-nova><select name="plataforma"><option value="google">Google Ads</option><option value="meta">Meta Ads</option></select><input name="conta_externa" placeholder="ID da conta (opcional se ainda não existe)"><input name="nome" placeholder="Nome do cliente / conta" required><select name="nicho"><option value="imoveis">Imóveis</option><option value="agro">Agro e máquinas agrícolas</option><option value="veiculos">Veículos</option><option value="outro">Outro</option></select><input name="verba" type="number" min="0" step="0.01" placeholder="Verba (valor investido)"><select name="moeda"><option>BRL</option><option>USD</option></select><select name="status"><option value="ativa">Ativa</option><option value="programada">Programada</option></select><input name="inicio_campanha" type="date" title="Início da campanha"><select name="conta_id"><option value="">Cliente da cobrança (opcional)</option>' + st.clientes.map(function (c) { return '<option value="' + c.id + '">' + A.esc(c.nome) + "</option>"; }).join("") + '</select><button class="c-btn">Adicionar</button></form>' +
        '<details class="c-ajuda"><summary>O que é preciso para conectar</summary><div class="c-how"><div><b>Google Ads</b><ol><li>Uma conta de administrador (MCC) com acesso às contas dos clientes</li><li>Token de desenvolvedor da API (Central da API na MCC) com acesso básico aprovado</li><li>Projeto no Google Cloud com a Google Ads API ativada e um cliente OAuth</li><li>Refresh token gerado com a conta da MCC</li><li>No Supabase → Secrets: <code>GOOGLE_ADS_DEVELOPER_TOKEN</code>, <code>GOOGLE_ADS_CLIENT_ID</code>, <code>GOOGLE_ADS_CLIENT_SECRET</code>, <code>GOOGLE_ADS_REFRESH_TOKEN</code>, <code>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code></li></ol></div>' +
        '<div><b>Meta Ads</b><ol><li>Gerenciador de Negócios com acesso às contas de anúncio dos clientes</li><li>Usuário do sistema com a permissão <code>ads_read</code> nas contas</li><li>Gerar o token desse usuário (sem validade)</li><li>No Supabase → Secrets: <code>META_ADS_TOKEN</code></li></ol></div></div></details>' +
        '<div class="c-acts"><button class="c-btn" data-sync-todas' + (st.contas.length ? "" : " disabled") + '>↻ Sincronizar todas</button><button class="c-btn ghost" data-fechar>Fechar</button></div></div>';
      dlg.querySelector("[data-fechar]").addEventListener("click", function () { dlg.close(); });
      dlg.querySelector("[data-nova]").addEventListener("submit", async function (e) {
        e.preventDefault(); var f = new FormData(e.target);
        var r = await A.sb.from("contas_anuncio").insert({ plataforma: f.get("plataforma"), conta_externa: String(f.get("conta_externa") || "").trim() || null, nome: f.get("nome") || null, conta_id: f.get("conta_id") || null,
          nicho: f.get("nicho") || null, verba: f.get("verba") ? Number(f.get("verba")) : null, moeda: f.get("moeda") || null, status: f.get("status") || "ativa", inicio_campanha: f.get("inicio_campanha") || null });
        if (r.error) return A.falha(r.error);
        await recarregarContas(); desenhar(); A.toast("Conta adicionada. Clique em Sincronizar.");
      });
      var editar = async function (id, dados) { var r = await A.sb.from("contas_anuncio").update(dados).eq("id", id); if (r.error) return A.falha(r.error); await recarregarContas(); desenhar(); A.toast("Conta atualizada."); if (st.el) render(st.el, A); };
      dlg.querySelectorAll("[data-ed-id]").forEach(function (i) { i.addEventListener("change", function () { editar(i.dataset.edId, { conta_externa: i.value.trim() || null, ultimo_erro: null }); }); });
      dlg.querySelectorAll("[data-ed-num]").forEach(function (i) { i.addEventListener("change", function () {
        var d = {}, c = st.contas.find(function (x) { return x.id === i.dataset.edNum; }); d[i.dataset.campo] = i.value === "" ? null : Number(i.value);
        if (c && (c.estimados || []).indexOf(i.dataset.campo) >= 0) d.estimados = c.estimados.filter(function (f) { return f !== i.dataset.campo; }); // virou dado real
        editar(i.dataset.edNum, d);
      }); });
      dlg.querySelectorAll("[data-ed-st]").forEach(function (i) { i.addEventListener("change", function () { editar(i.dataset.edSt, { status: i.value }); }); });
      dlg.querySelectorAll("[data-ed-ini]").forEach(function (i) { i.addEventListener("change", function () { editar(i.dataset.edIni, { inicio_campanha: i.value || null }); }); });
      dlg.querySelectorAll("[data-rm]").forEach(function (b) { b.addEventListener("click", async function () { var r = await A.sb.from("contas_anuncio").update({ ativo: false }).eq("id", b.dataset.rm); if (r.error) return A.falha(r.error); await recarregarContas(); desenhar(); }); });
      var sincronizar = async function (botao, conta) {
        botao.disabled = true; botao.textContent = "Sincronizando…";
        var r = await A.sb.functions.invoke("ads-sync", { body: conta ? { conta: conta, dias: 30 } : { dias: 30 } });
        await recarregarContas();
        if (r.error) { A.toast("Não foi possível sincronizar agora.", true); desenhar(); return; }
        var ok = (r.data.resultado || []).filter(function (x) { return !x.erro; }), ln = ok.reduce(function (s, x) { return s + x.linhas; }, 0);
        A.toast(ok.length ? ln + " linha(s) atualizadas de " + ok.length + " conta(s)." : "Nenhuma conta sincronizou — veja o erro em cada conta.", !ok.length);
        await carregar(A); desenhar(); render(el, A);
      };
      dlg.querySelectorAll("[data-sync]").forEach(function (b) { b.addEventListener("click", function () { sincronizar(b, b.dataset.sync); }); });
      dlg.querySelector("[data-sync-todas]").addEventListener("click", function (e) { sincronizar(e.target, null); });
    }
    async function recarregarContas() { var ca = await A.sb.from("contas_anuncio").select("*").eq("ativo", true).order("criado_em"); st.contas = ca.data || []; }
    recarregarContas().then(function () { desenhar(); if (!dlg.open) dlg.showModal(); });
  }
  function traduzErro(e) {
    if (/google_nao_configurado/.test(e)) return "Faltam as credenciais do Google Ads no Supabase (Secrets).";
    if (/meta_nao_configurado/.test(e)) return "Falta o META_ADS_TOKEN no Supabase (Secrets).";
    if (/PERMISSION|permission|not authorized|User doesn't have permission/i.test(e)) return "Sem permissão nessa conta: dê acesso à MCC / usuário do sistema. (" + e.slice(0, 120) + ")";
    if (/DEVELOPER_TOKEN/i.test(e)) return "Token de desenvolvedor ainda não aprovado ou inválido. (" + e.slice(0, 120) + ")";
    return e;
  }

  D.modulos.push({
    id: "campanhas", titulo: "Campanhas", tituloLongo: "Campanhas · Google Ads e Meta Ads", icone: "◈", papeis: ["admin"], antes: "painel",
    render: async function (el, A) {
      st.el = el; st.A = A;
      if (!st.carregado) { el.innerHTML = '<div class="empty">Carregando campanhas…</div>'; await carregar(A); }
      render(el, A);
    }
  });
  D._campanhas = { interpretar: interpretar, agg: agg }; // usado nos testes
})();
