/* danova AI — Corretores parceiros. Só administradores.
   Rede de corretores com quem a danova AI se relaciona (parcerias e indicações). Não são usuários do CRM:
   não têm login nem recebem leads. Tabela public.parceiros (migração 2026-11-07-corretores-parceiros.sql). */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];

  var STATUS = { novo: ["Novo", ""], em_contato: ["Em contato", "warn"], parceiro: ["Parceiro ativo", "ok"], sem_interesse: ["Sem interesse", "bad"] };
  var st = { q: "", status: "", origem: "", editando: null, novo: false, msg: null };
  var OBJ_PADRAO = "Apresentar a danova AI e convidar para uma parceria em vendas internacionais (clientes que querem comprar imóvel na Flórida).";
  var LS = { get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  function soDig(s) { return String(s || "").replace(/\D/g, ""); }
  function zap(tel) { var d = soDig(tel); if (d.length === 10 || d.length === 11) d = "55" + d; return d.length >= 12 ? "https://wa.me/" + d : ""; }
  function primeiroNome(n) {
    n = String(n || "").trim();
    if (!n || /@|imobili|imóveis|imoveis|negócios|negocios|corretor|consult|realiza|express|&/i.test(n) || n === n.toUpperCase() && n.length > 12) return "";
    var p = n.split(/\s+/)[0]; return p.length > 1 ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
  }
  function modelo(p, assinatura) {
    var nome = primeiroNome(p.nome);
    return "Olá" + (nome ? ", " + nome : "") + "! Tudo bem? Aqui é " + (assinatura || "a equipe") + ", da danova AI. " +
      "Trabalhamos com corretores do Brasil em vendas internacionais de imóveis de alto padrão na Flórida (Miami e Orlando), com marketing, CRM e atendimento por IA. " +
      "Você atende clientes que pensam em investir nos EUA? Posso te explicar como funciona a parceria?";
  }
  function erroIA(m) {
    m = String(m || "");
    if (/ia_nao_configurada/.test(m)) return "A IA não está configurada (falta ANTHROPIC_API_KEY no Supabase). Usei uma mensagem-modelo.";
    if (/sem_acesso/.test(m)) return "Só administradores podem gerar mensagens.";
    if (/Failed to send|FunctionsFetchError|404/.test(m)) return "A função de IA não respondeu. Usei uma mensagem-modelo.";
    return "A IA não respondeu agora. Usei uma mensagem-modelo.";
  }
  function assinatura(A) { return LS.get("danova_parc_ass", "") || (A.S && A.S.me && A.S.me.nome) || ""; }
  async function gerar(A, p) {
    var r = await A.sb.functions.invoke("parceiro-mensagem", { body: { parceiro_id: p.id, objetivo: LS.get("danova_parc_obj", OBJ_PADRAO), assinatura: assinatura(A) } });
    if (!r.error && r.data && r.data.mensagem) return { texto: r.data.mensagem, ia: true };
    var det = ""; try { det = (await r.error.context.json()).erro || ""; } catch (x) { det = r.error && r.error.message; }
    return { texto: modelo(p, assinatura(A)), ia: false, aviso: erroIA(det) };
  }
  function msgHTML(A, p, m) {
    return '<div class="card kb-form" data-pmsg><h3>WhatsApp para ' + A.esc(p.nome || p.telefone) + "</h3>" +
      (m.carregando ? '<p class="muted">A IA está escrevendo a mensagem…</p>' :
        (m.aviso ? '<p class="note">' + A.esc(m.aviso) + "</p>" : '<p class="muted" style="margin-top:0">Mensagem escrita pela IA. Confira e ajuste antes de enviar.</p>') +
        '<label>Mensagem<textarea name="texto" rows="6" style="min-height:120px" maxlength="1500">' + A.esc(m.texto) + "</textarea></label>" +
        '<div class="kb-acts"><button type="button" class="btn ghost" data-mfechar>Fechar</button><span class="spacer"></span>' +
        '<button type="button" class="btn" data-mnova>Gerar outra</button><button type="button" class="btn" data-mcopiar>Copiar</button>' +
        '<button type="button" class="btn primary" data-mabrir>Abrir no WhatsApp</button></div>') + "</div>";
  }

  function formHTML(A, p) {
    p = p || {};
    var v = function (k) { return A.esc(p[k] || ""); };
    return '<form class="card kb-form" data-pform>' +
      "<h3>" + (p.id ? "Editar parceiro" : "Novo corretor parceiro") + "</h3>" +
      '<div class="kb-grid"><label>Nome *<input name="nome" required maxlength="200" value="' + v("nome") + '"></label>' +
      '<label>WhatsApp / telefone<input name="telefone" maxlength="40" value="' + v("telefone") + '" placeholder="+55 27 99999-0000"></label></div>' +
      '<div class="kb-grid"><label>E-mail<input name="email" type="email" maxlength="200" value="' + v("email") + '"></label>' +
      '<label>CRECI<input name="creci" maxlength="40" value="' + v("creci") + '"></label></div>' +
      '<div class="kb-grid"><label>Imobiliária<input name="imobiliaria" maxlength="200" value="' + v("imobiliaria") + '"></label>' +
      '<label>Cidade / região<input name="cidade" maxlength="120" value="' + v("cidade") + '"></label></div>' +
      '<div class="kb-grid"><label>Origem<input name="origem" maxlength="200" value="' + A.esc(p.origem || (p.id ? "" : "Contato Danielle Martins")) + '"></label>' +
      '<label>Status<select name="status">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === (p.status || "novo") ? " selected" : "") + ">" + STATUS[k][0] + "</option>"; }).join("") + "</select></label></div>" +
      '<label>Observações<textarea name="observacoes" rows="3" maxlength="4000" style="min-height:80px">' + v("observacoes") + "</textarea></label>" +
      '<div class="kb-acts"><span class="spacer"></span><button type="button" class="btn ghost" data-cancelar>Cancelar</button><button class="btn primary">' + (p.id ? "Salvar" : "Adicionar") + "</button></div></form>";
  }

  function csv(lista) {
    var cab = ["Nome", "Telefone", "E-mail", "CRECI", "Imobiliária", "Cidade", "Origem", "Status", "Observações"];
    var lin = lista.map(function (p) { return [p.nome, p.telefone, p.email, p.creci, p.imobiliaria, p.cidade, p.origem, (STATUS[p.status] || [p.status])[0], p.observacoes]; });
    var txt = [cab].concat(lin).map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(";"); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" }));
    a.download = "corretores-parceiros.csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  async function render(el, A) {
    var r = await A.sb.from("parceiros").select("*").order("nome");
    if (r.error) {
      el.innerHTML = '<div class="empty">' + (/parceiros/.test(r.error.message) ? "A área de parceiros ainda não foi criada no banco. Aplique a migração <code>supabase/migracoes/2026-11-07-corretores-parceiros.sql</code>." : A.esc(r.error.message)) + "</div>";
      return;
    }
    var todos = r.data || [];
    var origens = Array.from(new Set(todos.map(function (p) { return p.origem; }).filter(Boolean))).sort();
    var q = st.q.toLowerCase(), qd = soDig(st.q);
    var lista = todos.filter(function (p) {
      if (st.status && p.status !== st.status) return false;
      if (st.origem && p.origem !== st.origem) return false;
      if (q && [p.nome, p.email, p.creci, p.imobiliaria, p.cidade, p.observacoes].join(" ").toLowerCase().indexOf(q) < 0 && !(qd.length >= 4 && soDig(p.telefone).indexOf(qd) >= 0)) return false;
      return true;
    });
    var n = function (s) { return todos.filter(function (p) { return p.status === s; }).length; };
    var editando = st.editando && todos.find(function (p) { return p.id === st.editando; });

    el.innerHTML =
      '<div class="kpis">' + A.kpi("Corretores parceiros", todos.length, origens.length + (origens.length === 1 ? " origem" : " origens")) +
      A.kpi("Novos", n("novo"), "ainda sem contato") + A.kpi("Em contato", n("em_contato"), "conversa iniciada") + A.kpi("Parceiros ativos", n("parceiro"), "parceria fechada") + A.kpi("Sem interesse", n("sem_interesse"), "não seguir") + "</div>" +
      '<div class="card kb-como"><p class="muted" style="margin:0">Rede de corretores para parcerias e indicações. Eles <b>não</b> têm acesso ao CRM e <b>não</b> recebem leads — para isso, o corretor se cadastra em “Sou corretor · solicitar acesso” e aparece em <b>Corretores</b>.</p></div>' +
      '<details class="card" style="padding:14px 18px"' + (LS.get("danova_parc_obj", "") ? "" : " open") + '><summary style="cursor:pointer;font-weight:700">WhatsApp com IA · objetivo das mensagens</summary>' +
      '<div class="kb-form" style="margin-top:12px"><label>Objetivo (a IA escreve cada mensagem com base nisso)<textarea data-pobj rows="2" style="min-height:60px" maxlength="400">' + A.esc(LS.get("danova_parc_obj", OBJ_PADRAO)) + "</textarea></label>" +
      '<label>Assinar como<input data-pass maxlength="80" placeholder="Ex.: Danielle Martins" value="' + A.esc(LS.get("danova_parc_ass", (A.S && A.S.me && A.S.me.nome) || "")) + '"></label>' +
      '<p class="muted" style="margin:0">Clique em <b>WhatsApp IA</b> no corretor: a IA escreve, você confere e abre no seu WhatsApp. Nada é enviado sozinho. Ao abrir, o status vira “Em contato”.</p></div></details>' +
      (st.msg ? msgHTML(A, todos.find(function (p) { return p.id === st.msg.id; }) || {}, st.msg) : "") +
      (st.novo || editando ? formHTML(A, editando) : "") +
      '<div class="filters"><input data-pq type="search" placeholder="Buscar nome, telefone, CRECI…" value="' + A.esc(st.q) + '" style="flex:1;min-width:200px">' +
      '<select data-pstatus><option value="">Todos os status</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === st.status ? " selected" : "") + ">" + STATUS[k][0] + "</option>"; }).join("") + "</select>" +
      '<select data-porigem><option value="">Todas as origens</option>' + origens.map(function (o) { return '<option' + (o === st.origem ? " selected" : "") + ">" + A.esc(o) + "</option>"; }).join("") + "</select>" +
      '<button class="btn" data-pcsv>Exportar CSV</button><button class="btn primary" data-pnovo>+ Parceiro</button></div>' +
      '<p class="muted" style="margin:6px 2px">' + lista.length + " de " + todos.length + " corretores</p>" +
      '<div class="table-wrap"><table><thead><tr><th>Corretor</th><th>WhatsApp</th><th class="hide-sm">CRECI</th><th class="hide-sm">Origem</th><th>Status</th><th></th></tr></thead><tbody>' +
      (lista.map(function (p) {
        var w = zap(p.telefone);
        return "<tr><td><strong>" + A.esc(p.nome || "(sem nome)") + "</strong>" +
          (p.imobiliaria || p.cidade ? '<span class="sub">' + A.esc([p.imobiliaria, p.cidade].filter(Boolean).join(" · ")) + "</span>" : "") +
          (p.observacoes ? '<span class="sub">' + A.esc(p.observacoes.slice(0, 120)) + "</span>" : "") +
          (p.ultimo_contato_em ? '<span class="sub">Último WhatsApp: ' + A.esc(new Date(p.ultimo_contato_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })) + "</span>" : "") + "</td>" +
          "<td>" + (w ? '<a href="' + w + '" target="_blank" rel="noopener">' + A.esc(p.telefone) + "</a>" : A.esc(p.telefone || p.email || "")) + "</td>" +
          '<td class="hide-sm">' + A.esc(p.creci || "—") + '</td><td class="hide-sm">' + A.esc(p.origem || "—") + "</td>" +
          '<td><select data-st="' + p.id + '">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === p.status ? " selected" : "") + ">" + STATUS[k][0] + "</option>"; }).join("") + "</select></td>" +
          '<td class="kb-row-acts">' + (w ? '<button class="btn small primary" data-wia="' + p.id + '" title="A IA escreve a mensagem e você envia pelo WhatsApp">WhatsApp IA</button>' : "") + '<button class="btn small ghost" data-editar="' + p.id + '">Editar</button><button class="btn small ghost" data-excluir="' + p.id + '" title="Excluir">✕</button></td></tr>';
      }).join("") || '<tr><td colspan="6"><div class="empty">' + (todos.length ? "Nenhum corretor com esses filtros." : "Nenhum corretor parceiro ainda.") + "</div></td></tr>") + "</tbody></table></div>";

    var qi = el.querySelector("[data-pq]"), t;
    qi.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { st.q = qi.value.trim(); render(el, A).then(function () { var x = el.querySelector("[data-pq]"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 250); });
    el.querySelector("[data-pstatus]").addEventListener("change", function (e) { st.status = e.target.value; render(el, A); });
    el.querySelector("[data-porigem]").addEventListener("change", function (e) { st.origem = e.target.value; render(el, A); });
    el.querySelector("[data-pcsv]").addEventListener("click", function () { csv(lista); });
    el.querySelector("[data-pnovo]").addEventListener("click", function () { st.novo = true; st.editando = null; render(el, A).then(function () { el.querySelector("[data-pform]").scrollIntoView({ behavior: "smooth", block: "start" }); }); });

    var ob = el.querySelector("[data-pobj]"), as = el.querySelector("[data-pass]");
    ob.addEventListener("change", function () { LS.set("danova_parc_obj", ob.value.trim() || OBJ_PADRAO); A.toast("Objetivo salvo."); });
    as.addEventListener("change", function () { LS.set("danova_parc_ass", as.value.trim()); });
    if (!LS.get("danova_parc_ass", "") && as.value) LS.set("danova_parc_ass", as.value);

    async function abrirMsg(p) {
      st.msg = { id: p.id, carregando: true }; st.novo = false; st.editando = null;
      await render(el, A); el.querySelector("[data-pmsg]").scrollIntoView({ behavior: "smooth", block: "start" });
      var g = await gerar(A, p);
      st.msg = { id: p.id, texto: g.texto, aviso: g.aviso }; render(el, A);
    }
    el.querySelectorAll("[data-wia]").forEach(function (b) { b.addEventListener("click", function () { abrirMsg(todos.find(function (x) { return x.id === b.dataset.wia; })); }); });
    var pm = el.querySelector("[data-pmsg]");
    if (pm && !st.msg.carregando) {
      var pp = todos.find(function (x) { return x.id === st.msg.id; }), ta = pm.querySelector("textarea");
      ta.addEventListener("input", function () { st.msg.texto = ta.value; });
      pm.querySelector("[data-mfechar]").addEventListener("click", function () { st.msg = null; render(el, A); });
      pm.querySelector("[data-mnova]").addEventListener("click", function () { abrirMsg(pp); });
      pm.querySelector("[data-mcopiar]").addEventListener("click", function () {
        (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () { A.toast("Mensagem copiada."); }, function () { ta.select(); document.execCommand("copy"); A.toast("Mensagem copiada."); });
      });
      pm.querySelector("[data-mabrir]").addEventListener("click", async function () {
        var link = zap(pp.telefone); if (!link) { A.toast("Telefone inválido para WhatsApp."); return; }
        window.open(link + "?text=" + encodeURIComponent(ta.value), "_blank", "noopener");
        var upd = { ultimo_contato_em: new Date().toISOString() }; if (pp.status === "novo") upd.status = "em_contato";
        var rr = await A.sb.from("parceiros").update(upd).eq("id", pp.id);
        if (rr.error) return A.falha(rr.error);
        A.toast(upd.status ? "WhatsApp aberto · status: Em contato." : "WhatsApp aberto.");
        st.msg = null; render(el, A);
      });
    }

    var form = el.querySelector("[data-pform]");
    if (form) {
      form.querySelector("[data-cancelar]").addEventListener("click", function () { st.novo = false; st.editando = null; render(el, A); });
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var dados = {};
        ["nome", "telefone", "email", "creci", "imobiliaria", "cidade", "origem", "status", "observacoes"].forEach(function (k) { var v = form[k].value.trim(); dados[k] = v || null; });
        dados.nome = dados.nome || ""; dados.status = dados.status || "novo";
        if (!dados.telefone && !dados.email) { A.toast("Informe WhatsApp/telefone ou e-mail."); return; }
        var res = editando ? await A.sb.from("parceiros").update(dados).eq("id", editando.id) : await A.sb.from("parceiros").insert(dados);
        if (res.error) { if (/parceiros_telefone_unico|duplicate/.test(res.error.message)) A.toast("Já existe um parceiro com esse telefone."); else A.falha(res.error); return; }
        A.toast(editando ? "Parceiro atualizado." : "Parceiro adicionado.");
        st.novo = false; st.editando = null; render(el, A);
      });
    }
    el.querySelectorAll("[data-st]").forEach(function (s) { s.addEventListener("change", async function () {
      var rr = await A.sb.from("parceiros").update({ status: s.value }).eq("id", s.dataset.st);
      if (rr.error) return A.falha(rr.error); A.toast("Status: " + STATUS[s.value][0] + "."); render(el, A);
    }); });
    el.querySelectorAll("[data-editar]").forEach(function (b) { b.addEventListener("click", function () { st.editando = b.dataset.editar; st.novo = false; render(el, A).then(function () { el.querySelector("[data-pform]").scrollIntoView({ behavior: "smooth", block: "start" }); }); }); });
    el.querySelectorAll("[data-excluir]").forEach(function (b) { b.addEventListener("click", async function () {
      var p = todos.find(function (x) { return x.id === b.dataset.excluir; });
      if (!window.confirm("Excluir " + (p.nome || "este corretor") + " dos parceiros?")) return;
      var rr = await A.sb.from("parceiros").delete().eq("id", p.id);
      if (rr.error) return A.falha(rr.error); A.toast("Parceiro excluído."); render(el, A);
    }); });
  }

  D.modulos.push({ id: "parceiros", titulo: "Parceiros", tituloLongo: "Corretores parceiros", icone: "◎", papeis: ["admin"], antes: "conta", render: render });
})();
