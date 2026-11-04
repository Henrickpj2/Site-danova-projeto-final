/* danova AI — CRM: importar base de leads por planilha (.xlsx ou .csv) */
(function () {
  "use strict";
  var MAX = 5000;
  var PERFIS = ["Investidor ou comprador", "Corretor de imóveis", "Imobiliária", "Construtora ou incorporadora", "Family office", "Outro"];
  var norm = function (s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
  var CAMPOS = {
    nome: ["nome", "nomedocliente", "cliente", "nomecompleto", "name", "fullname"],
    email: ["email", "emails", "correio", "mail"],
    telefone: ["telefone", "telefonewhatsapp", "whatsapp", "celular", "celularwhatsapp", "fone", "phone", "telefone1", "tel"],
    pais: ["pais", "country"],
    perfil: ["perfil", "tipodecliente", "profile"],
    empreendimento: ["empreendimento", "imovel", "projeto", "produto"],
    objetivo: ["objetivo", "finalidade"],
    orcamento: ["orcamento", "budget", "faixadeinvestimento"],
    etapa: ["etapa", "status", "fase"],
    temperatura: ["temperatura", "temp"],
    valor_estimado: ["valorestimado", "valorestimadous", "valorestimadousd", "valor", "valorus"],
    proximo_passo: ["proximopasso", "proximaacao"],
    proximo_contato: ["datadoproximocontato", "proximocontato", "dataproximocontato", "followup"],
    corretor: ["corretor", "corretorresponsavel", "responsavel"],
    origem: ["origem", "fonte", "source", "indicacao"],
    mensagem: ["mensagemobservacoes", "mensagem", "observacoes", "observacao", "obs", "notas", "anotacoes"]
  };
  var ALIAS = {}; Object.keys(CAMPOS).forEach(function (k) { CAMPOS[k].forEach(function (a) { ALIAS[a] = k; }); });

  // ---------- leitura de arquivos ----------
  function lerCSV(txt) {
    txt = txt.replace(/^﻿/, "");
    var prim = txt.split(/\r?\n/)[0] || "", d = [";", ",", "\t"].sort(function (a, b) { return prim.split(b).length - prim.split(a).length; })[0];
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < txt.length; i++) {
      var c = txt[i];
      if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === d) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function lerXLSX(buf) {
    if (!window.fflate) throw new Error("Leitor de planilha não carregou. Recarregue a página.");
    var z = window.fflate.unzipSync(new Uint8Array(buf)), td = new TextDecoder("utf-8"), dp = new DOMParser();
    var xml = function (p) { var f = z[p]; return f ? dp.parseFromString(td.decode(f), "application/xml") : null; };
    var wb = xml("xl/workbook.xml"); if (!wb) throw new Error("Arquivo não é uma planilha .xlsx válida.");
    var sh = wb.getElementsByTagName("sheet");
    var alvo = null;
    for (var i = 0; i < sh.length; i++) { var n = norm(sh[i].getAttribute("name")); if (n === "leads" || n === "clientes" || n === "contatos") { alvo = sh[i]; break; } }
    alvo = alvo || sh[0];
    var rid = alvo.getAttribute("r:id") || alvo.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    var rels = xml("xl/_rels/workbook.xml.rels"), caminho = "xl/worksheets/sheet1.xml";
    if (rels) { var R = rels.getElementsByTagName("Relationship"); for (var j = 0; j < R.length; j++) if (R[j].getAttribute("Id") === rid) { var t = R[j].getAttribute("Target"); caminho = t.charAt(0) === "/" ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); } }
    var ss = [], sst = xml("xl/sharedStrings.xml");
    if (sst) { var si = sst.getElementsByTagName("si"); for (var k = 0; k < si.length; k++) { var ts = si[k].getElementsByTagName("t"), s = ""; for (var m = 0; m < ts.length; m++) s += ts[m].textContent; ss.push(s); } }
    var doc = xml(caminho); if (!doc) throw new Error("Não encontrei a aba de dados na planilha.");
    var out = [], linhas = doc.getElementsByTagName("row");
    for (var a = 0; a < linhas.length; a++) {
      var cs = linhas[a].getElementsByTagName("c"), r = [];
      for (var b = 0; b < cs.length; b++) {
        var ref = cs[b].getAttribute("r") || "", col = 0, L = ref.replace(/\d+/g, "");
        for (var x = 0; x < L.length; x++) col = col * 26 + (L.charCodeAt(x) - 64);
        col = col ? col - 1 : r.length;
        var tipo = cs[b].getAttribute("t"), v = cs[b].getElementsByTagName("v")[0], val = v ? v.textContent : "";
        if (tipo === "s") val = ss[+val] || "";
        else if (tipo === "inlineStr") { var tt = cs[b].getElementsByTagName("t"); val = ""; for (var y = 0; y < tt.length; y++) val += tt[y].textContent; }
        else if (tipo === "b") val = val === "1" ? "SIM" : "";
        r[col] = val;
      }
      out[(+linhas[a].getAttribute("r") || a + 1) - 1] = r;
    }
    return Array.from(out, function (r) { return r || []; });
  }

  // ---------- normalização ----------
  function soDig(v) { return String(v || "").replace(/\D/g, ""); }
  function data(v) {
    v = String(v || "").trim(); if (!v) return null;
    if (/^\d{4,5}(\.\d+)?$/.test(v)) { var n = +v; if (n > 20000 && n < 80000) { var d = new Date(Math.round((n - 25569) * 864e5)); return d.toISOString().slice(0, 10); } }
    var m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { var ano = m[3].length === 2 ? "20" + m[3] : m[3]; return ano + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    return null;
  }
  function numero(v) {
    var s = String(v || "").replace(/[^\d.,]/g, ""); if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s) && (s.split(".")[1] || "").length !== 3) return +s;
    s = s.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
    var n = parseFloat(s); return isFinite(n) ? n : null;
  }
  function casar(lista, v) { var n = norm(v); if (!n) return null; for (var i = 0; i < lista.length; i++) if (norm(lista[i]) === n) return lista[i]; for (var j = 0; j < lista.length; j++) if (norm(lista[j]).indexOf(n) === 0 || n.indexOf(norm(lista[j])) === 0) return lista[j]; return null; }

  function montar(rows, API) {
    var S = API.S, EMP = API.EMPREENDIMENTOS || [];
    var hi = -1, mapa = [];
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var m = (rows[i] || []).map(function (h) { return ALIAS[norm(String(h || "").replace(/\*/g, ""))] || null; });
      if (m.filter(Boolean).length >= 2 && (m.indexOf("nome") >= 0 || m.indexOf("email") >= 0 || m.indexOf("telefone") >= 0)) { hi = i; mapa = m; break; }
    }
    if (hi < 0) throw new Error("Não encontrei o cabeçalho. A planilha precisa ter colunas como Nome, E-mail e Telefone — use o modelo.");
    var cab = rows[hi];
    var existE = {}, existT = {};
    (S.leads || []).forEach(function (l) { if (l.email) existE[l.email.toLowerCase().trim()] = 1; var t = soDig(l.telefone); if (t.length >= 8) existT[t.slice(-9)] = 1; });
    var res = { ok: [], dup: [], erro: [], semCorretor: 0, total: 0 };
    for (var r = hi + 1; r < rows.length && res.total < MAX; r++) {
      var row = rows[r] || []; if (!row.some(function (c) { return String(c || "").trim(); })) continue;
      res.total++;
      var d = {}, extras = [];
      row.forEach(function (val, c) {
        val = String(val == null ? "" : val).trim(); if (!val) return;
        var k = mapa[c];
        if (k) d[k] = d[k] ? d[k] + " · " + val : val;
        else if (cab[c]) extras.push(String(cab[c]).trim() + ": " + val);
      });
      if (/exemplo/i.test(d.nome || "") && /exemplo/i.test(d.email || d.mensagem || "")) { res.total--; continue; }
      var lead = { nome: (d.nome || "").slice(0, 200), email: d.email ? d.email.split(/[\s;,·]+/)[0].toLowerCase() : null, telefone: d.telefone || null, pais: d.pais || null,
        objetivo: d.objetivo || null, orcamento: d.orcamento || null, proximo_passo: d.proximo_passo || null, canal: "importacao", origem: d.origem || "Importação de planilha" };
      var obs = [];
      if (d.email && /[\s;,·]/.test(d.email.trim())) obs.push("Outros e-mails: " + d.email.split(/[\s;,·]+/).slice(1).join(", "));
      if (d.perfil) { lead.perfil = casar(PERFIS, d.perfil) || d.perfil; }
      if (d.empreendimento) { lead.empreendimento = casar(EMP, d.empreendimento) || d.empreendimento; }
      if (d.etapa) { var e = API.ETAPAS.find(function (x) { return norm(x.id) === norm(d.etapa) || norm(x.nome) === norm(d.etapa) || norm(x.nome).indexOf(norm(d.etapa)) === 0; }); if (e) lead.etapa = e.id; else obs.push("Etapa na planilha: " + d.etapa); }
      if (d.temperatura) { var t = norm(d.temperatura); lead.temperatura = /quent|hot/.test(t) ? "quente" : /morn|warm/.test(t) ? "morno" : /fri|cold/.test(t) ? "frio" : null; }
      if (d.valor_estimado) lead.valor_estimado = numero(d.valor_estimado);
      if (d.proximo_contato) { lead.proximo_contato = data(d.proximo_contato); if (!lead.proximo_contato) obs.push("Próximo contato: " + d.proximo_contato); }
      if (API.isAdmin()) {
        if (d.corretor) { var nc = norm(d.corretor), mb = (S.membros || []).find(function (m) { return m.ativo && (norm(m.nome) === nc || norm(m.email) === nc || norm(m.nome).indexOf(nc) === 0); }); if (mb) lead.corretor_id = mb.id; else { obs.push("Corretor na planilha: " + d.corretor); res.semCorretor++; } }
      } else lead.corretor_id = S.me.id;
      var msg = [d.mensagem].concat(obs, extras).filter(Boolean).join("\n"); lead.mensagem = msg ? msg.slice(0, 4000) : null;
      if (!lead.email && !lead.telefone) { res.erro.push({ linha: r + 1, nome: lead.nome, motivo: "sem e-mail e sem telefone" }); continue; }
      if (lead.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) { obs.push("E-mail inválido na planilha: " + lead.email); lead.mensagem = [lead.mensagem, "E-mail inválido na planilha: " + lead.email].filter(Boolean).join("\n"); lead.email = null; if (!lead.telefone) { res.erro.push({ linha: r + 1, nome: lead.nome, motivo: "e-mail inválido e sem telefone" }); continue; } }
      var td = soDig(lead.telefone).slice(-9);
      if ((lead.email && existE[lead.email]) || (td.length >= 8 && existT[td])) { res.dup.push({ linha: r + 1, nome: lead.nome || lead.email || lead.telefone }); continue; }
      if (lead.email) existE[lead.email] = 1; if (td.length >= 8) existT[td] = 1;
      res.ok.push(lead);
    }
    return res;
  }

  // ---------- interface ----------
  function css() {
    if (document.getElementById("imp-css")) return;
    var s = document.createElement("style"); s.id = "imp-css";
    s.textContent = ".imp-bg{position:fixed;inset:0;background:rgba(11,20,36,.45);z-index:90;display:grid;place-items:center;padding:16px}" +
      ".imp{background:#fff;border-radius:16px;max-width:640px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.3)}" +
      ".imp header{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 22px 8px}.imp h3{margin:0;font-size:18px}.imp .sub{color:#66758a;font-size:13px;margin-top:4px}" +
      ".imp .corpo{padding:8px 22px 22px;display:grid;gap:14px}.imp .passo{border:1px solid #e3e8ef;border-radius:12px;padding:14px 16px}.imp .passo b{display:block;margin-bottom:6px}" +
      ".imp .drop{border:2px dashed #c9d3df;border-radius:12px;padding:22px;text-align:center;cursor:pointer;color:#24364b}.imp .drop.on{border-color:#16b8a6;background:#f0fbf9}" +
      ".imp .nums{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.imp .nums div{background:#f4f7fa;border-radius:10px;padding:10px;text-align:center}.imp .nums strong{display:block;font-size:22px}" +
      ".imp ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:#66758a;max-height:120px;overflow:auto}.imp .acoes{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}";
    document.head.appendChild(s);
  }
  function abrir() {
    var API = window.DanovaCRM && window.DanovaCRM.api; if (!API) return;
    css();
    var bg = document.createElement("div"); bg.className = "imp-bg";
    bg.innerHTML = '<div class="imp" role="dialog" aria-modal="true" aria-label="Importar planilha de leads"><header><div><h3>Importar planilha de leads</h3><div class="sub">Suba sua base de clientes em .xlsx ou .csv</div></div><button class="icon-btn" data-x aria-label="Fechar">✕</button></header>' +
      '<div class="corpo"><div class="passo"><b>1. Baixe o modelo</b>Preencha uma linha por cliente. Obrigatório: <strong>Nome</strong> e <strong>e-mail ou telefone</strong>. As demais colunas são opcionais.<div style="margin-top:10px"><a class="btn small ghost" href="modelo-importacao-leads.xlsx" download>Baixar modelo (.xlsx)</a></div></div>' +
      '<div class="passo"><b>2. Envie a planilha preenchida</b><label class="drop" data-drop><input type="file" accept=".xlsx,.csv,text/csv" hidden data-arq><span data-txt>Clique para escolher ou arraste o arquivo aqui</span></label></div>' +
      '<div data-prev></div></div></div>';
    document.body.appendChild(bg);
    var fechar = function () { bg.remove(); document.removeEventListener("keydown", esc); };
    var esc = function (e) { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", esc);
    bg.querySelector("[data-x]").addEventListener("click", fechar);
    bg.addEventListener("click", function (e) { if (e.target === bg) fechar(); });
    var drop = bg.querySelector("[data-drop]"), inp = bg.querySelector("[data-arq]"), prev = bg.querySelector("[data-prev]");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) processar(e.dataTransfer.files[0]); });
    inp.addEventListener("change", function () { if (inp.files[0]) processar(inp.files[0]); });

    function processar(f) {
      bg.querySelector("[data-txt]").textContent = f.name;
      prev.innerHTML = '<p class="note">Lendo a planilha…</p>';
      if (f.size > 15 * 1024 * 1024) { prev.innerHTML = '<p class="note" style="color:#c2410c">Arquivo muito grande (máx. 15 MB).</p>'; return; }
      var ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ext === "xls") { prev.innerHTML = '<p class="note" style="color:#c2410c">Formato .xls antigo não é aceito. No Excel, use “Salvar como” → .xlsx ou .csv.</p>'; return; }
      var rd = new FileReader();
      rd.onload = function () {
        var res;
        try { res = montar(ext === "csv" ? lerCSV(new TextDecoder("utf-8").decode(rd.result)) : lerXLSX(rd.result), API); }
        catch (e) { prev.innerHTML = '<p class="note" style="color:#c2410c">' + API.esc(e.message || "Não consegui ler o arquivo.") + "</p>"; return; }
        mostrar(res, f.name);
      };
      rd.readAsArrayBuffer(f);
    }
    function mostrar(res, nomeArq) {
      var E = API.esc;
      prev.innerHTML = '<div class="passo"><b>3. Confira e importe</b><div class="nums"><div><strong>' + res.ok.length + '</strong>novos</div><div><strong>' + res.dup.length + '</strong>já no CRM</div><div><strong>' + res.erro.length + "</strong>com problema</div></div>" +
        (res.dup.length ? '<p class="note" style="margin-top:10px">Duplicados (mesmo e-mail ou telefone de um lead que já existe) não serão importados:</p><ul>' + res.dup.slice(0, 50).map(function (d) { return "<li>Linha " + d.linha + ": " + E(d.nome) + "</li>"; }).join("") + "</ul>" : "") +
        (res.erro.length ? '<p class="note" style="margin-top:10px">Linhas ignoradas:</p><ul>' + res.erro.slice(0, 50).map(function (d) { return "<li>Linha " + d.linha + (d.nome ? " (" + E(d.nome) + ")" : "") + ": " + E(d.motivo) + "</li>"; }).join("") + "</ul>" : "") +
        (res.semCorretor ? '<p class="note" style="margin-top:10px">' + res.semCorretor + " linha(s) com corretor não encontrado no CRM — ficam sem corretor e o nome vai para as observações.</p>" : "") +
        (res.total >= MAX ? '<p class="note" style="margin-top:10px">Limite de ' + MAX + " linhas por envio. Divida a planilha em partes.</p>" : "") +
        '<p class="note" style="margin-top:10px">Os leads entram marcados como “importação” (a coluna Origem da planilha é mantida) e não são enviados como conversão ao Meta/Google.</p>' +
        '<div class="acoes" style="margin-top:12px"><button class="btn primary" data-ir' + (res.ok.length ? "" : " disabled") + ">Importar " + res.ok.length + " lead(s)</button></div></div>";
      var b = prev.querySelector("[data-ir]");
      if (b) b.addEventListener("click", async function () {
        b.disabled = true; var feitos = 0;
        for (var i = 0; i < res.ok.length; i += 100) {
          b.textContent = "Importando… " + feitos + "/" + res.ok.length;
          var lote = res.ok.slice(i, i + 100);
          var r = await API.sb.from("leads").insert(lote).select("id");
          if (r.error) { API.falha(r.error); b.textContent = "Parou em " + feitos + " de " + res.ok.length; await API.carregar(); return; }
          feitos += r.data.length;
          API.sb.from("lead_eventos").insert(r.data.map(function (x) { return { lead_id: x.id, autor_id: API.S.me.id, tipo: "nota", texto: "Importado da planilha “" + nomeArq + "” por " + API.S.me.nome }; })).then(function () {});
        }
        API.toast(feitos + " lead(s) importado(s).");
        await API.carregar(); fechar();
      });
    }
  }
  window.DanovaCRM = window.DanovaCRM || {};
  window.DanovaCRM.importar = abrir;
  window.DanovaCRM._importarTeste = { lerCSV: lerCSV, lerXLSX: lerXLSX, montar: montar };
})();
