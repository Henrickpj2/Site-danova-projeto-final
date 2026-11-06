/* danova AI CRM — Central de E-mails: modelos editáveis, variáveis automáticas a partir do lead e do empreendimento,
   editor com links, logo e assinatura, prévia final e envio seguro pela função email-enviar (chave só no servidor).
   Também adiciona "Histórico de E-mails" na ficha de cada lead. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {}; D.modulos = D.modulos || []; D.ganchosLead = D.ganchosLead || [];
  var LOGO = "https://danova-ai.com/img/danova-logo-email.png";
  var VARS = [["nome_cliente", "Nome do cliente"], ["email_cliente", "E-mail do cliente"], ["nome_corretor", "Nome do corretor"], ["empreendimento", "Empreendimento"], ["localizacao", "Localização"], ["valor", "Valor"], ["condicoes", "Condições"], ["link_empreendimento", "Link do empreendimento"]];
  var STATUS = { pendente: ["Enviando", "st-pend"], enviado: ["Enviado", "st-ok"], entregue: ["Entregue", "st-ok"], aberto: ["Aberto", "st-top"], clicado: ["Clicado", "st-top"], atrasado: ["Atrasado", "st-pend"], rejeitado: ["Rejeitado", "st-erro"], reclamacao: ["Marcado como spam", "st-erro"], falhou: ["Falhou", "st-erro"] };
  var ERROS = {
    provedor_nao_configurado: "O envio ainda não está ativo: falta configurar a chave do provedor de e-mail (RESEND_API_KEY) no Supabase.",
    descadastrado: "Este contato pediu para não receber mais e-mails comerciais.", email_invalido: "O cliente não tem um e-mail válido cadastrado.",
    duplicado: "Este e-mail já foi enviado.", repetido: "Um e-mail com o mesmo assunto foi enviado para este cliente há menos de 10 minutos.",
    sem_acesso: "Você só pode enviar e-mails para os seus clientes.", nao_autenticado: "Sua sessão expirou. Entre de novo.", conteudo_vazio: "Preencha o assunto e o texto."
  };
  var st = { montado: false, modelos: [], emps: [], descad: {}, leadId: "", modeloId: "", empId: "", chave: "", envios: [] };

  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  function emailOk(e) { return /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(String(e || "").trim()); }
  function moedaUS(v) { if (v == null || v === "") return ""; var n = Number(v); if (!isFinite(n)) return String(v); return n >= 1e6 ? "US$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi" : "US$ " + Math.round(n / 1e3).toLocaleString("pt-BR") + " mil"; }
  async function chamar(A, corpo) {
    var r = await A.sb.functions.invoke("email-enviar", { body: corpo });
    var e = r.data && r.data.erro, det = r.data && r.data.detalhe, extra = r.data;
    try { var j = r.error && r.error.context && await r.error.context.json(); if (j) { e = j.erro || e; det = j.detalhe || det; extra = j; } } catch (x) {}
    if (r.error && !e) e = r.error.message || "falha";
    if (e) { var err = new Error(ERROS[e] || det || e); err.codigo = e; err.extra = extra; throw err; }
    return r.data;
  }
  function selo(s) { var x = STATUS[s] || [s, ""]; return '<span class="em-st ' + x[1] + '">' + x[0] + "</span>"; }

  async function carregarBase(A) {
    var r = await Promise.all([
      A.sb.from("email_templates").select("*").order("ordem"),
      A.sb.from("empreendimentos").select("id, nome, cidade, endereco, preco_a_partir, condicoes, link, ativo").order("nome"),
      A.sb.from("email_descadastros").select("email"),
      A.sb.from("email_sends").select("id, lead_id, destinatario_nome, destinatario_email, modelo, assunto, status, erro, enviado_por_nome, criado_em").order("criado_em", { ascending: false }).limit(40)
    ]);
    if (r[0].error) throw r[0].error;
    st.modelos = r[0].data || []; st.emps = (r[1].data || []); st.descad = {};
    (r[2].data || []).forEach(function (d) { st.descad[d.email] = 1; });
    st.envios = r[3].data || [];
  }

  function varsDoLead(A) {
    var l = A.S.leads.find(function (x) { return x.id === st.leadId; }) || {};
    var e = st.emps.find(function (x) { return x.id === st.empId; }) || {};
    var corretor = (A.S.membros || []).find(function (m) { return m.id === l.corretor_id; }) || A.S.me || {};
    return {
      nome_cliente: (l.nome || "").split(" ")[0] || "", email_cliente: l.email || "", nome_corretor: corretor.nome || "",
      empreendimento: e.nome || l.empreendimento || "", localizacao: [e.endereco, e.cidade].filter(Boolean).join(", "),
      valor: e.preco_a_partir ? moedaUS(e.preco_a_partir) : "sob consulta", condicoes: e.condicoes || "sob consulta", link_empreendimento: e.link || "https://danova-ai.com/#empreendimentos"
    };
  }

  function render(el, A) {
    var pend = D.emailLead; D.emailLead = null;
    if (st.montado && el.firstChild && !pend) { atualizarHistorico(el, A); return; }
    st.montado = true;
    el.innerHTML = '<div class="em-wrap"><p class="note">Carregando a Central de E-mails…</p></div>';
    carregarBase(A).then(function () { montar(el, A, pend); }).catch(function (x) {
      el.innerHTML = '<div class="em-wrap"><div class="card"><h3>Central de E-mails</h3><p class="note">Não foi possível carregar os modelos (' + A.esc(x.message || x) + "). A estrutura do banco pode ainda não ter sido criada.</p></div></div>";
      st.montado = false;
    });
  }

  function montar(el, A, pend) {
    var admin = A.isAdmin();
    var leads = A.S.leads.filter(function (l) { return l.email; }).sort(function (a, b) { return (a.nome || "").localeCompare(b.nome || ""); });
    if (pend) st.leadId = pend;
    if (!st.modeloId) { var m0 = st.modelos.find(function (m) { return m.ativo; }); st.modeloId = m0 ? m0.id : ""; }
    el.innerHTML =
      '<div class="em-wrap">' +
      '<section class="card em-modelos"><div class="em-h"><h3>Modelos</h3><span class="note">' + (admin ? "Clique para usar · admin pode editar e ativar/desativar" : "Clique para usar") + '</span></div><div class="em-mlist">' +
      st.modelos.map(function (m) {
        return '<button type="button" class="em-mcard' + (m.id === st.modeloId ? " sel" : "") + (m.ativo ? "" : " off") + '" data-m="' + m.id + '"' + (!m.ativo && !admin ? " disabled" : "") + '><small>' + A.esc(m.publico || "") + '</small><b>' + A.esc(m.nome) + '</b><span>' + A.esc(m.objetivo || "") + "</span>" +
          (admin ? '<label class="em-tog" data-tog="' + m.id + '"><input type="checkbox"' + (m.ativo ? " checked" : "") + "> ativo</label>" : "") + "</button>";
      }).join("") + "</div></section>" +

      '<section class="card em-comp"><div class="em-h"><h3>Escrever e-mail</h3></div>' +
      '<div class="em-grid">' +
      '<label>Cliente<select data-lead><option value="">Selecione um cliente com e-mail</option>' + leads.map(function (l) {
        var bloq = st.descad[(l.email || "").toLowerCase()];
        return '<option value="' + l.id + '"' + (l.id === st.leadId ? " selected" : "") + ">" + A.esc((l.nome || "Sem nome") + " · " + l.email + (bloq ? " · descadastrado" : "")) + "</option>";
      }).join("") + "</select></label>" +
      '<label>Empreendimento<select data-emp><option value="">—</option>' + st.emps.map(function (e) { return '<option value="' + e.id + '">' + A.esc(e.nome) + "</option>"; }).join("") + "</select></label>" +
      "</div>" +
      '<div class="em-aviso" data-aviso hidden></div>' +
      '<details class="em-vars" open><summary>Dados do e-mail (preenchidos automaticamente · edite se precisar)</summary><div class="em-grid">' +
      VARS.map(function (v) { return '<label>' + v[1] + ' <code>{{' + v[0] + '}}</code><input data-var="' + v[0] + '"' + (v[0] === "email_cliente" ? " readonly" : "") + "></label>"; }).join("") + "</div></details>" +
      '<label class="em-full">Assunto<input data-assunto maxlength="200"></label>' +
      '<div class="em-tool" role="toolbar" aria-label="Formatação">' +
      '<button type="button" data-cmd="bold" title="Negrito"><b>B</b></button><button type="button" data-cmd="italic" title="Itálico"><i>I</i></button><button type="button" data-cmd="underline" title="Sublinhado"><u>S</u></button>' +
      '<button type="button" data-cmd="insertUnorderedList" title="Lista">• Lista</button><button type="button" data-link title="Inserir link">🔗 Link</button>' +
      '<button type="button" data-logo title="Inserir logotipo">Logo</button><button type="button" data-assin title="Inserir assinatura">Assinatura</button>' +
      '<select data-ins aria-label="Inserir variável"><option value="">+ Variável</option>' + VARS.map(function (v) { return '<option value="' + v[0] + '">' + v[1] + "</option>"; }).join("") + "</select>" +
      "</div>" +
      '<div class="em-editor" contenteditable="true" data-editor aria-label="Texto do e-mail"></div>' +
      '<p class="note">A logo no topo, a assinatura do corretor responsável e o link de descadastro entram automaticamente no envio.</p>' +
      '<div class="em-acts"><button class="btn ghost" data-previa>Visualizar versão final</button><button class="btn primary" data-enviar>Enviar e-mail</button>' +
      (admin ? '<button class="btn ghost" data-salvar-modelo title="Atualiza o modelo com o assunto e o texto atuais">Salvar como modelo</button>' : "") + "</div>" +
      "</section>" +

      '<section class="card em-hist"><div class="em-h"><h3>Últimos envios</h3><button class="btn small ghost" data-recarregar>Atualizar</button></div><div data-hist></div></section>' +
      '<div class="em-modal" data-modal hidden><div class="em-modal-box" role="dialog" aria-modal="true" aria-label="Prévia do e-mail"><div class="em-modal-top"><div><small>Prévia</small><b data-pv-assunto></b></div><button class="icon-btn" data-fechar aria-label="Fechar">✕</button></div><iframe data-pv sandbox title="Prévia do e-mail"></iframe><div class="em-acts"><button class="btn ghost" data-fechar>Voltar e editar</button><button class="btn primary" data-enviar>Enviar agora</button></div></div></div>' +
      "</div>";

    var $ = function (s) { return el.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(el.querySelectorAll(s)); };
    var editor = $("[data-editor]"), assunto = $("[data-assunto]");

    function aplicarModelo() {
      var m = st.modelos.find(function (x) { return x.id === st.modeloId; });
      if (!m) return; assunto.value = m.assunto; editor.innerHTML = m.corpo_html; st.chave = uuid();
      $$("[data-m]").forEach(function (b) { b.classList.toggle("sel", b.dataset.m === st.modeloId); });
    }
    function preencher() {
      var l = A.S.leads.find(function (x) { return x.id === st.leadId; });
      if (l && !st.empId && l.empreendimento_id) st.empId = l.empreendimento_id;
      if (l && !st.empId && l.empreendimento) { var e = st.emps.find(function (x) { return x.nome === l.empreendimento; }); if (e) st.empId = e.id; }
      $("[data-emp]").value = st.empId || "";
      var v = varsDoLead(A);
      $$("[data-var]").forEach(function (i) { i.value = v[i.dataset.var] || ""; });
      var av = $("[data-aviso]"), bloq = l && st.descad[(l.email || "").toLowerCase()];
      av.hidden = !(l && (bloq || !emailOk(l.email)));
      av.textContent = bloq ? "Este contato pediu para não receber e-mails comerciais. O envio está bloqueado." : (l ? "O e-mail deste cliente parece inválido. Corrija na ficha do lead." : "");
      st.chave = uuid();
    }
    function coletar() {
      var vars = {}; $$("[data-var]").forEach(function (i) { vars[i.dataset.var] = i.value.trim(); });
      return { lead_id: st.leadId, template_id: st.modeloId || null, assunto: assunto.value, corpo_html: editor.innerHTML, vars: vars };
    }
    function validar() {
      if (!st.leadId) { A.toast("Selecione o cliente.", true); return false; }
      var l = A.S.leads.find(function (x) { return x.id === st.leadId; });
      if (!l || !emailOk(l.email)) { A.toast(ERROS.email_invalido, true); return false; }
      if (st.descad[l.email.toLowerCase()]) { A.toast(ERROS.descadastrado, true); return false; }
      if (!assunto.value.trim() || !editor.textContent.trim()) { A.toast(ERROS.conteudo_vazio, true); return false; }
      return true;
    }
    async function previa() {
      if (!validar()) return;
      var b = $("[data-previa]"); b.disabled = true;
      try {
        var d = await chamar(A, Object.assign({ acao: "previa" }, coletar()));
        $("[data-pv-assunto]").textContent = d.assunto; $("[data-pv]").srcdoc = d.html; $("[data-modal]").hidden = false;
      } catch (x) { A.toast(x.message, true); } finally { b.disabled = false; }
    }
    async function enviar(btn) {
      if (!validar()) return;
      var l = A.S.leads.find(function (x) { return x.id === st.leadId; });
      if (!confirm("Enviar este e-mail para " + l.nome + " <" + l.email + ">?")) return;
      $$("[data-enviar]").forEach(function (b) { b.disabled = true; b.textContent = "Enviando…"; });
      try {
        await chamar(A, Object.assign({ acao: "enviar", chave: st.chave }, coletar()));
        A.toast("E-mail enviado para " + l.email + ".");
        $("[data-modal]").hidden = true; st.chave = uuid();
      } catch (x) {
        A.toast(x.message, true);
        if (x.codigo !== "repetido") st.chave = uuid();
      } finally {
        $$("[data-enviar]").forEach(function (b) { b.disabled = false; b.textContent = b.closest("[data-modal]") ? "Enviar agora" : "Enviar e-mail"; });
        await recarregarHistorico(el, A);
      }
    }

    $$("[data-m]").forEach(function (b) { b.addEventListener("click", function (e) { if (e.target.closest("[data-tog]")) return; st.modeloId = b.dataset.m; aplicarModelo(); }); });
    $$("[data-tog] input").forEach(function (i) {
      i.addEventListener("click", function (e) { e.stopPropagation(); });
      i.addEventListener("change", async function () {
        var id = i.closest("[data-tog]").dataset.tog;
        var r = await A.sb.from("email_templates").update({ ativo: i.checked, atualizado_em: new Date().toISOString(), atualizado_por: A.S.me.id }).eq("id", id);
        if (r.error) { i.checked = !i.checked; return A.falha(r.error); }
        var m = st.modelos.find(function (x) { return x.id === id; }); if (m) m.ativo = i.checked;
        i.closest("[data-m]").classList.toggle("off", !i.checked); A.toast(i.checked ? "Modelo ativado." : "Modelo desativado.");
      });
    });
    $("[data-lead]").addEventListener("change", function (e) { st.leadId = e.target.value; st.empId = ""; preencher(); });
    $("[data-emp]").addEventListener("change", function (e) { st.empId = e.target.value; var v = varsDoLead(A); ["empreendimento", "localizacao", "valor", "condicoes", "link_empreendimento"].forEach(function (k) { var i = el.querySelector('[data-var="' + k + '"]'); if (i) i.value = v[k]; }); });
    $$("[data-cmd]").forEach(function (b) { b.addEventListener("click", function () { editor.focus(); document.execCommand(b.dataset.cmd, false, null); }); });
    $("[data-link]").addEventListener("click", function () {
      var url = prompt("Endereço do link (https://…)", "https://"); if (!url) return;
      if (!/^(https?:\/\/|mailto:)/i.test(url)) return A.toast("Use um link que comece com https:// ou mailto:", true);
      editor.focus(); var sel = window.getSelection();
      if (sel && sel.toString()) document.execCommand("createLink", false, url); else document.execCommand("insertHTML", false, '<a href="' + A.esc(url) + '">' + A.esc(url) + "</a>");
    });
    $("[data-logo]").addEventListener("click", function () { editor.focus(); document.execCommand("insertHTML", false, '<p><img src="' + LOGO + '" alt="DANOVA-AI"></p>'); });
    $("[data-assin]").addEventListener("click", function () { editor.focus(); document.execCommand("insertHTML", false, "<p>Um abraço,<br>{{nome_corretor}}<br>DANOVA-AI · Real Estate Intelligence</p>"); });
    $("[data-ins]").addEventListener("change", function (e) { if (!e.target.value) return; editor.focus(); document.execCommand("insertText", false, "{{" + e.target.value + "}}"); e.target.value = ""; });
    editor.addEventListener("paste", function (e) { e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
    $("[data-previa]").addEventListener("click", previa);
    $$("[data-enviar]").forEach(function (b) { b.addEventListener("click", function () { enviar(b); }); });
    $$("[data-fechar]").forEach(function (b) { b.addEventListener("click", function () { $("[data-modal]").hidden = true; }); });
    $("[data-recarregar]").addEventListener("click", function () { recarregarHistorico(el, A); });
    var sm = $("[data-salvar-modelo]");
    if (sm) sm.addEventListener("click", async function () {
      var m = st.modelos.find(function (x) { return x.id === st.modeloId; }); if (!m) return A.toast("Escolha um modelo primeiro.", true);
      if (!confirm("Atualizar o “" + m.nome + "” com o assunto e o texto atuais?")) return;
      var r = await A.sb.from("email_templates").update({ assunto: assunto.value, corpo_html: editor.innerHTML, atualizado_em: new Date().toISOString(), atualizado_por: A.S.me.id }).eq("id", m.id);
      if (r.error) return A.falha(r.error);
      m.assunto = assunto.value; m.corpo_html = editor.innerHTML; A.toast("Modelo atualizado.");
    });

    aplicarModelo(); preencher(); desenharHistorico(el, A);
  }

  function desenharHistorico(el, A) {
    var box = el.querySelector("[data-hist]"); if (!box) return;
    box.innerHTML = st.envios.length ? '<div class="em-tab">' + st.envios.map(function (s) {
      return '<div class="em-row"><div><b>' + A.esc(s.destinatario_nome || s.destinatario_email) + "</b><small>" + A.esc(s.destinatario_email) + "</small></div><div><span>" + A.esc(s.assunto) + "</span><small>" + A.esc(s.modelo || "") + " · " + A.esc(s.enviado_por_nome || "") + "</small></div><div>" + selo(s.status) + "<small>" + A.dt(s.criado_em, true) + "</small>" + (s.erro ? '<small class="em-err">' + A.esc(s.erro) + "</small>" : "") + "</div></div>";
    }).join("") + "</div>" : '<p class="note">Nenhum e-mail enviado ainda.</p>';
  }
  async function recarregarHistorico(el, A) {
    var r = await A.sb.from("email_sends").select("id, lead_id, destinatario_nome, destinatario_email, modelo, assunto, status, erro, enviado_por_nome, criado_em").order("criado_em", { ascending: false }).limit(40);
    if (!r.error) { st.envios = r.data || []; desenharHistorico(el, A); }
  }
  function atualizarHistorico(el, A) { recarregarHistorico(el, A); }

  // ---------- ficha do lead: Histórico de E-mails ----------
  D.ganchosLead.push(function (box, lead, A) {
    var sec = document.createElement("div");
    sec.innerHTML = '<div class="section-title">Histórico de E-mails</div><div class="em-lead"><p class="note">Carregando…</p></div>';
    box.appendChild(sec);
    var alvo = sec.querySelector(".em-lead");
    A.sb.from("email_sends").select("id, assunto, modelo, status, erro, enviado_por_nome, criado_em").eq("lead_id", lead.id).order("criado_em", { ascending: false }).limit(30).then(function (r) {
      var lista = r.data || [];
      alvo.innerHTML = (lista.length ? lista.map(function (s) {
        return '<div class="em-lrow"><div><b>' + A.esc(s.assunto) + "</b><small>" + A.esc(s.modelo || "") + " · " + A.esc(s.enviado_por_nome || "") + " · " + A.dt(s.criado_em, true) + "</small>" + (s.erro ? '<small class="em-err">' + A.esc(s.erro) + "</small>" : "") + "</div>" + selo(s.status) + "</div>";
      }).join("") : '<p class="note">Nenhum e-mail enviado para este cliente.</p>') +
        (lead.email ? '<button type="button" class="btn small ghost" data-escrever>✉ Escrever e-mail</button>' : '<p class="note">Cadastre um e-mail para poder enviar.</p>');
      var b = alvo.querySelector("[data-escrever]");
      if (b) b.addEventListener("click", function () { D.emailLead = lead.id; var f = document.querySelector("[data-close]"); if (f) f.click(); A.irPara("emails"); });
    });
  });

  D.modulos.push({ id: "emails", titulo: "Central de E-mails", tituloLongo: "Central de E-mails", icone: "✉", papeis: ["admin", "corretor"], render: render });
})();
