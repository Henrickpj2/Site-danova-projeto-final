/* danova AI — módulos da plataforma: inventário, visitas, vendas e comissões, desempenho, mídia,
   cobrança, vídeos para anúncios, distribuição de leads e portal da construtora.
   Carregado antes do crm.js; usa window.DanovaCRM.api quando cada tela é aberta. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];
  D.ganchosLead = D.ganchosLead || [];

  var STATUS_UNID = { disponivel: "Disponível", reservada: "Reservada", vendida: "Vendida", bloqueada: "Bloqueada" };
  var STATUS_VENDA = { proposta: "Proposta", contrato: "Contrato", fechada: "Fechada", cancelada: "Cancelada" };
  var STATUS_VISITA = { agendada: "Agendada", confirmada: "Confirmada", realizada: "Realizada", cancelada: "Cancelada", nao_compareceu: "Não compareceu" };
  var STATUS_VIDEO = { solicitado: "Solicitado", em_producao: "Em produção", revisao: "Em revisão", aprovado: "Aprovado", entregue: "Entregue", cancelado: "Cancelado" };
  var CANAIS = { meta: "Meta Ads", google: "Google Ads", seo: "SEO + IA", outro: "Outro" };
  // probabilidade de fechamento por etapa (previsão ponderada)
  var PROB = { novo: 0.03, contato: 0.06, qualificado: 0.12, visita: 0.25, proposta: 0.45, contrato: 0.8, fechado: 1, perdido: 0 };

  var cache = { emps: null };
  async function emps(A, forcar) {
    if (cache.emps && !forcar) return cache.emps;
    var r = await A.sb.from("empreendimentos").select("*").order("nome");
    if (r.error) { A.falha(r.error); return []; }
    cache.emps = r.data || []; return cache.emps;
  }
  function moeda(v, m) {
    if (v == null || v === "") return "—";
    return (m === "BRL" ? "R$ " : "US$ ") + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: m === "BRL" ? 2 : 0, maximumFractionDigits: 2 });
  }
  function pct(v) { return v == null ? "—" : (Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"; }
  function pill(txt, cls) { return '<span class="pill ' + (cls || "") + '">' + txt + "</span>"; }
  function opts(obj, sel) { return Object.keys(obj).map(function (k) { return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + obj[k] + "</option>"; }).join(""); }
  function vazio(t) { return '<div class="empty">' + t + "</div>"; }
  function csvBaixar(nome, linhas) {
    var blob = new Blob(["﻿" + linhas.map(function (l) { return l.map(function (c) { var v = c == null ? "" : String(c); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }).join(","); }).join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  }
  function localInput(d) { var x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); }
  function dataHora(v) { return new Date(v).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }

  // =====================================================================
  // INVENTÁRIO
  // =====================================================================
  D.modulos.push({
    id: "inventario", titulo: "Inventário", tituloLongo: "Inventário e disponibilidade", icone: "▦", papeis: ["admin", "corretor"],
    render: async function (el, A) {
      el.innerHTML = vazio("Carregando inventário…");
      var lista = await emps(A, true);
      var u = await A.sb.from("unidades").select("*").order("codigo");
      if (u.error) return A.falha(u.error);
      var unid = u.data || [];
      var contas = A.isAdmin() ? ((await A.sb.from("contas").select("id, nome").order("nome")).data || []) : [];
      var sel = el.dataset.emp || (lista[0] && lista[0].id);
      var e = lista.find(function (x) { return x.id === sel; }) || lista[0];
      function cont(id, st) { return unid.filter(function (x) { return x.empreendimento_id === id && (!st || x.status === st); }).length; }
      el.innerHTML =
        '<div class="inv-grid">' + lista.map(function (x) {
          var t = cont(x.id), d = cont(x.id, "disponivel"), v = cont(x.id, "vendida"), r = cont(x.id, "reservada");
          return '<button class="inv-card' + (x.id === (e && e.id) ? " on" : "") + '" data-emp="' + x.id + '"><strong>' + A.esc(x.nome) + "</strong><small>" + A.esc([x.cidade, x.entrega].filter(Boolean).join(" · ")) + "</small>" +
            (t ? '<div class="inv-bar"><i class="d" style="width:' + d / t * 100 + '%"></i><i class="r" style="width:' + r / t * 100 + '%"></i><i class="v" style="width:' + v / t * 100 + '%"></i></div><span>' + d + " disponíveis · " + r + " reservadas · " + v + " vendidas</span>" : "<span>Nenhuma unidade cadastrada</span>") + "</button>";
        }).join("") + "</div>" +
        (e ? '<div class="card" style="margin-top:16px"><h3>' + A.esc(e.nome) + " <small>" + (e.preco_a_partir ? "a partir de " + moeda(e.preco_a_partir, "USD") : "preço sob consulta") + "</small></h3>" +
          (A.isAdmin() ? '<div class="filters"><label>Construtora / conta <select data-conta>' + '<option value="">— sem conta —</option>' + contas.map(function (c) { return '<option value="' + c.id + '"' + (c.id === e.conta_id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + '</select></label><label>Status <select data-emp-status>' + opts({ pre_lancamento: "Pré-lançamento", lancamento: "Lançamento", em_obra: "Em obra", pronto: "Pronto", esgotado: "Esgotado" }, e.status) + "</select></label></div>" : "") +
          '<div class="table-wrap"><table><thead><tr><th>Unidade</th><th>Tipologia</th><th class="hide-sm">Área (pés²)</th><th class="hide-sm">Andar</th><th>Preço</th><th>Status</th></tr></thead><tbody>' +
          (unid.filter(function (x) { return x.empreendimento_id === e.id; }).map(function (x) {
            return "<tr><td><strong>" + A.esc(x.codigo) + "</strong></td><td>" + A.esc(x.tipologia || (x.quartos != null ? x.quartos + " quarto(s)" : "—")) + '</td><td class="hide-sm">' + (x.area_pes2 || "—") + '</td><td class="hide-sm">' + (x.andar || "—") + "</td><td>" + moeda(x.preco, "USD") + "</td><td>" +
              (A.isAdmin() ? '<select data-unid="' + x.id + '" class="st-' + x.status + '">' + opts(STATUS_UNID, x.status) + "</select>" : pill(STATUS_UNID[x.status], "st-" + x.status)) + "</td></tr>";
          }).join("") || '<tr><td colspan="6">' + vazio("Sem unidades cadastradas para este empreendimento.") + "</td></tr>") + "</tbody></table></div>" +
          (A.isAdmin() ? '<details class="inv-import"><summary>Adicionar unidades</summary><p class="note">Cole uma unidade por linha: <b>código; tipologia; quartos; área em pés²; andar; preço em US$</b>. Ex.: <code>1201; 2 quartos + den; 2; 1150; 12; 1450000</code></p><textarea data-import rows="5"></textarea><button class="btn primary small" data-importar>Adicionar</button></details>' : "") +
          "</div>" : "");
      el.querySelectorAll("[data-emp]").forEach(function (b) { b.addEventListener("click", function () { el.dataset.emp = b.dataset.emp; D.modulos[0].render(el, A); }); });
      el.querySelectorAll("[data-unid]").forEach(function (s) {
        s.addEventListener("change", async function () {
          var r = await A.sb.from("unidades").update({ status: s.value, atualizado_em: new Date().toISOString() }).eq("id", s.dataset.unid);
          if (r.error) return A.falha(r.error); s.className = "st-" + s.value; A.toast("Unidade atualizada.");
        });
      });
      var sc = el.querySelector("[data-conta]");
      if (sc) sc.addEventListener("change", async function () { var r = await A.sb.from("empreendimentos").update({ conta_id: sc.value || null }).eq("id", e.id); if (r.error) return A.falha(r.error); cache.emps = null; A.toast("Construtora vinculada."); });
      var ss = el.querySelector("[data-emp-status]");
      if (ss) ss.addEventListener("change", async function () { var r = await A.sb.from("empreendimentos").update({ status: ss.value }).eq("id", e.id); if (r.error) return A.falha(r.error); cache.emps = null; A.toast("Status atualizado."); });
      var bi = el.querySelector("[data-importar]");
      if (bi) bi.addEventListener("click", async function () {
        var linhas = el.querySelector("[data-import]").value.split(/\n/).map(function (l) { return l.split(/[;\t]/).map(function (c) { return c.trim(); }); }).filter(function (c) { return c[0]; });
        var num = function (v) { if (!v) return null; var n = Number(String(v).replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")); return isNaN(n) ? null : n; };
        var rows = linhas.map(function (c) { return { empreendimento_id: e.id, codigo: c[0], tipologia: c[1] || null, quartos: num(c[2]), area_pes2: num(c[3]), andar: num(c[4]), preco: num(c[5]) }; });
        if (!rows.length) return A.toast("Cole ao menos uma linha.", true);
        var r = await A.sb.from("unidades").upsert(rows, { onConflict: "empreendimento_id,codigo" });
        if (r.error) return A.falha(r.error); A.toast(rows.length + " unidade(s) salvas."); D.modulos[0].render(el, A);
      });
    }
  });

  // =====================================================================
  // AGENDA DE VISITAS
  // =====================================================================
  D.modulos.push({
    id: "agenda", titulo: "Visitas", tituloLongo: "Agenda de visitas", icone: "◷", papeis: ["admin", "corretor"],
    render: async function (el, A) {
      var desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - 7);
      var r = await A.sb.from("visitas").select("*").gte("inicio", desde.toISOString()).order("inicio");
      if (r.error) return A.falha(r.error);
      var lista = r.data || [], lista_emps = await emps(A);
      var nomeLead = function (id) { var l = A.S.leads.find(function (x) { return x.id === id; }); return l ? (l.nome || l.email || l.telefone) : "Lead"; };
      var nomeEmp = function (id) { var e = lista_emps.find(function (x) { return x.id === id; }); return e ? e.nome : ""; };
      var porDia = {};
      lista.forEach(function (v) { var k = A.isoLocal(new Date(v.inicio)); (porDia[k] = porDia[k] || []).push(v); });
      var hoje = A.hojeISO();
      var prox = lista.filter(function (v) { return new Date(v.inicio) >= new Date() && ["agendada", "confirmada"].indexOf(v.status) >= 0; }).length;
      var realiz = lista.filter(function (v) { return v.status === "realizada"; }).length, falt = lista.filter(function (v) { return v.status === "nao_compareceu"; }).length;
      el.innerHTML = '<div class="kpis kpis-3">' + A.kpi("Próximas visitas", prox, "agendadas ou confirmadas") + A.kpi("Realizadas", realiz, "nos últimos 7 dias e futuras") + A.kpi("Não compareceram", falt, realiz + falt ? Math.round(falt / (realiz + falt) * 100) + "% das visitas" : "—") + "</div>" +
        '<p class="note" style="margin:14px 0">Para agendar, abra o lead e use a seção <b>Visitas</b>. Horários no fuso do seu navegador.</p>' +
        (Object.keys(porDia).length ? Object.keys(porDia).sort().map(function (d) {
          return '<div class="agenda-dia' + (d === hoje ? " hoje" : "") + '"><h4>' + (d === hoje ? "Hoje · " : "") + A.dt(d) + "</h4>" + porDia[d].map(function (v) {
            return '<div class="agenda-item"><time>' + new Date(v.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + '</time><div><strong data-lead="' + v.lead_id + '">' + A.esc(nomeLead(v.lead_id)) + "</strong><small>" + A.esc([nomeEmp(v.empreendimento_id), v.formato === "video" ? "videochamada" : (v.local || "presencial")].filter(Boolean).join(" · ")) + '</small></div><select data-visita="' + v.id + '" class="vs-' + v.status + '">' + opts(STATUS_VISITA, v.status) + "</select></div>";
          }).join("") + "</div>";
        }).join("") : vazio("Nenhuma visita nos próximos dias."));
      el.querySelectorAll("[data-lead]").forEach(function (x) { x.addEventListener("click", function () { A.abrirLead(x.dataset.lead); }); });
      el.querySelectorAll("[data-visita]").forEach(function (s) {
        s.addEventListener("change", async function () { var r2 = await A.sb.from("visitas").update({ status: s.value }).eq("id", s.dataset.visita); if (r2.error) return A.falha(r2.error); s.className = "vs-" + s.value; A.toast("Visita atualizada."); });
      });
    }
  });

  // =====================================================================
  // VENDAS E COMISSÕES
  // =====================================================================
  D.modulos.push({
    id: "vendas", titulo: "Vendas", tituloLongo: "Vendas e comissões", icone: "$", papeis: ["admin", "corretor"],
    render: async function (el, A) {
      var r = await A.sb.from("vendas").select("*").order("criado_em", { ascending: false });
      if (r.error) return A.falha(r.error);
      var v = r.data || [], lista_emps = await emps(A);
      var nomeLead = function (id) { var l = A.S.leads.find(function (x) { return x.id === id; }); return l ? (l.nome || l.email) : "—"; };
      var nomeEmp = function (id) { var e = lista_emps.find(function (x) { return x.id === id; }); return e ? e.nome : "—"; };
      var nomeCor = function (id) { var m = A.S.membros.find(function (x) { return x.id === id; }); return m ? m.nome : "—"; };
      var soma = function (arr, k) { return arr.reduce(function (s, x) { return s + Number(x[k] || 0); }, 0); };
      var fechadas = v.filter(function (x) { return x.status === "fechada" && x.moeda === "USD"; });
      var abertas = v.filter(function (x) { return (x.status === "proposta" || x.status === "contrato") && x.moeda === "USD"; });
      el.innerHTML = '<div class="kpis">' +
        A.kpi("Vendido (US$)", moeda(soma(fechadas, "valor"), "USD"), fechadas.length + " venda(s) fechada(s)") +
        A.kpi("Em negociação", moeda(soma(abertas, "valor"), "USD"), abertas.length + " proposta(s)/contrato(s)") +
        A.kpi("Comissões de corretores", moeda(soma(fechadas, "comissao_corretor_valor"), "USD"), moeda(soma(fechadas.filter(function (x) { return !x.corretor_pago; }), "comissao_corretor_valor"), "USD") + " a pagar") +
        (A.isAdmin() ? A.kpi("Taxa danova (1%)", moeda(soma(fechadas, "taxa_danova_valor"), "USD"), "sobre vendas fechadas") : "") +
        A.kpi("Ticket médio", fechadas.length ? moeda(soma(fechadas, "valor") / fechadas.length, "USD") : "—", "vendas fechadas") + "</div>" +
        '<div class="filters" style="margin-top:16px"><span class="spacer"></span><button class="btn ghost small" data-csv>Exportar CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="hide-sm">Empreendimento</th><th>Valor</th><th>Status</th><th class="hide-sm">Corretor</th><th class="hide-sm">Comissão</th>' + (A.isAdmin() ? '<th class="hide-sm">Taxa danova</th><th>Comissão paga</th>' : "") + '<th class="hide-sm">Origem</th></tr></thead><tbody>' +
        (v.map(function (x) {
          return "<tr><td><strong data-lead=\"" + x.lead_id + '">' + A.esc(nomeLead(x.lead_id)) + "</strong><span class=\"sub\">" + A.dt(x.data_fechamento || x.data_proposta) + '</span></td><td class="hide-sm">' + A.esc(nomeEmp(x.empreendimento_id)) + "</td><td>" + moeda(x.valor, x.moeda) + "</td><td>" + pill(STATUS_VENDA[x.status], "vd-" + x.status) + '</td><td class="hide-sm">' + A.esc(nomeCor(x.corretor_id)) + '</td><td class="hide-sm">' + pct(x.comissao_corretor_pct) + " · " + moeda(x.comissao_corretor_valor, x.moeda) + "</td>" +
            (A.isAdmin() ? '<td class="hide-sm">' + moeda(x.taxa_danova_valor, x.moeda) + '</td><td><label class="switch"><input type="checkbox" data-pago="' + x.id + '"' + (x.corretor_pago ? " checked" : "") + (x.status !== "fechada" ? " disabled" : "") + "><span></span></label></td>" : "") +
            '<td class="hide-sm">' + A.esc([CANAIS[x.canal] || x.canal, x.campanha].filter(Boolean).join(" · ") || "—") + "</td></tr>";
        }).join("") || '<tr><td colspan="9">' + vazio("Nenhuma proposta ainda. Registre pela ficha do lead, na seção Negociação.") + "</td></tr>") + "</tbody></table></div>";
      el.querySelectorAll("[data-lead]").forEach(function (x) { x.addEventListener("click", function () { if (x.dataset.lead !== "null") A.abrirLead(x.dataset.lead); }); });
      el.querySelectorAll("[data-pago]").forEach(function (i) { i.addEventListener("change", async function () { var r2 = await A.sb.from("vendas").update({ corretor_pago: i.checked }).eq("id", i.dataset.pago); if (r2.error) { i.checked = !i.checked; return A.falha(r2.error); } A.toast(i.checked ? "Comissão marcada como paga." : "Comissão marcada como pendente."); }); });
      el.querySelector("[data-csv]").addEventListener("click", function () {
        csvBaixar("vendas-danova-" + A.hojeISO() + ".csv", [["data", "cliente", "empreendimento", "status", "valor", "moeda", "corretor", "comissao_pct", "comissao_valor", "taxa_danova", "comissao_paga", "canal", "campanha"]].concat(v.map(function (x) {
          return [x.data_fechamento || x.data_proposta, nomeLead(x.lead_id), nomeEmp(x.empreendimento_id), x.status, x.valor, x.moeda, nomeCor(x.corretor_id), x.comissao_corretor_pct, x.comissao_corretor_valor, A.isAdmin() ? x.taxa_danova_valor : "", x.corretor_pago ? "sim" : "não", x.canal, x.campanha];
        })));
      });
    }
  });

  // =====================================================================
  // DESEMPENHO, ROI E PREVISÃO
  // =====================================================================
  D.modulos.push({
    id: "desempenho", titulo: "Desempenho", tituloLongo: "Desempenho, ROI e previsão", icone: "↗", papeis: ["admin", "corretor"],
    render: async function (el, A) {
      var L = A.S.leads;
      var vr = await A.sb.from("vendas").select("*");
      var vendas = vr.data || [];
      var inv = A.isAdmin() ? ((await A.sb.from("investimentos").select("*")).data || []) : [];
      var fila = A.isAdmin() ? ((await A.sb.from("conversoes").select("status")).data || []) : [];
      var abertos = L.filter(function (l) { return A.ABERTAS.indexOf(l.etapa) >= 0; });
      var prev = abertos.reduce(function (s, l) { return s + (Number(l.valor_estimado) || 0) * (PROB[l.etapa] || 0); }, 0);
      var semValor = abertos.filter(function (l) { return !l.valor_estimado; }).length;
      // previsão por mês do próximo contato/visita (horizonte 90 dias)
      var canalDe = function (l) { var c = (l.canal || "direto").toLowerCase(); return /face|insta|meta|fb|ig/.test(c) ? "meta" : /google|gclid|youtube/.test(c) ? "google" : /chat-ia|organic|seo|bing|chatgpt|perplexity/.test(c) ? "seo" : c === "direto" ? "direto" : "outro"; };
      var grupos = {};
      L.forEach(function (l) { var k = canalDe(l); var g = grupos[k] = grupos[k] || { leads: 0, qual: 0, visitas: 0, vendas: 0, valor: 0 }; g.leads++; if (["qualificado", "visita", "proposta", "contrato", "fechado"].indexOf(l.etapa) >= 0) g.qual++; if (["visita", "proposta", "contrato", "fechado"].indexOf(l.etapa) >= 0) g.visitas++; });
      vendas.filter(function (x) { return x.status === "fechada" && x.moeda === "USD"; }).forEach(function (x) { var k = canalDe({ canal: x.canal }); var g = grupos[k] = grupos[k] || { leads: 0, qual: 0, visitas: 0, vendas: 0, valor: 0 }; g.vendas++; g.valor += Number(x.valor); });
      var gasto = {}; inv.forEach(function (i) { var k = i.canal + ":" + i.moeda; gasto[k] = (gasto[k] || 0) + Number(i.valor); });
      var gastoTxt = function (c) { var p = []; ["BRL", "USD"].forEach(function (m) { if (gasto[c + ":" + m]) p.push(moeda(gasto[c + ":" + m], m)); }); return p.join(" + ") || "—"; };
      var cpl = function (c, g) { var p = []; ["BRL", "USD"].forEach(function (m) { if (gasto[c + ":" + m] && g.leads) p.push(moeda(gasto[c + ":" + m] / g.leads, m)); }); return p.join(" / ") || "—"; };
      var cplq = function (c, g) { var p = []; ["BRL", "USD"].forEach(function (m) { if (gasto[c + ":" + m] && g.qual) p.push(moeda(gasto[c + ":" + m] / g.qual, m)); }); return p.join(" / ") || "—"; };
      var roas = function (c, g) { var u = gasto[c + ":USD"]; return u && g.valor ? (g.valor / u).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x" : "—"; };
      var nomeCanal = { meta: "Meta Ads", google: "Google Ads", seo: "SEO + IA / orgânico", direto: "Direto", outro: "Outros" };
      // tempo médio na etapa atual
      var parados = abertos.filter(function (l) { return Date.now() - new Date(l.atualizado_em) > 7 * 864e5; }).length;
      el.innerHTML = '<div class="kpis">' +
        A.kpi("Previsão ponderada", moeda(prev, "USD"), "valor estimado × chance por etapa") +
        A.kpi("Leads abertos", abertos.length, semValor ? semValor + " sem valor estimado" : "todos com valor") +
        A.kpi("Taxa de qualificação", L.length ? Math.round(L.filter(function (l) { return ["qualificado", "visita", "proposta", "contrato", "fechado"].indexOf(l.etapa) >= 0; }).length / L.length * 100) + "%" : "—", "leads que chegaram a Qualificado") +
        A.kpi("Lead → visita", L.length ? Math.round(L.filter(function (l) { return ["visita", "proposta", "contrato", "fechado"].indexOf(l.etapa) >= 0; }).length / L.length * 100) + "%" : "—", "conversão total") +
        A.kpi("Parados há 7+ dias", parados, "leads abertos sem atualização") + "</div>" +
        '<div class="card" style="margin-top:16px"><h3>Resultado por canal <small>' + (A.isAdmin() ? "investimento lançado em Mídia" : "leads da sua carteira") + '</small></h3><div class="table-wrap"><table><thead><tr><th>Canal</th><th>Leads</th><th>Qualificados</th><th class="hide-sm">Visitas</th><th>Vendas</th><th class="hide-sm">Vendido</th>' + (A.isAdmin() ? '<th class="hide-sm">Investido</th><th>CPL</th><th class="hide-sm">Custo/lead qualificado</th><th>ROAS</th>' : "") + "</tr></thead><tbody>" +
        (Object.keys(grupos).sort(function (a, b) { return grupos[b].leads - grupos[a].leads; }).map(function (k) { var g = grupos[k];
          return "<tr><td><strong>" + (nomeCanal[k] || k) + "</strong></td><td>" + g.leads + "</td><td>" + g.qual + '</td><td class="hide-sm">' + g.visitas + "</td><td>" + g.vendas + '</td><td class="hide-sm">' + moeda(g.valor, "USD") + "</td>" + (A.isAdmin() ? '<td class="hide-sm">' + gastoTxt(k) + "</td><td>" + cpl(k, g) + '</td><td class="hide-sm">' + cplq(k, g) + "</td><td>" + roas(k, g) + "</td>" : "") + "</tr>";
        }).join("") || '<tr><td colspan="10">' + vazio("Sem leads ainda.") + "</td></tr>") + "</tbody></table></div><p class=\"note\" style=\"margin-top:8px\">ROAS = valor vendido ÷ investimento em US$. Investimentos em R$ aparecem no CPL em R$.</p></div>" +
        '<div class="card" style="margin-top:16px"><h3>Previsão por etapa</h3>' + A.barras(A.ETAPAS.filter(function (e) { return A.ABERTAS.indexOf(e.id) >= 0; }).map(function (e) {
          var v = abertos.filter(function (l) { return l.etapa === e.id; }).reduce(function (s, l) { return s + (Number(l.valor_estimado) || 0) * PROB[e.id]; }, 0);
          return [e.id, Math.round(v / 1000), e.nome + " (" + Math.round(PROB[e.id] * 100) + "%)"];
        }), "linear-gradient(90deg,#3ec5f0,#6b3fd4)") + '<p class="note" style="margin-top:8px">Valores em milhares de US$. Preencha o valor estimado dos leads para a previsão ficar precisa.</p></div>' +
        (A.isAdmin() ? '<div class="card" style="margin-top:16px"><h3>Conversões para as plataformas de anúncio</h3>' +
          '<p class="muted" style="margin:0 0 12px">Cada lead qualificado, visita, proposta, contrato e venda volta para o Meta (API de Conversões) e pode ser importado no Google Ads (conversões offline com GCLID). Assim as campanhas otimizam por compradores, não por cliques.</p>' +
          '<div class="filters"><span class="pill">' + fila.filter(function (c) { return c.status === "pendente"; }).length + ' pendentes</span><span class="pill vd-fechada">' + fila.filter(function (c) { return c.status === "enviado"; }).length + ' enviadas ao Meta</span><span class="pill vd-cancelada">' + fila.filter(function (c) { return c.status === "erro"; }).length + ' com erro</span><span class="spacer"></span><button class="btn primary small" data-meta>Enviar ao Meta agora</button><button class="btn ghost small" data-google>Exportar para Google Ads (CSV)</button></div></div>' : "");
      var bm = el.querySelector("[data-meta]");
      if (bm) bm.addEventListener("click", async function () {
        bm.disabled = true;
        var r = await A.sb.functions.invoke("meta-capi", { body: {} });
        var cod = r.data && r.data.erro; if (r.error && r.error.context && r.error.context.json) { try { cod = (await r.error.context.json()).erro; } catch (e) {} }
        bm.disabled = false;
        if (cod === "meta_nao_configurado") return A.toast("Falta configurar META_PIXEL_ID e META_CAPI_TOKEN no Supabase.", true);
        if (r.error || cod) return A.toast("O Meta não aceitou o envio agora.", true);
        A.toast((r.data.enviados || 0) + " conversão(ões) enviada(s) ao Meta."); D.modulos[3].render(el, A);
      });
      var bg = el.querySelector("[data-google]");
      if (bg) bg.addEventListener("click", function () {
        var nomes = { qualificado: "Lead qualificado", visita: "Visita", proposta: "Proposta", contrato: "Contrato", fechado: "Venda" };
        var linhas = [["Parameters:TimeZone=America/Sao_Paulo"], ["Google Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency"]];
        L.forEach(function (l) {
          var g = l.utm && l.utm.gclid; if (!g || !nomes[l.etapa]) return;
          var t = new Date(l.atualizado_em); var p = function (n) { return String(n).padStart(2, "0"); };
          linhas.push([g, nomes[l.etapa], t.getFullYear() + "-" + p(t.getMonth() + 1) + "-" + p(t.getDate()) + " " + p(t.getHours()) + ":" + p(t.getMinutes()) + ":" + p(t.getSeconds()), l.etapa === "fechado" ? (l.valor_estimado || "") : "", l.etapa === "fechado" ? "USD" : ""]);
        });
        if (linhas.length === 2) return A.toast("Nenhum lead com GCLID em etapa de conversão ainda.", true);
        csvBaixar("google-ads-conversoes-" + A.hojeISO() + ".csv", linhas);
      });
    }
  });

  // =====================================================================
  // MÍDIA (investimento por canal)
  // =====================================================================
  D.modulos.push({
    id: "midia", titulo: "Mídia", tituloLongo: "Investimento em mídia", icone: "◎", papeis: ["admin"],
    render: async function (el, A) {
      var r = await A.sb.from("investimentos").select("*").order("mes", { ascending: false });
      if (r.error) return A.falha(r.error);
      var lista = r.data || [], lista_emps = await emps(A);
      var mesAtual = A.hojeISO().slice(0, 7);
      el.innerHTML = '<form class="card stack" data-form><h3>Lançar investimento</h3><div class="fgrid fgrid-3">' +
        '<label>Mês<input type="month" name="mes" value="' + mesAtual + '" required></label>' +
        '<label>Canal<select name="canal">' + opts(CANAIS, "meta") + "</select></label>" +
        '<label>Empreendimento<select name="empreendimento_id"><option value="">Geral / vários</option>' + lista_emps.map(function (e) { return '<option value="' + e.id + '">' + A.esc(e.nome) + "</option>"; }).join("") + "</select></label>" +
        '<label>Campanha<input name="campanha" placeholder="Ex.: Faena BR Leads"></label>' +
        '<label>Valor<input name="valor" type="number" min="0" step="0.01" required></label>' +
        '<label>Moeda<select name="moeda"><option>BRL</option><option>USD</option></select></label></div><button class="btn primary">Salvar</button></form>' +
        '<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Mês</th><th>Canal</th><th>Campanha</th><th class="hide-sm">Empreendimento</th><th>Valor</th><th></th></tr></thead><tbody>' +
        (lista.map(function (i) { var e = lista_emps.find(function (x) { return x.id === i.empreendimento_id; });
          return "<tr><td>" + i.mes.slice(0, 7).split("-").reverse().join("/") + "</td><td>" + (CANAIS[i.canal] || i.canal) + "</td><td>" + A.esc(i.campanha || "—") + '</td><td class="hide-sm">' + A.esc(e ? e.nome : "Geral") + "</td><td>" + moeda(i.valor, i.moeda) + '</td><td><button class="btn ghost small" data-del="' + i.id + '">Excluir</button></td></tr>';
        }).join("") || '<tr><td colspan="6">' + vazio("Lance o investimento mensal de cada canal para ver custo por lead e ROAS em Desempenho.") + "</td></tr>") + "</tbody></table></div>";
      el.querySelector("[data-form]").addEventListener("submit", async function (e) {
        e.preventDefault(); var f = new FormData(e.target);
        var r2 = await A.sb.from("investimentos").insert({ mes: f.get("mes") + "-01", canal: f.get("canal"), empreendimento_id: f.get("empreendimento_id") || null, campanha: f.get("campanha") || null, valor: Number(f.get("valor")), moeda: f.get("moeda"), criado_por: A.S.me.id });
        if (r2.error) return A.falha(r2.error); A.toast("Investimento lançado."); D.modulos[4].render(el, A);
      });
      el.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", async function () {
        if (b.dataset.ok !== "1") { b.dataset.ok = "1"; b.textContent = "Confirmar"; return; }
        var r2 = await A.sb.from("investimentos").delete().eq("id", b.dataset.del); if (r2.error) return A.falha(r2.error); D.modulos[4].render(el, A);
      }); });
    }
  });

  // =====================================================================
  // COBRANÇA (R$ 199,99/mês + 1% no fechamento)
  // =====================================================================
  D.modulos.push({
    id: "cobranca", titulo: "Cobrança", tituloLongo: "Clientes e cobrança", icone: "▣", papeis: ["admin"],
    render: async function (el, A) {
      var c = await A.sb.from("contas").select("*").order("nome"), f = await A.sb.from("faturas").select("*").order("competencia", { ascending: false }).order("criado_em", { ascending: false }).limit(300);
      if (c.error) return A.falha(c.error);
      var contas = c.data || [], fat = f.data || [];
      var nomeConta = function (id) { var x = contas.find(function (y) { return y.id === id; }); return x ? x.nome : "—"; };
      var aberto = function (m) { return fat.filter(function (x) { return x.status === "aberta" && x.moeda === m; }).reduce(function (s, x) { return s + Number(x.valor); }, 0); };
      var recebido = function (m) { return fat.filter(function (x) { return x.status === "paga" && x.moeda === m; }).reduce(function (s, x) { return s + Number(x.valor); }, 0); };
      var construtoras = A.S.membros.filter(function (m) { return m.papel === "construtora"; });
      var portalUsuarios = function (c) {
        var ligados = construtoras.filter(function (m) { return m.conta_id === c.id; });
        var livres = construtoras.filter(function (m) { return !m.conta_id; });
        return ligados.map(function (m) { return '<span class="pill">' + A.esc(m.nome) + ' <button type="button" class="pill-x" data-desvincular="' + m.id + '" title="Remover acesso">×</button></span> '; }).join("") +
          (livres.length ? '<select data-vincular="' + c.id + '"><option value="">+ usuário construtora…</option>' + livres.map(function (m) { return '<option value="' + m.id + '">' + A.esc(m.nome + " · " + m.email) + "</option>"; }).join("") + "</select>" : (ligados.length ? "" : '<span class="note">Mude o papel do usuário para Construtora na aba Corretores.</span>'));
      };
      var vencidas = fat.filter(function (x) { return x.status === "aberta" && x.vencimento && x.vencimento < A.hojeISO(); }).length;
      el.innerHTML = '<div class="kpis">' + A.kpi("Clientes ativos", contas.filter(function (x) { return x.ativo; }).length, "construtoras e imobiliárias") +
        A.kpi("Mensalidades previstas", moeda(contas.filter(function (x) { return x.ativo && x.moeda_mensalidade === "BRL"; }).reduce(function (s, x) { return s + Number(x.mensalidade); }, 0), "BRL"), "por mês") +
        A.kpi("Em aberto", moeda(aberto("BRL"), "BRL") + (aberto("USD") ? " + " + moeda(aberto("USD"), "USD") : ""), vencidas + " vencida(s)") +
        A.kpi("Recebido", moeda(recebido("BRL"), "BRL") + (recebido("USD") ? " + " + moeda(recebido("USD"), "USD") : ""), "faturas pagas") + "</div>" +
        '<div class="grid2"><form class="card stack" data-conta><h3>Novo cliente <small>plano padrão: R$ 199,99/mês + 1% no fechamento</small></h3><div class="fgrid">' +
        '<label>Nome<input name="nome" required></label><label>Tipo<select name="tipo"><option value="construtora">Construtora / incorporadora</option><option value="imobiliaria">Imobiliária</option></select></label>' +
        '<label>CNPJ / documento<input name="documento"></label><label>E-mail de cobrança<input name="email_cobranca" type="email"></label>' +
        '<label>Mensalidade (R$)<input name="mensalidade" type="number" step="0.01" value="199.99"></label><label>Taxa de fechamento (%)<input name="taxa" type="number" step="0.01" value="1"></label>' +
        '<label>Dia de vencimento<input name="dia" type="number" min="1" max="28" value="10"></label></div><button class="btn primary">Cadastrar cliente</button></form>' +
        '<div class="card"><h3>Gerar mensalidades</h3><p class="muted" style="margin:0 0 12px">Cria a fatura do mês para todos os clientes ativos. Não duplica: rodar de novo no mesmo mês não gera outra.</p><div class="filters"><input type="month" data-comp value="' + A.hojeISO().slice(0, 7) + '"><button class="btn primary small" data-gerar>Gerar</button></div><p class="note">A taxa de 1% é gerada sozinha quando uma venda é marcada como fechada.</p></div></div>' +
        '<h3 style="margin:22px 0 10px">Clientes</h3><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Plano</th><th class="hide-sm">Vencimento</th><th>Acesso ao portal</th><th>Ativo</th></tr></thead><tbody>' +
        (contas.map(function (x) { return "<tr><td><strong>" + A.esc(x.nome) + '</strong><span class="sub">' + A.esc([x.tipo === "imobiliaria" ? "Imobiliária" : "Construtora", x.email_cobranca].filter(Boolean).join(" · ")) + "</span></td><td>" + moeda(x.mensalidade, x.moeda_mensalidade) + "/mês + " + pct(x.taxa_fechamento) + '</td><td class="hide-sm">dia ' + x.dia_vencimento + '</td><td>' + portalUsuarios(x) + '</td><td><label class="switch"><input type="checkbox" data-ativo-conta="' + x.id + '"' + (x.ativo ? " checked" : "") + "><span></span></label></td></tr>"; }).join("") || '<tr><td colspan="5">' + vazio("Nenhum cliente cadastrado.") + "</td></tr>") + "</tbody></table></div>" +
        '<h3 style="margin:22px 0 10px">Faturas</h3><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Valor</th><th class="hide-sm">Vencimento</th><th>Status</th></tr></thead><tbody>' +
        (fat.map(function (x) { var venc = x.status === "aberta" && x.vencimento && x.vencimento < A.hojeISO();
          return "<tr><td>" + A.esc(nomeConta(x.conta_id)) + "</td><td>" + A.esc(x.descricao || x.tipo) + "</td><td>" + moeda(x.valor, x.moeda) + '</td><td class="hide-sm' + (venc ? " temp quente" : "") + '">' + (x.vencimento ? A.dt(x.vencimento) : "—") + (venc ? " · vencida" : "") + '</td><td><select data-fat="' + x.id + '">' + opts({ aberta: "Aberta", paga: "Paga", cancelada: "Cancelada" }, x.status) + "</select></td></tr>";
        }).join("") || '<tr><td colspan="5">' + vazio("Nenhuma fatura ainda.") + "</td></tr>") + "</tbody></table></div>";
      el.querySelector("[data-conta]").addEventListener("submit", async function (e) {
        e.preventDefault(); var g = new FormData(e.target);
        var r = await A.sb.from("contas").insert({ nome: g.get("nome"), tipo: g.get("tipo"), documento: g.get("documento") || null, email_cobranca: g.get("email_cobranca") || null, mensalidade: Number(g.get("mensalidade") || 199.99), taxa_fechamento: Number(g.get("taxa") || 1) / 100, dia_vencimento: Number(g.get("dia") || 10) });
        if (r.error) return A.falha(r.error); A.toast("Cliente cadastrado. Vincule os empreendimentos dele em Inventário."); D.modulos[5].render(el, A);
      });
      el.querySelector("[data-gerar]").addEventListener("click", async function () {
        var r = await A.sb.rpc("gerar_mensalidades", { p_competencia: el.querySelector("[data-comp]").value + "-01" });
        if (r.error) return A.falha(r.error); A.toast(r.data + " mensalidade(s) gerada(s)."); D.modulos[5].render(el, A);
      });
      el.querySelectorAll("[data-fat]").forEach(function (s) { s.addEventListener("change", async function () {
        var r = await A.sb.from("faturas").update({ status: s.value, pago_em: s.value === "paga" ? A.hojeISO() : null }).eq("id", s.dataset.fat);
        if (r.error) return A.falha(r.error); A.toast("Fatura atualizada.");
      }); });
      el.querySelectorAll("[data-vincular]").forEach(function (sl) { sl.addEventListener("change", async function () {
        if (!sl.value) return; var r = await A.sb.from("membros").update({ conta_id: sl.dataset.vincular }).eq("id", sl.value);
        if (r.error) return A.falha(r.error); await A.carregar(); A.toast("Acesso ao portal liberado."); D.modulos[5].render(el, A);
      }); });
      el.querySelectorAll("[data-desvincular]").forEach(function (bt) { bt.addEventListener("click", async function () {
        var r = await A.sb.from("membros").update({ conta_id: null }).eq("id", bt.dataset.desvincular);
        if (r.error) return A.falha(r.error); await A.carregar(); A.toast("Acesso removido."); D.modulos[5].render(el, A);
      }); });
      el.querySelectorAll("[data-ativo-conta]").forEach(function (i) { i.addEventListener("change", async function () {
        var r = await A.sb.from("contas").update({ ativo: i.checked }).eq("id", i.dataset.ativoConta); if (r.error) { i.checked = !i.checked; return A.falha(r.error); } A.toast("Cliente atualizado.");
      }); });
    }
  });

  // =====================================================================
  // VÍDEOS PARA ANÚNCIOS
  // =====================================================================
  function videoForm(A, lista_emps, ehConstrutora) {
    return '<form class="card stack" data-video><h3>Pedir vídeo pronto para anúncios <small>Meta Ads e Google Ads</small></h3>' +
      '<p class="muted" style="margin:0">Produzimos o vídeo do empreendimento nos formatos de cada plataforma: Reels/Stories (9:16), feed (1:1 ou 4:5) e YouTube/Performance Max (16:9), com versões de 15 e 30 segundos.</p><div class="fgrid">' +
      '<label class="full">Empreendimento<select name="empreendimento_id">' + lista_emps.map(function (e) { return '<option value="' + e.id + '">' + A.esc(e.nome) + "</option>"; }).join("") + '<option value="">Outro (descreva no briefing)</option></select></label>' +
      (ehConstrutora ? "" : '<label>Nome do contato<input name="name" required></label><label>E-mail<input name="email" type="email"></label><label>WhatsApp<input name="phone"></label>') +
      '<fieldset class="full chk"><legend>Formatos</legend>' + [["9:16", "9:16 · Reels, Stories, Shorts"], ["1:1", "1:1 · feed"], ["4:5", "4:5 · feed vertical"], ["16:9", "16:9 · YouTube, Performance Max"]].map(function (x, i) { return '<label><input type="checkbox" name="formatos" value="' + x[0] + '"' + (i !== 2 ? " checked" : "") + "> " + x[1] + "</label>"; }).join("") + "</fieldset>" +
      '<fieldset class="chk"><legend>Duração</legend>' + ["6s", "15s", "30s", "60s"].map(function (x) { return '<label><input type="checkbox" name="duracoes" value="' + x + '"' + (x === "15s" || x === "30s" ? " checked" : "") + "> " + x + "</label>"; }).join("") + "</fieldset>" +
      '<fieldset class="chk"><legend>Idiomas</legend>' + [["pt", "Português"], ["en", "Inglês"], ["es", "Espanhol"]].map(function (x) { return '<label><input type="checkbox" name="idiomas" value="' + x[0] + '"' + (x[0] === "pt" ? " checked" : "") + "> " + x[1] + "</label>"; }).join("") + "</fieldset>" +
      '<label class="full">Material disponível<input name="material" placeholder="Link para renders, plantas, drone, logotipo (Drive, Dropbox…)"></label>' +
      '<label class="full">Briefing<textarea name="briefing" placeholder="Público, diferenciais, oferta, tom, chamada para ação"></textarea></label></div>' +
      '<button class="btn primary">Enviar pedido</button></form>';
  }
  async function enviarVideo(form, A, ehConstrutora) {
    var f = new FormData(form);
    var e = (await emps(A)).find(function (x) { return x.id === f.get("empreendimento_id"); });
    var dados = { empreendimento_id: f.get("empreendimento_id") || null, empreendimento: e ? e.nome : null, formatos: f.getAll("formatos"), duracoes: f.getAll("duracoes"), idiomas: f.getAll("idiomas"), plataformas: ["meta", "google"], material: f.get("material"), briefing: f.get("briefing"),
      name: ehConstrutora ? A.S.me.nome : f.get("name"), email: ehConstrutora ? A.S.me.email : f.get("email"), phone: ehConstrutora ? A.S.me.telefone : f.get("phone"), profile: "Construtora ou incorporadora" };
    var r = await A.sb.rpc("solicitar_video", { dados: dados });
    if (r.error) return A.falha(r.error);
    A.toast("Pedido de vídeo enviado. A equipe entra em contato com prazo e orçamento.");
    return true;
  }
  D.modulos.push({
    id: "videos", titulo: "Vídeos", tituloLongo: "Vídeos para anúncios", icone: "▶", papeis: ["admin"],
    render: async function (el, A) {
      var r = await A.sb.from("pedidos_video").select("*").order("criado_em", { ascending: false });
      if (r.error) return A.falha(r.error);
      var lista = r.data || [], lista_emps = await emps(A);
      el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Formatos</th><th>Status</th><th class="hide-sm">Prazo</th><th class="hide-sm">Entrega</th></tr></thead><tbody>' +
        (lista.map(function (p) { var e = lista_emps.find(function (x) { return x.id === p.empreendimento_id; });
          return "<tr><td><strong>" + A.esc(e ? e.nome : (p.empreendimento_texto || "Empreendimento")) + '</strong><span class="sub">' + A.esc([p.contato_nome, p.contato_email, p.contato_telefone].filter(Boolean).join(" · ")) + '</span><span class="sub">' + A.dt(p.criado_em, true) + (p.briefing ? " · " + A.esc(p.briefing.slice(0, 120)) : "") + (p.material ? ' · <a href="' + A.esc(p.material) + '" target="_blank" rel="noopener">material</a>' : "") + "</span></td><td>" + A.esc(p.formatos.join(", ")) + '<span class="sub">' + A.esc(p.duracoes.join(", ") + " · " + p.idiomas.join("/").toUpperCase()) + '</span></td><td><select data-vs="' + p.id + '">' + opts(STATUS_VIDEO, p.status) + '</select></td><td class="hide-sm"><input type="date" data-vp="' + p.id + '" value="' + (p.prazo || "") + '"></td><td class="hide-sm"><input data-vl="' + p.id + '" value="' + A.esc(p.link_entrega || "") + '" placeholder="link dos vídeos"></td></tr>';
        }).join("") || '<tr><td colspan="5">' + vazio("Nenhum pedido ainda. Os pedidos chegam pelo site, pelo portal da construtora ou pelo formulário abaixo.") + "</td></tr>") + "</tbody></table></div>" +
        '<div style="margin-top:16px">' + videoForm(A, lista_emps, false) + "</div>";
      var salvar = async function (id, dados) { var r2 = await A.sb.from("pedidos_video").update(Object.assign({ atualizado_em: new Date().toISOString() }, dados)).eq("id", id); if (r2.error) return A.falha(r2.error); A.toast("Pedido atualizado."); };
      el.querySelectorAll("[data-vs]").forEach(function (s) { s.addEventListener("change", function () { salvar(s.dataset.vs, { status: s.value }); }); });
      el.querySelectorAll("[data-vp]").forEach(function (s) { s.addEventListener("change", function () { salvar(s.dataset.vp, { prazo: s.value || null }); }); });
      el.querySelectorAll("[data-vl]").forEach(function (s) { s.addEventListener("change", function () { salvar(s.dataset.vl, { link_entrega: s.value || null }); }); });
      el.querySelector("[data-video]").addEventListener("submit", async function (e) { e.preventDefault(); if (await enviarVideo(e.target, A, false)) D.modulos[6].render(el, A); });
    }
  });

  // =====================================================================
  // DISTRIBUIÇÃO DE LEADS
  // =====================================================================
  D.modulos.push({
    id: "distribuicao", titulo: "Distribuição", tituloLongo: "Distribuição inteligente de leads", icone: "⇄", papeis: ["admin"],
    render: async function (el, A) {
      var cfg = (await A.sb.from("distribuicao_config").select("*").eq("id", 1).maybeSingle()).data || { ativo: true };
      await A.carregar();
      var lista_emps = await emps(A);
      var cor = A.S.membros.filter(function (m) { return m.papel === "corretor"; });
      var abertos = function (id) { return A.S.leads.filter(function (l) { return l.corretor_id === id && A.ABERTAS.indexOf(l.etapa) >= 0; }).length; };
      var semDono = A.S.leads.filter(function (l) { return !l.corretor_id && A.ABERTAS.indexOf(l.etapa) >= 0; }).length;
      el.innerHTML = '<div class="card"><h3>Como funciona</h3><p class="muted" style="margin:0">Quando um lead chega (site, chat de IA, formulário do Meta), ele vai automaticamente para o corretor ativo mais adequado: <b>especialista no empreendimento</b> (+3), <b>fala o idioma do cliente</b> (+2), <b>atende a região</b> (+1). No empate, vai para quem tem <b>menos leads abertos</b> e recebeu há mais tempo. Corretores no limite de capacidade ou pausados não recebem.</p>' +
        '<div class="filters" style="margin-top:14px"><label class="switch"><input type="checkbox" data-auto' + (cfg.ativo ? " checked" : "") + '><span></span></label><b>Distribuição automática ' + (cfg.ativo ? "ligada" : "desligada") + '</b><span class="spacer"></span><span class="pill">' + semDono + ' lead(s) abertos sem corretor</span><button class="btn primary small" data-pendentes' + (semDono ? "" : " disabled") + ">Distribuir agora</button></div></div>" +
        '<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Corretor</th><th>Recebe</th><th>Abertos / capacidade</th><th>Idiomas</th><th class="hide-sm">Regiões</th><th class="hide-sm">Especialista em</th></tr></thead><tbody>' +
        (cor.map(function (m) {
          var chk = function (nome, lista, val, rot) { return '<label class="mini"><input type="checkbox" data-m="' + m.id + '" data-campo="' + nome + '" value="' + val + '"' + ((lista || []).indexOf(val) >= 0 ? " checked" : "") + "> " + rot + "</label>"; };
          return "<tr><td><strong>" + A.esc(m.nome) + "</strong>" + (m.ativo ? "" : '<span class="sub">acesso pendente</span>') + '</td><td><label class="switch"><input type="checkbox" data-recebe="' + m.id + '"' + (m.recebe_leads ? " checked" : "") + '><span></span></label></td><td>' + abertos(m.id) + ' / <input type="number" min="0" class="cap" data-cap="' + m.id + '" value="' + m.capacidade + '"></td><td>' +
            chk("idiomas", m.idiomas, "pt", "PT") + chk("idiomas", m.idiomas, "en", "EN") + chk("idiomas", m.idiomas, "es", "ES") + '</td><td class="hide-sm">' +
            chk("regioes", m.regioes, "brickell", "Brickell") + chk("regioes", m.regioes, "beach", "Miami Beach") + chk("regioes", m.regioes, "broward", "Broward") + chk("regioes", m.regioes, "palm", "Palm Beach") + '</td><td class="hide-sm"><select multiple size="3" data-esp="' + m.id + '">' + lista_emps.map(function (e) { return '<option value="' + e.slug + '"' + ((m.especialidades || []).indexOf(e.slug) >= 0 ? " selected" : "") + ">" + A.esc(e.nome) + "</option>"; }).join("") + "</select></td></tr>";
        }).join("") || '<tr><td colspan="6">' + vazio("Nenhum corretor cadastrado ainda.") + "</td></tr>") + "</tbody></table></div>";
      var upd = async function (id, dados) { var r = await A.sb.from("membros").update(dados).eq("id", id); if (r.error) return A.falha(r.error); A.toast("Preferências salvas."); await A.carregar(); };
      el.querySelector("[data-auto]").addEventListener("change", async function (e) { var r = await A.sb.from("distribuicao_config").update({ ativo: e.target.checked, atualizado_em: new Date().toISOString() }).eq("id", 1); if (r.error) return A.falha(r.error); D.modulos[7].render(el, A); });
      el.querySelector("[data-pendentes]").addEventListener("click", async function () { var r = await A.sb.rpc("distribuir_pendentes"); if (r.error) return A.falha(r.error); A.toast(r.data + " lead(s) distribuído(s)."); D.modulos[7].render(el, A); });
      el.querySelectorAll("[data-recebe]").forEach(function (i) { i.addEventListener("change", function () { upd(i.dataset.recebe, { recebe_leads: i.checked }); }); });
      el.querySelectorAll("[data-cap]").forEach(function (i) { i.addEventListener("change", function () { upd(i.dataset.cap, { capacidade: Number(i.value) || 0 }); }); });
      el.querySelectorAll("[data-esp]").forEach(function (s) { s.addEventListener("change", function () { upd(s.dataset.esp, { especialidades: Array.prototype.map.call(s.selectedOptions, function (o) { return o.value; }) }); }); });
      el.querySelectorAll("[data-m]").forEach(function (i) { i.addEventListener("change", function () {
        var campo = i.dataset.campo, vals = Array.prototype.map.call(el.querySelectorAll('[data-m="' + i.dataset.m + '"][data-campo="' + campo + '"]:checked'), function (x) { return x.value; });
        var d = {}; d[campo] = vals; upd(i.dataset.m, d);
      }); });
    }
  });

  // =====================================================================
  // PORTAL DA CONSTRUTORA (só números, sem contatos de clientes)
  // =====================================================================
  D.modulos.push({
    id: "portal", titulo: "Portal", tituloLongo: "Portal da construtora", icone: "◆", papeis: ["construtora", "admin"],
    render: async function (el, A) {
      var contaSel = el.dataset.conta || null, contas = [];
      if (A.isAdmin()) {
        contas = (await A.sb.from("contas").select("id, nome").order("nome")).data || [];
        if (!contas.length) { el.innerHTML = vazio("Cadastre um cliente em Cobrança e vincule empreendimentos em Inventário para ver o portal dele."); return; }
        contaSel = contaSel || contas[0].id;
      }
      var r = await A.sb.rpc("portal_resumo", { p_conta: contaSel });
      if (r.error) { el.innerHTML = vazio("Sua conta ainda não está vinculada a uma construtora. Fale com a equipe danova AI."); return; }
      var P = r.data, E = P.empreendimentos || [];
      var tot = function (k) { return E.reduce(function (s, e) { return s + (typeof k === "function" ? k(e) : Number(e[k] || 0)); }, 0); };
      var vendidoUSD = tot(function (e) { return e.vendas.filter(function (v) { return v.status === "fechada" && v.moeda === "USD"; }).reduce(function (s, v) { return s + Number(v.valor); }, 0); });
      var invBRL = tot(function (e) { return Object.keys(e.investimento || {}).filter(function (k) { return /:BRL$/.test(k); }).reduce(function (s, k) { return s + Number(e.investimento[k]); }, 0); });
      var invUSD = tot(function (e) { return Object.keys(e.investimento || {}).filter(function (k) { return /:USD$/.test(k); }).reduce(function (s, k) { return s + Number(e.investimento[k]); }, 0); });
      var leads = tot("leads");
      var lista_emps = await emps(A);
      el.innerHTML = (A.isAdmin() ? '<div class="filters"><label>Ver portal de <select data-portal-conta>' + contas.map(function (c) { return '<option value="' + c.id + '"' + (c.id === contaSel ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select></label><span class=\"note\">É exatamente o que a construtora vê — sem nomes ou contatos de clientes.</span></div>" : "") +
        '<div class="portal-head"><div><h3>' + A.esc(P.conta.nome) + '</h3><small>Plano: ' + moeda(P.conta.mensalidade, P.conta.moeda_mensalidade) + "/mês + " + pct(P.conta.taxa_fechamento) + " sobre vendas fechadas</small></div></div>" +
        '<div class="kpis">' + A.kpi("Leads gerados", leads, "todos os canais") + A.kpi("Visitas", tot("visitas"), tot("visitas_realizadas") + " realizadas") +
        A.kpi("Vendas fechadas", tot(function (e) { return e.vendas.filter(function (v) { return v.status === "fechada"; }).length; }), moeda(vendidoUSD, "USD")) +
        A.kpi("Investimento em mídia", invBRL || invUSD ? [invBRL ? moeda(invBRL, "BRL") : "", invUSD ? moeda(invUSD, "USD") : ""].filter(Boolean).join(" + ") : "—", invBRL && leads ? "CPL " + moeda(invBRL / leads, "BRL") : "custo por lead") +
        A.kpi("ROAS", invUSD && vendidoUSD ? (vendidoUSD / invUSD).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "x" : "—", "vendas ÷ mídia em US$") + "</div>" +
        (E.length ? E.map(function (e) {
          var u = e.unidades || {}, t = u.total || 0;
          var funil = A.ETAPAS.filter(function (x) { return x.id !== "perdido"; }).map(function (x) { return [x.id, (e.funil || {})[x.id] || 0, x.nome]; });
          var canais = Object.keys(e.canais || {}).map(function (k) { return [k, e.canais[k], k]; }).sort(function (a, b) { return b[1] - a[1]; });
          return '<div class="card portal-emp"><h3>' + A.esc(e.nome) + " <small>" + A.esc([{ pre_lancamento: "Pré-lançamento", lancamento: "Lançamento", em_obra: "Em obra", pronto: "Pronto", esgotado: "Esgotado" }[e.status], e.entrega].filter(Boolean).join(" · ")) + "</small></h3>" +
            '<div class="grid3"><div><h4>Unidades</h4>' + (t ? '<div class="inv-bar big"><i class="d" style="width:' + u.disponivel / t * 100 + '%"></i><i class="r" style="width:' + u.reservada / t * 100 + '%"></i><i class="v" style="width:' + u.vendida / t * 100 + '%"></i></div><p class="note">' + u.disponivel + " disponíveis · " + u.reservada + " reservadas · " + u.vendida + " vendidas de " + t + "</p>" : '<p class="note">Envie a tabela de unidades para acompanharmos a disponibilidade.</p>') + "</div>" +
            "<div><h4>Funil de leads</h4>" + A.barras(funil, "linear-gradient(90deg,#3ec5f0,#6b3fd4)") + "</div>" +
            "<div><h4>Origem</h4>" + A.barras(canais, "#f7a24a") + "</div></div>" +
            (e.vendas.length ? '<h4 style="margin-top:14px">Negociações</h4><div class="table-wrap"><table><thead><tr><th>Data</th><th>Status</th><th>Valor</th><th>Canal</th></tr></thead><tbody>' + e.vendas.map(function (v) { return "<tr><td>" + A.dt(v.data) + "</td><td>" + pill(STATUS_VENDA[v.status], "vd-" + v.status) + "</td><td>" + moeda(v.valor, v.moeda) + "</td><td>" + A.esc(CANAIS[v.canal] || v.canal || "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
            (e.videos && e.videos.length ? '<h4 style="margin-top:14px">Vídeos para anúncios</h4>' + e.videos.map(function (v) { return '<p class="note">' + pill(STATUS_VIDEO[v.status]) + " " + A.esc(v.formatos.join(", ")) + " · " + A.esc(v.duracoes.join(", ")) + (v.prazo ? " · prazo " + A.dt(v.prazo) : "") + (v.link ? ' · <a href="' + A.esc(v.link) + '" target="_blank" rel="noopener">baixar vídeos</a>' : "") + "</p>"; }).join("") : "") +
            "</div>";
        }).join("") : vazio("Nenhum empreendimento vinculado a esta conta ainda.")) +
        '<div class="card" style="margin-top:16px"><h3>Faturas</h3>' + ((P.faturas || []).length ? '<div class="table-wrap"><table><thead><tr><th>Competência</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>' + P.faturas.map(function (f) { return "<tr><td>" + f.competencia.slice(0, 7).split("-").reverse().join("/") + "</td><td>" + A.esc(f.descricao || f.tipo) + "</td><td>" + moeda(f.valor, f.moeda) + "</td><td>" + (f.vencimento ? A.dt(f.vencimento) : "—") + "</td><td>" + pill({ aberta: "Aberta", paga: "Paga", cancelada: "Cancelada" }[f.status], "ft-" + f.status) + "</td></tr>"; }).join("") + "</tbody></table></div>" : vazio("Nenhuma fatura emitida.")) + "</div>" +
        (A.S.me.papel === "construtora" ? '<div style="margin-top:16px">' + videoForm(A, lista_emps.filter(function (x) { return E.some(function (e) { return e.id === x.id; }); }), true) + "</div>" : "");
      var sc = el.querySelector("[data-portal-conta]");
      if (sc) sc.addEventListener("change", function () { el.dataset.conta = sc.value; D.modulos[8].render(el, A); });
      var fv = el.querySelector("[data-video]");
      if (fv) fv.addEventListener("submit", async function (e) { e.preventDefault(); if (await enviarVideo(e.target, A, true)) D.modulos[8].render(el, A); });
    }
  });

  // =====================================================================
  // FICHA DO LEAD: visitas, negociação e documentos
  // =====================================================================
  D.ganchosLead.push(async function (box, l, A) {
    if (!box || A.S.me.papel === "construtora") return;
    box.innerHTML = '<div class="section-title">Visitas</div><div data-visitas class="mod-box">Carregando…</div>' +
      '<div class="section-title">Negociação</div><div data-negocio class="mod-box">Carregando…</div>' +
      '<div class="section-title">Documentos</div><div data-docs class="mod-box">Carregando…</div>';
    var lista_emps = await emps(A);
    var reabrir = function () { A.abrirLead(l.id); };

    // --- visitas
    var rv = await A.sb.from("visitas").select("*").eq("lead_id", l.id).order("inicio", { ascending: false });
    var vis = rv.data || [];
    var amanha = new Date(); amanha.setDate(amanha.getDate() + 1); amanha.setHours(10, 0, 0, 0);
    box.querySelector("[data-visitas]").innerHTML =
      (vis.map(function (v) { return '<div class="mini-row"><span>' + dataHora(v.inicio) + " · " + (v.formato === "video" ? "videochamada" : A.esc(v.local || "presencial")) + '</span><select data-vst="' + v.id + '">' + opts(STATUS_VISITA, v.status) + "</select></div>"; }).join("") || '<p class="note">Nenhuma visita agendada.</p>') +
      '<div class="mini-form"><input type="datetime-local" data-vinicio value="' + localInput(amanha) + '"><select data-vformato><option value="presencial">Presencial</option><option value="video">Videochamada</option></select><input data-vlocal placeholder="Local / link" value=""><button type="button" class="btn small primary" data-vagendar>Agendar</button></div>';
    box.querySelectorAll("[data-vst]").forEach(function (s) { s.addEventListener("change", async function () { var r = await A.sb.from("visitas").update({ status: s.value }).eq("id", s.dataset.vst); if (r.error) return A.falha(r.error); A.toast("Visita atualizada."); }); });
    box.querySelector("[data-vagendar]").addEventListener("click", async function () {
      var ini = box.querySelector("[data-vinicio]").value; if (!ini) return A.toast("Escolha data e hora.", true);
      var r = await A.sb.from("visitas").insert({ lead_id: l.id, corretor_id: l.corretor_id || A.S.me.id, empreendimento_id: l.empreendimento_id || null, inicio: new Date(ini).toISOString(), formato: box.querySelector("[data-vformato]").value, local: box.querySelector("[data-vlocal]").value || null, criado_por: A.S.me.id });
      if (r.error) return A.falha(r.error); A.toast("Visita agendada."); await A.carregar(); reabrir();
    });

    // --- negociação
    var rn = await A.sb.from("vendas").select("*").eq("lead_id", l.id).order("criado_em", { ascending: false });
    var neg = rn.data || [];
    var empId = l.empreendimento_id || "";
    var ru = empId ? await A.sb.from("unidades").select("*").eq("empreendimento_id", empId).order("codigo") : { data: [] };
    var uns = (ru.data || []).filter(function (u) { return u.status === "disponivel" || u.id === l.unidade_id; });
    box.querySelector("[data-negocio]").innerHTML =
      (neg.map(function (v) { return '<div class="mini-row"><span><b>' + moeda(v.valor, v.moeda) + "</b> · comissão " + pct(v.comissao_corretor_pct) + (A.isAdmin() ? " · taxa danova " + moeda(v.taxa_danova_valor, v.moeda) : "") + '</span><select data-vdst="' + v.id + '">' + opts(STATUS_VENDA, v.status) + "</select></div>"; }).join("") || '<p class="note">Nenhuma proposta registrada.</p>') +
      '<div class="mini-form"><select data-nemp><option value="">Empreendimento…</option>' + lista_emps.map(function (e) { return '<option value="' + e.id + '"' + (e.id === empId ? " selected" : "") + ">" + A.esc(e.nome) + "</option>"; }).join("") + '</select><select data-nunid><option value="">Unidade (opcional)</option>' + uns.map(function (u) { return '<option value="' + u.id + '" data-preco="' + (u.preco || "") + '">' + A.esc(u.codigo + (u.tipologia ? " · " + u.tipologia : "") + (u.preco ? " · " + moeda(u.preco, "USD") : "")) + "</option>"; }).join("") + "</select>" +
      '<input type="number" min="0" step="1000" data-nvalor placeholder="Valor (US$)"><input type="number" min="0" max="100" step="0.1" data-ncom placeholder="Comissão do corretor %"><button type="button" class="btn small primary" data-nproposta>Registrar proposta</button></div>' +
      '<p class="note">Ao mudar para Contrato a unidade fica reservada; em Fechada ela é vendida, o lead vai para Fechado e a taxa de 1% é faturada para a construtora.</p>';
    var selU = box.querySelector("[data-nunid]");
    selU.addEventListener("change", function () { var o = selU.selectedOptions[0]; if (o && o.dataset.preco) box.querySelector("[data-nvalor]").value = o.dataset.preco; });
    box.querySelector("[data-nemp]").addEventListener("change", async function (e) {
      if (!e.target.value) return;
      var r = await A.sb.from("leads").update({ empreendimento_id: e.target.value, empreendimento: (lista_emps.find(function (x) { return x.id === e.target.value; }) || {}).nome }).eq("id", l.id);
      if (r.error) return A.falha(r.error); await A.carregar(); reabrir();
    });
    box.querySelectorAll("[data-vdst]").forEach(function (s) { s.addEventListener("change", async function () {
      var r = await A.sb.from("vendas").update({ status: s.value }).eq("id", s.dataset.vdst);
      if (r.error) return A.falha(r.error); A.toast("Negociação: " + STATUS_VENDA[s.value] + "."); await A.carregar(); reabrir();
    }); });
    box.querySelector("[data-nproposta]").addEventListener("click", async function () {
      var valor = Number(box.querySelector("[data-nvalor]").value); if (!valor) return A.toast("Informe o valor da proposta.", true);
      var r = await A.sb.from("vendas").insert({ lead_id: l.id, empreendimento_id: box.querySelector("[data-nemp]").value || null, unidade_id: selU.value || null, valor: valor, moeda: "USD", comissao_corretor_pct: (Number(box.querySelector("[data-ncom]").value) || 0) / 100, criado_por: A.S.me.id });
      if (r.error) return A.falha(r.error); A.toast("Proposta registrada."); await A.carregar(); reabrir();
    });

    // --- documentos
    var rd = await A.sb.from("documentos").select("*").eq("lead_id", l.id).order("criado_em", { ascending: false });
    var docs = rd.data || [];
    box.querySelector("[data-docs]").innerHTML =
      (docs.map(function (d) { return '<div class="mini-row"><span>' + pill({ proposta: "Proposta", contrato: "Contrato", identificacao: "Identificação", comprovante: "Comprovante", outro: "Outro" }[d.tipo]) + " " + A.esc(d.nome) + ' <small class="muted">' + A.dt(d.criado_em) + '</small></span><span><button type="button" class="btn ghost small" data-baixar="' + A.esc(d.caminho) + '">Abrir</button></span></div>'; }).join("") || '<p class="note">Nenhum documento.</p>') +
      '<div class="mini-form"><select data-dtipo><option value="proposta">Proposta</option><option value="contrato">Contrato</option><option value="identificacao">Identificação</option><option value="comprovante">Comprovante</option><option value="outro">Outro</option></select><input type="file" data-darq accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"><button type="button" class="btn small primary" data-denviar>Enviar</button></div><p class="note">Até 20 MB. Arquivos privados: só quem acessa este lead consegue abrir.</p>';
    box.querySelectorAll("[data-baixar]").forEach(function (b) { b.addEventListener("click", async function () {
      var r = await A.sb.storage.from("documentos").createSignedUrl(b.dataset.baixar, 120);
      if (r.error) return A.falha(r.error); window.open(r.data.signedUrl, "_blank", "noopener");
    }); });
    box.querySelector("[data-denviar]").addEventListener("click", async function () {
      var arq = box.querySelector("[data-darq]").files[0]; if (!arq) return A.toast("Escolha um arquivo.", true);
      if (arq.size > 20 * 1024 * 1024) return A.toast("Arquivo acima de 20 MB.", true);
      var nomeSeguro = arq.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-80);
      var caminho = l.id + "/" + Date.now() + "-" + nomeSeguro;
      var up = await A.sb.storage.from("documentos").upload(caminho, arq, { contentType: arq.type || undefined });
      if (up.error) return A.falha(up.error);
      var r = await A.sb.from("documentos").insert({ lead_id: l.id, nome: arq.name.slice(0, 200), caminho: caminho, tipo: box.querySelector("[data-dtipo]").value, tamanho: arq.size, enviado_por: A.S.me.id });
      if (r.error) return A.falha(r.error); A.toast("Documento enviado."); reabrir();
    });
  });
})();
