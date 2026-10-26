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
  var st = { plat: "todas", camp: "", dias: 30, de: null, ate: null, demo: false, linhas: [], moeda: "BRL", ordem: "custo", desc: true, graf: "custo", el: null, A: null, carregado: false, conta: "", nicho: "", contas: [], clientes: [], ordemCli: "vendido" };

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

  // ---------- dados de exemplo (não são gravados): 5 campanhas de prospecção em vídeo no Meta e 5 no Google ----------
  // 20 clientes de exemplo no Google Ads: [ID da conta, cliente, nicho, verba mensal R$, vendas fechadas/mês, ticket médio R$]
  var DEMO_CLIENTES = [
    ["123-456-7890", "Incorporadora Atlântica", "imoveis", 85000, 6, 1450000],
    ["987-654-3210", "Residencial Costa Azul", "imoveis", 62000, 4, 980000],
    ["214-583-9061", "Construtora Horizonte Sul", "imoveis", 48000, 5, 720000],
    ["305-772-1184", "Urbana Vertical Incorporações", "imoveis", 120000, 9, 1850000],
    ["418-209-6637", "Grupo Mirante Empreendimentos", "imoveis", 54000, 3, 2400000],
    ["529-640-3315", "Litoral Prime Imóveis", "imoveis", 36000, 4, 650000],
    ["631-087-4429", "Vale Nobre Loteamentos", "imoveis", 28000, 11, 280000],
    ["742-318-5506", "Torres do Parque Incorporadora", "imoveis", 72000, 5, 1200000],
    ["853-491-2278", "Alto Padrão Brickell Realty", "imoveis", 95000, 3, 3600000],
    ["964-125-8803", "Reserva das Águas Condomínio", "imoveis", 40000, 6, 890000],
    ["175-836-4092", "Imobiliária Ponto Central", "imoveis", 22000, 7, 520000],
    ["286-947-1150", "Incorporadora Nova Era", "imoveis", 66000, 5, 1050000],
    ["397-058-6624", "AgroMáquinas Cerrado", "agro", 58000, 7, 1350000],
    ["408-169-7735", "Tratores Planalto Revenda", "agro", 44000, 9, 680000],
    ["519-270-8846", "Colheita Forte Implementos", "agro", 76000, 4, 2900000],
    ["620-381-9957", "Campo Verde Máquinas Agrícolas", "agro", 39000, 6, 940000],
    ["731-492-0068", "Pivô & Irrigação Sertão", "agro", 31000, 5, 760000],
    ["842-503-1179", "Semeadoras Alto Paraná", "agro", 27000, 8, 410000],
    ["953-614-2280", "MaxAgro Pulverizadores", "agro", 52000, 5, 1600000],
    ["164-725-3391", "Rural Tech Concessionária", "agro", 88000, 6, 2200000]
  ];
  var NICHO = { imoveis: "Imóveis", agro: "Máquinas agrícolas" };
  var DEMO_CONTAS = DEMO_CLIENTES.map(function (c, i) { return { id: "g" + i, plataforma: "google", conta_externa: c[0], nome: c[1], nicho: c[2], ticket: c[5], verba: c[3] }; }).concat([
    { id: "m1", plataforma: "meta", conta_externa: "act_100200300", nome: "Incorporadora Atlântica", nicho: "imoveis", ticket: 1450000 },
    { id: "m2", plataforma: "meta", conta_externa: "act_400500600", nome: "Residencial Costa Azul", nicho: "imoveis", ticket: 980000 }
  ]);
  var DEMO_VENDA = {}; // campanha → { taxa: vendas por conversão, ticket }
  function demo() {
    // [plataforma, conta, campanha, impressões/dia, CTR %, CPC R$, conv. % dos cliques, views % das impressões, retenção 25/50/75/100 %]
    var camps = [
      ["google", "1234567890", "Prospecção · YouTube In-Stream · Faena 30s", 24000, .65, 1.9, 3.2, 31, [62, 41, 30, 22]],
      ["google", "1234567890", "Prospecção · Demand Gen · Vídeo Brickell", 18000, 1.1, 1.4, 3.8, 24, [58, 37, 26, 18]],
      ["google", "9876543210", "Prospecção · YouTube Shorts · Tour Continuum 15s", 30000, .5, 1.1, 2.6, 38, [70, 52, 41, 33]],
      ["google", "9876543210", "Prospecção · PMax com vídeo · Investidor EUA", 15000, 1.6, 1.6, 4.4, 14, [55, 34, 24, 16]],
      ["google", "1234567890", "Prospecção · Bumper 6s · Mandarin Oriental", 42000, .3, 1.2, 1.4, 52, [88, 76, 64, 58]],
      ["meta", "100200300", "Prospecção · Reels · Investidor BR 25-55", 32000, 1.4, .95, 4.6, 36, [48, 29, 20, 14]],
      ["meta", "100200300", "Prospecção · Stories · Vídeo tour Faena", 26000, 1.1, 1.05, 3.9, 33, [44, 26, 17, 11]],
      ["meta", "400500600", "Prospecção · Feed vídeo · Lookalike compradores 1%", 21000, 1.7, 1.2, 5.2, 28, [52, 33, 23, 16]],
      ["meta", "400500600", "Prospecção · Advantage+ · Vídeo lançamento Brickell", 38000, 1.2, .8, 3.4, 40, [46, 28, 19, 13]],
      ["meta", "100200300", "Prospecção · Reels · Alto padrão LATAM (ES)", 29000, 1.3, .7, 3.1, 37, [50, 31, 21, 15]]
    ];
    // 2 campanhas Google por cliente, com verba coerente com o mensal [plataforma, conta, campanha, impressões/dia, CTR %, CPC R$, conv. % dos cliques, views %, retenção]
    var MODELOS = {
      imoveis: [["Pesquisa · Lançamento", 4.8, 2.9, 7.5, 0], ["Performance Max · Decorado e plantas", 1.3, 1.7, 4.2, 9]],
      agro: [["Pesquisa · Tratores e colheitadeiras", 5.6, 3.8, 6.1, 0], ["YouTube · Demonstração em campo", .8, 1.3, 2.4, 34]]
    };
    DEMO_CLIENTES.forEach(function (cl, i) {
      var md = MODELOS[cl[2]], idc = cl[0].replace(/\D/g, "");
      md.forEach(function (mo, k) {
        var gastoDia = cl[3] / 30 * (k ? .4 : .6) * (i < 2 ? .6 : 1), imp = Math.round(gastoDia / (mo[2] * mo[1] / 100));
        camps.push(["google", idc, mo[0] + " · " + cl[1], imp, mo[1], mo[2], mo[3], mo[4], mo[4] ? [60, 40, 28, 19] : [0, 0, 0, 0]]);
      });
    });
    // taxa de venda por conversão, para cada cliente fechar ~as vendas/mês definidas
    DEMO_CLIENTES.forEach(function (cl) {
      var idc = cl[0].replace(/\D/g, ""), cs = camps.filter(function (c) { return c[1] === idc; });
      var convMes = cs.reduce(function (s2, c) { return s2 + c[3] * c[4] / 100 * c[6] / 100 * 30; }, 0) || 1;
      cs.forEach(function (c) { DEMO_VENDA[c[2]] = { taxa: cl[4] / convMes / 1.25, ticket: cl[5] }; }); // 1,25 = crescimento médio do período recente
    });
    var seed = 11, rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var rows = [], hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    for (var d = 120; d >= 1; d--) {
      var dia = new Date(hoje.getTime() - d * DIA), fds = dia.getDay() === 0 || dia.getDay() === 6, ondas = 1 + .22 * Math.sin(d / 9) + (120 - d) / 420;
      camps.forEach(function (c) {
        var imp = Math.round(c[3] * ondas * (fds ? (c[0] === "meta" ? 1.12 : .84) : 1) * (.8 + rnd() * .4));
        var cli = Math.round(imp * c[4] / 100 * (.85 + rnd() * .3)), custo = +(cli * c[5] * (.85 + rnd() * .3) + (c[0] === "meta" ? imp * .006 : imp * .002)).toFixed(2);
        var conv = Math.round(cli * c[6] / 100 * (.6 + rnd() * .8)), views = Math.round(imp * c[7] / 100 * (.9 + rnd() * .2)), r = c[8];
        rows.push({ data: iso(dia), plataforma: c[0], conta_anuncio: c[1], campanha: c[2], conjunto: "", impressoes: imp, cliques: cli, custo: custo, moeda: "BRL",
          conversoes: conv, valor_conversoes: 0, alcance: Math.round(imp * .58), visualizacoes: views,
          video_p25: Math.round(views * r[0] / 100), video_p50: Math.round(views * r[1] / 100), video_p75: Math.round(views * r[2] / 100), video_p100: Math.round(views * r[3] / 100) });
      });
    }
    return rows;
  }
  function crmDemo(camp, conv) { // leads/qualificados/vendas coerentes com as conversões de exemplo
    var h = 0; for (var i = 0; i < camp.length; i++) h = (h * 31 + camp.charCodeAt(i)) % 97;
    var leads = Math.round(conv * (.82 + h / 500)), q = Math.round(leads * (.24 + h / 900)), v = Math.round(q * (.05 + h / 3000) * 10) / 10;
    var dv = DEMO_VENDA[camp];
    if (dv) { var vd = Math.round(conv * dv.taxa); return { leads: leads, qual: Math.max(q, vd * 4), vis: Math.max(Math.round(q * .45), vd * 2), vendas: vd, valor: vd * dv.ticket }; }
    return { leads: leads, qual: q, vis: Math.round(q * .45), vendas: Math.floor(v), valor: Math.floor(v) * 1450000 };
  }

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
    if (!st.linhas.length) st.demo = true;
    var moedas = {}; st.linhas.forEach(function (x) { moedas[x.moeda] = (moedas[x.moeda] || 0) + 1; });
    st.moeda = (moedas.USD || 0) > (moedas.BRL || 0) ? "USD" : "BRL";
  }
  function grupoDe(c) { return c.conta_id ? "cliente:" + c.conta_id : "nome:" + (c.nome || c.conta_externa); }
  function rotuloGrupo(g) {
    var c = contasVisiveis().find(function (x) { return grupoDe(x) === g; }); if (!c) return g;
    if (c.conta_id) { var cl = st.clientes.find(function (x) { return x.id === c.conta_id; }); if (cl) return cl.nome; }
    return c.nome || c.conta_externa;
  }
  function contasVisiveis() { return st.demo ? st.contas.map(function (c) { return Object.assign({ real: true }, c); }).concat(DEMO_CONTAS) : st.contas; }
  function fmtData(d) { return d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : ""; }
  function statusConta(c) { // programada (ainda não começou), ativa, pausada, encerrada
    var hoje = iso(new Date());
    if (c.status === "programada" && c.inicio_campanha && c.inicio_campanha <= hoje) return { k: "ativa", t: "Iniciou " + fmtData(c.inicio_campanha) };
    if (c.status === "programada") return { k: "programada", t: "Programada" + (c.inicio_campanha ? " · inicia " + fmtData(c.inicio_campanha) : "") };
    if (c.status === "pausada") return { k: "pausada", t: "Pausada" }; if (c.status === "encerrada") return { k: "encerrada", t: "Encerrada" };
    return { k: "ativa", t: "Ativa" };
  }
  function idConta(c) { return String(c.conta_externa || "").replace(/^act_/, "").replace(/\D/g, ""); }
  function fonte() { return st.demo ? (st._demo || (st._demo = demo())) : st.linhas.filter(function (r) { return r.moeda === st.moeda; }); }

  // ---------- render ----------
  function render(el, A) {
    var hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    var ate = st.ate ? dt(st.ate) : new Date(hoje.getTime() - DIA), de = st.de ? dt(st.de) : new Date(ate.getTime() - (st.dias - 1) * DIA);
    var len = Math.round((ate - de) / DIA) + 1, antAte = new Date(de.getTime() - DIA), antDe = new Date(antAte.getTime() - (len - 1) * DIA);
    var sDe = iso(de), sAte = iso(ate), sADe = iso(antDe), sAAte = iso(antAte);
    var todas = fonte(), m = st.demo ? "BRL" : st.moeda;
    var idsNicho = st.nicho ? contasVisiveis().filter(function (c) { return c.nicho === st.nicho; }).map(idConta) : null;
    var filtro = function (r) { return (st.plat === "todas" || r.plataforma === st.plat) && (!st.camp || r.campanha === st.camp) && (!st.conta || contaGrupo(r)) && (!idsNicho || idsNicho.indexOf(String(r.conta_anuncio || "")) >= 0); };
    function contaGrupo(r) { // filtro por cliente: junta as contas Google e Meta do mesmo nome/cliente
      var alvo = contasVisiveis().filter(function (c) { return grupoDe(c) === st.conta; }).map(idConta);
      return alvo.indexOf(String(r.conta_anuncio || "")) >= 0;
    }
    var P = todas.filter(function (r) { return r.data >= sDe && r.data <= sAte && filtro(r); }), Q = todas.filter(function (r) { return r.data >= sADe && r.data <= sAAte && filtro(r); });
    var a = agg(P), b = agg(Q);
    var campanhas = {}; todas.forEach(function (r) { campanhas[r.campanha] = r.plataforma; });

    // CRM por campanha
    var L = A.S.leads, chaveCamp = {}; Object.keys(campanhas).forEach(function (c) { chaveCamp[norm(c)] = c; });
    function crmDe(ini, fim) {
      var porC = {}, semC = { leads: 0, qual: 0 };
      if (st.demo) { var ag = {}; todas.filter(function (r) { return r.data >= ini && r.data <= fim; }).forEach(function (r) { ag[r.campanha] = (ag[r.campanha] || 0) + +r.conversoes; }); Object.keys(ag).forEach(function (c) { porC[c] = crmDemo(c, ag[c]); }); return { porC: porC, semC: semC }; }
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
    var mValor = st.demo ? "BRL" : "USD";
    var leadsP = somaCRM(crmP, "leads"), leadsA = somaCRM(crmA, "leads"), qualP = somaCRM(crmP, "qual"), qualA = somaCRM(crmA, "qual"), vendasP = somaCRM(crmP, "vendas"), valorP = somaCRM(crmP, "valor"), visP = somaCRM(crmP, "vis");

    // série diária
    var dias = []; for (var t = de.getTime(); t <= ate.getTime(); t += DIA) dias.push(iso(t));
    var porDia = function (rows, campo) { var o = {}; rows.forEach(function (r) { o[r.data] = (o[r.data] || 0) + +r[campo]; }); return dias.map(function (d) { return o[d] || 0; }); };
    var sCusto = porDia(P, "custo"), sCli = porDia(P, "cliques"), sImp = porDia(P, "impressoes"), sConv = porDia(P, "conversoes");
    var sCPC = dias.map(function (_, i) { return sCli[i] ? sCusto[i] / sCli[i] : 0; }), sCPM = dias.map(function (_, i) { return sImp[i] ? sCusto[i] / sImp[i] * 1000 : 0; });
    var platRows = function (p) { return P.filter(function (r) { return r.plataforma === p; }); };
    var gA = agg(platRows("google")), mA = agg(platRows("meta"));
    var leadsPlat = function (p) { return Object.keys(crmP.porC).filter(function (c) { return campanhas[c] === p && campsP[c]; }).reduce(function (s, c) { return s + crmP.porC[c].leads; }, 0); };

    var tile = function (cls, ic, t, v, d, sub) { return '<div class="ct ' + cls + '"><div class="ct-h"><small>' + t + "</small><span>" + ic + '</span></div><strong>' + v + '</strong><div class="ct-f">' + (d || "") + (sub ? "<span>" + sub + "</span>" : "") + "</div></div>"; };
    var platOpts = [["todas", "Todas"], ["google", "Google Ads"], ["meta", "Meta Ads"]];
    var camps = Object.keys(campanhas).filter(function (c) { return st.plat === "todas" || campanhas[c] === st.plat; }).sort();
    var grupos = []; contasVisiveis().forEach(function (c) { var g = grupoDe(c); if (grupos.indexOf(g) < 0) grupos.push(g); });

    function selo(p, cls, nome) { // estado: conectado (há contas ativas e dados), exemplo, ou sem conta
      var contasP = contasVisiveis().filter(function (c) { return c.plataforma === p; }).length, dadosP = todas.some(function (r) { return r.plataforma === p; });
      var est = st.demo ? "ex" : contasP && dadosP ? "on" : dadosP ? "on" : contasP ? "warn" : "off";
      var txt = st.demo ? "exemplo" : dadosP ? contasP + " conta" + (contasP === 1 ? "" : "s") : contasP ? "sem dados" : "conectar";
      var tit = st.plat === p ? "Mostrando só " + nome + " — clique para ver todas as plataformas" : "Filtrar o dashboard por " + nome;
      return '<button type="button" class="' + cls + (st.plat === p ? " ativo" : "") + '" data-selo="' + p + '" title="' + tit + '"><i class="' + est + '"></i>' + nome + " <small>" + txt + "</small></button>";
    }
    el.innerHTML = '<div class="cads">' +
      (st.demo ? '<div class="c-demo"><b>DADOS DE EXEMPLO</b> — ' + (st.linhas.length ? "você está vendo números fictícios." : "ainda não há métricas importadas. Importe os relatórios do Google Ads e do Meta Ads para ver seus números reais.") + (st.linhas.length ? ' <button data-real>Ver meus dados</button>' : ' <button data-imp-abrir>Importar relatórios</button>') + "</div>" : "") +
      '<div class="c-bar"><div class="c-logos">' + selo("google", "lg-g", "Google Ads") + selo("meta", "lg-m", "Meta Ads") +
      '<button type="button" class="lg-c" data-ir-crm title="Ver o cruzamento das campanhas com o CRM: leads, qualificados, visitas e vendas"><i class="' + (A.S.leads.length || st.demo ? (st.demo ? "ex" : "on") : "off") + '"></i>CRM <small>' + (st.demo ? "exemplo" : n0(A.S.leads.length) + " leads") + "</small></button></div>" +
      '<div class="c-fil"><div class="c-seg">' + [7, 14, 30, 90].map(function (d) { return '<button data-dias="' + d + '"' + (!st.de && st.dias === d ? ' class="on"' : "") + ">" + d + "d</button>"; }).join("") + "</div>" +
      '<label class="c-dt"><input type="date" data-de value="' + sDe + '"> – <input type="date" data-ate value="' + sAte + '"></label>' +
      (grupos.length ? '<select data-conta><option value="">Todos os clientes</option>' + grupos.map(function (g) { return '<option value="' + A.esc(g) + '"' + (st.conta === g ? " selected" : "") + ">" + A.esc(rotuloGrupo(g)) + "</option>"; }).join("") + "</select>" : "") +
      (contasVisiveis().some(function (c) { return c.nicho; }) ? '<select data-nicho><option value="">Todos os nichos</option>' + Object.keys(NICHO).map(function (k) { return '<option value="' + k + '"' + (st.nicho === k ? " selected" : "") + ">" + NICHO[k] + "</option>"; }).join("") + "</select>" : "") +
      '<select data-plat>' + platOpts.map(function (o) { return '<option value="' + o[0] + '"' + (st.plat === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
      '<select data-camp><option value="">Todas as campanhas</option>' + camps.map(function (c) { return '<option' + (st.camp === c ? " selected" : "") + ">" + A.esc(c) + "</option>"; }).join("") + "</select>" +
      (!st.demo && st.linhas.some(function (r) { return r.moeda !== st.moeda; }) ? '<select data-moeda><option' + (st.moeda === "BRL" ? " selected" : "") + '>BRL</option><option' + (st.moeda === "USD" ? " selected" : "") + ">USD</option></select>" : "") +
      '<button class="c-btn" data-contas-abrir>⚭ Contas conectadas</button><button class="c-btn ghost" data-imp-abrir>⇪ Importar CSV</button>' + (st.linhas.length && !st.demo ? '<button class="c-btn ghost" data-ver-demo>Exemplo</button>' : "") + "</div></div>" +
      '<p class="c-per">' + dt(sDe).toLocaleDateString("pt-BR") + " a " + dt(sAte).toLocaleDateString("pt-BR") + " · comparado com " + dt(sADe).toLocaleDateString("pt-BR") + " a " + dt(sAAte).toLocaleDateString("pt-BR") + (st.camp ? ' · campanha <b>' + A.esc(st.camp) + '</b> <button class="c-x" data-limpar>×</button>' : "") + "</p>" +

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
      '<div><small>Leads sem campanha identificada</small><b>' + crmP.semC.leads + "</b><span>vieram de Meta/Google sem utm_campaign</span></div></div></section>" +

      '<section class="c-box c-clis"><div class="c-h"><h3>Clientes Google Ads <small>contas com campanhas ativas</small></h3><small>clique num cliente para filtrar o dashboard</small></div><div data-clis></div></section>' +
      '<section class="c-box"><div class="c-h"><h3>Evolução diária</h3><div class="c-seg sm">' + [["custo", "Investimento"], ["conv", "Conversões"], ["cliques", "Cliques"]].map(function (g) { return '<button data-graf="' + g[0] + '"' + (st.graf === g[0] ? ' class="on"' : "") + ">" + g[1] + "</button>"; }).join("") + '</div></div><div class="c-combo-w" data-combo></div><div class="c-leg" data-leg></div></section>' +

      '<div class="c-grid2">' + ["meta", "google"].map(function (p) {
        var x = p === "meta" ? mA : gA, rows = platRows(p), lp = leadsPlat(p);
        return '<section class="c-box c-plat ' + p + '"><div class="c-h"><h3><i></i>' + NOME[p] + '</h3><small>' + rows.length + " registros</small></div>" +
          (rows.length ? '<div class="c-mini"><div><small>Investimento</small><b>' + curK(x.custo, m) + '</b></div><div><small>' + (p === "meta" ? "Resultados" : "Conversões") + "</small><b>" + n0(x.conv) + '</b></div><div><small>Custo por resultado</small><b>' + cur(x.cpa, m) + '</b></div><div><small>CTR</small><b>' + pct(x.ctr) + '</b></div><div><small>CPC</small><b>' + cur(x.cpc, m) + '</b></div><div><small>Leads no CRM</small><b>' + n0(lp) + "</b></div></div>" +
            '<p class="c-sub">' + (p === "meta" ? "Resultados" : "Conversões") + " por dia da semana</p>" + semana(rows, "conversoes", COR[p]) : '<div class="c-vazio">Sem dados do ' + NOME[p] + ' no período.<button data-imp-abrir data-p="' + p + '">Importar relatório</button></div>') + "</section>";
      }).join("") + "</div>" +

      (a.views ? '<section class="c-box c-video"><div class="c-h"><h3>▶ Vídeo <small>campanhas de prospecção</small></h3><small>visualizações e retenção</small></div><div class="c-vgrid">' +
        '<div class="c-vk"><small>Visualizações</small><b>' + kfmt(a.views) + "</b>" + dlt(a.views, b.views) + "</div>" +
        '<div class="c-vk"><small>Taxa de visualização</small><b>' + pct(a.vtr) + "</b>" + dlt(a.vtr, b.vtr) + "</div>" +
        '<div class="c-vk"><small>Custo por visualização</small><b>' + cur(a.cpv, m) + "</b>" + dlt(a.cpv, b.cpv, true) + "</div>" +
        '<div class="c-vk"><small>Assistiram até o fim</small><b>' + kfmt(a.p100) + "</b><span>" + (a.views ? pct(a.p100 / a.views * 100) + " das visualizações" : "") + "</span></div>" +
        '<div class="c-ret">' + [["Início", a.views], ["25%", a.p25], ["50%", a.p50], ["75%", a.p75], ["100%", a.p100]].map(function (q, i) {
          var pc = a.views ? q[1] / a.views * 100 : 0; return '<div><span>' + q[0] + '</span><div class="c-ret-t"><i style="width:' + pc.toFixed(1) + "%;animation-delay:" + i * 80 + 'ms"></i></div><b>' + pct(pc) + "</b></div>";
        }).join("") + "</div></div></section>" : "") +
      '<div class="c-grid2"><section class="c-box c-av blue"><div><small>CPC médio</small><b>' + cur(a.cpc, m) + "</b>" + dlt(a.cpc, b.cpc, true) + "</div>" + area(sCPC, "#3ec5f0") + '</section><section class="c-box c-av orange"><div><small>CPM médio</small><b>' + cur(a.cpm, m) + "</b>" + dlt(a.cpm, b.cpm, true) + "</div>" + area(sCPM, "#f97362") + "</section></div>" +

      '<section class="c-box"><div class="c-h"><h3>Campanhas</h3><small>clique numa linha para filtrar o dashboard · clique no título da coluna para ordenar</small></div><div class="c-tab" data-tab></div></section>' +
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

    // tabela de clientes Google Ads (por conta)
    var campConta = {}; todas.forEach(function (r) { campConta[r.campanha] = String(r.conta_anuncio || ""); });
    var cliG = contasVisiveis().filter(function (c) { return c.plataforma === "google" && (!st.nicho || c.nicho === st.nicho); }).map(function (c) {
      var idc = idConta(c), rows = P.filter(function (r) { return r.plataforma === "google" && String(r.conta_anuncio) === idc; }), x = agg(rows), k = { leads: 0, vendas: 0, valor: 0 }, nc = {};
      rows.forEach(function (r) { nc[r.campanha] = 1; });
      Object.keys(crmP.porC).forEach(function (cp) { if (campConta[cp] === idc && campanhas[cp] === "google") { var o = crmP.porC[cp]; k.leads += o.leads || 0; k.vendas += o.vendas || 0; k.valor += o.valor || 0; } });
      return { c: c, idc: idc, x: x, camps: Object.keys(nc).length, leads: k.leads, vendas: k.vendas, valor: k.valor, roi: x.custo ? k.valor / x.custo : 0, sc: statusConta(c) };
    });
    var ordCli = { vendido: function (o) { return o.valor; }, custo: function (o) { return o.x.custo; }, vendas: function (o) { return o.vendas; }, leads: function (o) { return o.leads; }, roi: function (o) { return o.roi; }, nome: function (o) { return o.c.nome; } }[st.ordemCli] || function (o) { return o.valor; };
    cliG.sort(function (p, q) { if (!!q.c.real !== !!p.c.real) return q.c.real ? 1 : -1; var x1 = ordCli(p), y1 = ordCli(q); return st.ordemCli === "nome" ? String(x1).localeCompare(String(y1)) : y1 - x1; });
    var tot = cliG.reduce(function (t, o) { t.custo += o.x.custo; t.conv += o.x.conv; t.leads += o.leads; t.vendas += o.vendas; t.valor += o.valor; return t; }, { custo: 0, conv: 0, leads: 0, vendas: 0, valor: 0 });
    var mxV = Math.max.apply(null, cliG.map(function (o) { return o.valor; }).concat([1]));
    var thc = function (k, t) { return '<th data-ordcli="' + k + '"' + (st.ordemCli === k ? ' class="on"' : "") + ">" + t + (st.ordemCli === k ? " ▾" : "") + "</th>"; };
    var porNicho = {}; cliG.forEach(function (o) { var n = o.c.nicho || "outro"; var t = porNicho[n] = porNicho[n] || { cl: 0, custo: 0, vendas: 0, valor: 0 }; t.cl++; t.custo += o.x.custo; t.vendas += o.vendas; t.valor += o.valor; });
    el.querySelector("[data-clis]").innerHTML = cliG.length ?
      '<div class="c-nichos">' + Object.keys(porNicho).map(function (n) { var t = porNicho[n]; return '<div class="cn ' + n + '"><small>' + (NICHO[n] || "Outros") + " · " + t.cl + ' clientes</small><b>' + curK(t.valor, mValor) + '</b><span>' + t.vendas + " vendas fechadas · investimento " + curK(t.custo, m) + "</span></div>"; }).join("") +
      '<div class="cn tot"><small>Total · ' + cliG.length + ' clientes</small><b>' + curK(tot.valor, mValor) + "</b><span>" + tot.vendas + " vendas · investimento " + curK(tot.custo, m) + (tot.custo && mValor === m ? " · " + (tot.valor / tot.custo).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "x" : "") + "</span></div></div>" +
      '<div class="c-scroll"><table><thead><tr><th>ID da conta</th>' + thc("nome", "Cliente") + "<th>Nicho</th><th>Status</th><th>Campanhas</th>" + thc("custo", "Investimento") + "<th>Conversões</th>" + thc("leads", "Leads") + thc("vendas", "Vendas fechadas") + thc("vendido", "Vendido") + thc("roi", "Retorno") + "</tr></thead><tbody>" +
      cliG.map(function (o) {
        var g = grupoDe(o.c);
        var verba = o.c.verba ? '<span class="cv">verba ' + cur(o.c.verba, o.c.moeda || "BRL") + (o.sc.k === "programada" ? " planejada" : "") + "</span>" : "";
        return '<tr data-cli="' + A.esc(g) + '" class="' + (st.conta === g ? "on " : "") + (o.c.real ? "real" : "") + '"><td class="mono">' + (o.c.conta_externa ? A.esc(o.c.conta_externa) : '<span class="sem-id">sem ID ainda</span>') + "</td><td><b>" + A.esc(o.c.nome) + "</b>" + (o.c.real && st.demo ? ' <span class="nb real">cliente real</span>' : "") + '</td><td><span class="nb ' + (o.c.nicho || "") + '">' + (NICHO[o.c.nicho] || "—") + '</span></td><td><span class="st ' + o.sc.k + '">' + o.sc.t + "</span></td><td>" + (o.camps || "—") + "</td><td>" + (o.x.custo ? curK(o.x.custo, m) : "—") + verba + "</td><td>" + n0(o.x.conv) + "</td><td>" + n0(o.leads) + "</td><td>" + (o.vendas || "—") + '</td><td class="hb"><i style="width:' + (o.valor / mxV * 100).toFixed(1) + '%;background:rgba(47,220,154,.22)"></i><span><b>' + (o.valor ? curK(o.valor, mValor) : "—") + "</b></span></td><td>" + (o.roi && mValor === m ? o.roi.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "x" : "—") + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr><td></td><td>Total</td><td></td><td></td><td></td><td>' + curK(tot.custo, m) + "</td><td>" + n0(tot.conv) + "</td><td>" + n0(tot.leads) + "</td><td>" + tot.vendas + "</td><td>" + curK(tot.valor, mValor) + "</td><td>" + (tot.custo && mValor === m ? (tot.valor / tot.custo).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "x" : "—") + "</td></tr></tfoot></table></div>"
      : '<div class="c-vazio">Nenhuma conta do Google Ads cadastrada. Use "Contas conectadas" para adicionar.</div>';

    // eventos
    var re = function () { render(el, A); };
    el.querySelectorAll("[data-selo]").forEach(function (x) { x.addEventListener("click", function () {
      var p = x.dataset.selo, temDados = todas.some(function (r) { return r.plataforma === p; });
      if (!temDados && !st.demo) { abrirContas(el, A); return; } // ainda não conectado: abre o cadastro de contas
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
    var rv = el.querySelector("[data-real]"); if (rv) rv.addEventListener("click", function () { st.demo = false; re(); });
    var vd = el.querySelector("[data-ver-demo]"); if (vd) vd.addEventListener("click", function () { st.demo = true; st.camp = ""; re(); });
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
      await carregar(A); st.demo = false; render(el, A);
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
          return '<div class="cc ' + c.plataforma + '"><span class="pb ' + c.plataforma + '">' + (c.plataforma === "meta" ? "Meta" : "Google") + "</span><div><b>" + A.esc(c.nome || "Conta " + (c.conta_externa || "")) + ' <span class="st ' + sc.k + '">' + sc.t + "</span></b><small>" + (c.conta_externa ? "ID " + A.esc(c.conta_externa) : "ID da conta ainda não informado") + (c.nicho ? " · " + (NICHO[c.nicho] || c.nicho) : "") + (c.verba ? " · verba " + cur(c.verba, c.moeda || "BRL") : "") + (cl ? " · cliente " + A.esc(cl.nome) : "") + " · " + (c.ultima_sync ? "sincronizada " + new Date(c.ultima_sync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca sincronizada") + "</small>" +
            (c.ultimo_erro && c.conta_externa ? '<small class="cc-err">' + A.esc(traduzErro(c.ultimo_erro)) + "</small>" : "") +
            '<div class="cc-ed"><input data-ed-id="' + c.id + '" value="' + A.esc(c.conta_externa || "") + '" placeholder="ID da conta (ex.: 123-456-7890)"><select data-ed-st="' + c.id + '">' + [["programada", "Programada"], ["ativa", "Ativa"], ["pausada", "Pausada"], ["encerrada", "Encerrada"]].map(function (o) { return '<option value="' + o[0] + '"' + ((c.status || "ativa") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select><input type="date" data-ed-ini="' + c.id + '" value="' + (c.inicio_campanha || "") + '" title="Início da campanha"></div>' +
            '</div><button class="c-btn ghost" data-sync="' + c.id + '"' + (c.conta_externa ? "" : " disabled title=\"Informe o ID da conta para sincronizar\"") + '>↻ Sincronizar</button><button class="c-x" data-rm="' + c.id + '" title="Desativar">×</button></div>';
        }).join("") : '<p class="c-sub">Nenhuma conta cadastrada.</p>') + "</div>" +
        '<form class="c-nova" data-nova><select name="plataforma"><option value="google">Google Ads</option><option value="meta">Meta Ads</option></select><input name="conta_externa" placeholder="ID da conta (opcional se ainda não existe)"><input name="nome" placeholder="Nome do cliente / conta" required><select name="nicho"><option value="imoveis">Imóveis</option><option value="agro">Máquinas agrícolas</option><option value="outro">Outro</option></select><input name="verba" type="number" min="0" step="0.01" placeholder="Verba (valor investido)"><select name="moeda"><option>BRL</option><option>USD</option></select><select name="status"><option value="ativa">Ativa</option><option value="programada">Programada</option></select><input name="inicio_campanha" type="date" title="Início da campanha"><select name="conta_id"><option value="">Cliente da cobrança (opcional)</option>' + st.clientes.map(function (c) { return '<option value="' + c.id + '">' + A.esc(c.nome) + "</option>"; }).join("") + '</select><button class="c-btn">Adicionar</button></form>' +
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
        await carregar(A); if (ok.length) st.demo = false; desenhar(); render(el, A);
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
