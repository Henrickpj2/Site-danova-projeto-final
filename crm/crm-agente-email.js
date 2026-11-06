/* danova AI CRM — Agente de E-mails: a IA escreve follow-ups, boas-vindas, contatos na data marcada e campanhas;
   nada sai sem aprovação. Aprovados ficam agendados e saem pelo e-mail da Hostinger no horário. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {}; D.modulos = D.modulos || [];
  var ORIGEM = { ia_followup: ["Follow-up", "ag-o1"], ia_boasvindas: ["Boas-vindas", "ag-o2"], ia_data: ["Data marcada", "ag-o3"], campanha: ["Campanha", "ag-o4"], agendado: ["Agendado à mão", "ag-o5"] };
  var ERR = { ia_nao_configurada: "A IA não está configurada no servidor (ANTHROPIC_API_KEY).", sem_acesso: "Sem permissão para esta ação.", conteudo_vazio: "Preencha assunto e texto.", data_invalida: "Data ou horário inválido.", sem_leads: "Nenhum lead com e-mail válido nesse filtro.", dados_invalidos: "Preencha o nome e a data da campanha.", nao_autenticado: "Sua sessão expirou. Entre de novo." };
  var st = { aba: "aprovar", lista: [], regras: [], modelos: [] };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function paraInput(iso) { if (!iso) return ""; var d = new Date(iso); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function deInput(v) { return v ? new Date(v).toISOString() : null; }
  function quando(iso) { if (!iso) return "—"; var d = new Date(iso); return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) + " às " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  async function agente(A, corpo) {
    var r = await A.sb.functions.invoke("email-agente", { body: corpo });
    var e = r.data && r.data.erro;
    try { var j = r.error && r.error.context && await r.error.context.json(); if (j && j.erro) e = j.erro; } catch (x) {}
    if (r.error && !e) e = r.error.message || "falha";
    if (e) throw new Error(ERR[e] || e);
    return r.data;
  }
  D.agenteEmail = agente;

  async function carregar(A) {
    var r = await Promise.all([
      A.sb.from("email_sends").select("id, lead_id, destinatario_nome, destinatario_email, modelo, origem, assunto, corpo_texto, motivo_ia, status, agendado_para, campanha_id, erro, aprovado_em").in("status", ["rascunho", "agendado"]).order("agendado_para", { ascending: true }).limit(300),
      A.sb.from("email_automacoes").select("*"),
      A.sb.from("email_templates").select("id, nome, codigo, assunto, corpo_html, ativo").order("ordem")
    ]);
    if (r[0].error) throw r[0].error;
    st.lista = r[0].data || []; st.regras = r[1].data || []; st.modelos = (r[2].data || []).filter(function (m) { return m.ativo; });
  }

  function render(el, A) {
    el.innerHTML = '<div class="ag"><p class="note">Carregando o Agente de E-mails…</p></div>';
    carregar(A).then(function () { montar(el, A); }).catch(function (x) { el.innerHTML = '<div class="ag"><div class="card"><p class="note">Não foi possível carregar (' + A.esc(x.message || x) + ").</p></div></div>"; });
  }

  function montar(el, A) {
    var admin = A.isAdmin();
    var rasc = st.lista.filter(function (e) { return e.status === "rascunho"; }), agen = st.lista.filter(function (e) { return e.status === "agendado"; });
    var ativas = st.regras.filter(function (r) { return r.ativo; }).length;
    var abas = [["aprovar", "Para aprovar", rasc.length], ["agendados", "Agendados", agen.length]].concat(admin ? [["regras", "Regras", ativas + "/3"], ["campanha", "Nova campanha", ""]] : []);
    el.innerHTML = '<div class="ag">' +
      '<div class="card ag-topo"><div><h3>Agente de E-mails</h3><p class="note">A IA escreve os e-mails a partir dos dados de cada lead. <b>Nada é enviado sem aprovação</b>: aprovados saem de danova-ai@danova-ai.com no horário marcado.</p></div>' +
      (admin ? '<button class="btn ghost" data-rodar>✦ Rodar agente agora</button>' : "") + "</div>" +
      '<div class="ag-abas" role="tablist">' + abas.map(function (a) { return '<button role="tab" data-aba="' + a[0] + '" class="' + (st.aba === a[0] ? "sel" : "") + '">' + a[1] + (a[2] !== "" ? " <span>" + a[2] + "</span>" : "") + "</button>"; }).join("") + "</div>" +
      '<div data-corpo></div></div>';
    el.querySelectorAll("[data-aba]").forEach(function (b) { b.addEventListener("click", function () { st.aba = b.dataset.aba; montar(el, A); }); });
    var rodar = el.querySelector("[data-rodar]");
    if (rodar) rodar.addEventListener("click", async function () {
      if (!st.regras.some(function (r) { return r.ativo; })) { st.aba = "regras"; montar(el, A); return A.toast("Ative pelo menos uma regra primeiro.", true); }
      rodar.disabled = true; rodar.textContent = "A IA está escrevendo…";
      try { var d = await agente(A, { acao: "planejar_agora" }); A.toast(d.criados ? d.criados + " rascunho(s) criado(s) para aprovação." : "Nenhum lead se encaixa nas regras agora." + (d.erros && d.erros.length ? " (" + d.erros.join(", ") + ")" : "")); st.aba = "aprovar"; render(el, A); }
      catch (x) { A.toast(x.message, true); rodar.disabled = false; rodar.textContent = "✦ Rodar agente agora"; }
    });
    var c = el.querySelector("[data-corpo]");
    if (st.aba === "aprovar") abaAprovar(c, A, rasc, el);
    else if (st.aba === "agendados") abaAgendados(c, A, agen, el);
    else if (st.aba === "regras") abaRegras(c, A, el);
    else abaCampanha(c, A, el);
  }

  function pill(o) { var x = ORIGEM[o] || [o, ""]; return '<span class="ag-pill ' + x[1] + '">' + x[0] + "</span>"; }

  function abaAprovar(c, A, rasc, el) {
    if (!rasc.length) { c.innerHTML = '<div class="card ag-vazio"><b>Nada para aprovar agora.</b><p class="note">Quando o agente escrever um e-mail, ele aparece aqui para você revisar, editar e aprovar.</p></div>'; return; }
    c.innerHTML = '<div class="ag-barra"><label><input type="checkbox" data-todos> Selecionar todos</label><button class="btn primary small" data-aprovar-sel disabled>Aprovar selecionados</button><button class="btn ghost small" data-descartar-sel disabled>Descartar selecionados</button></div>' +
      rasc.map(function (e) {
        var prep = !e.corpo_texto;
        return '<article class="card ag-item" data-id="' + e.id + '"><header><label class="ag-chk"><input type="checkbox" data-sel' + (prep ? " disabled" : "") + '></label><div><b>' + A.esc(e.destinatario_nome || "") + "</b><small>" + A.esc(e.destinatario_email) + "</small></div>" + pill(e.origem) + "</header>" +
          (e.motivo_ia ? '<p class="ag-motivo">✦ ' + A.esc(e.motivo_ia) + "</p>" : "") +
          (prep ? '<p class="note">A IA ainda está escrevendo este e-mail. Ele fica pronto em alguns minutos.</p>' :
          '<label>Assunto<input data-assunto value="' + A.esc(e.assunto) + '" maxlength="200"></label><label>Mensagem<textarea data-texto rows="8">' + A.esc(e.corpo_texto) + "</textarea></label>") +
          '<footer><label class="ag-q">Enviar em<input type="datetime-local" data-quando value="' + paraInput(e.agendado_para) + '"></label>' +
          '<button class="btn ghost small" data-lead>Ver lead</button>' + (prep ? "" : '<button class="btn ghost small" data-salvar>Salvar</button>') + '<button class="btn ghost small" data-descartar>Descartar</button>' + (prep ? "" : '<button class="btn primary small" data-aprovar>Aprovar</button>') + "</footer></article>";
      }).join("");
    var sel = function () { return Array.prototype.slice.call(c.querySelectorAll("[data-sel]:checked")).map(function (i) { return i.closest("[data-id]").dataset.id; }); };
    var atualizar = function () { var n = sel().length; c.querySelector("[data-aprovar-sel]").disabled = !n; c.querySelector("[data-descartar-sel]").disabled = !n; c.querySelector("[data-aprovar-sel]").textContent = n ? "Aprovar " + n + " selecionado(s)" : "Aprovar selecionados"; };
    c.querySelectorAll("[data-sel]").forEach(function (i) { i.addEventListener("change", atualizar); });
    c.querySelector("[data-todos]").addEventListener("change", function (ev) { c.querySelectorAll("[data-sel]:not(:disabled)").forEach(function (i) { i.checked = ev.target.checked; }); atualizar(); });
    async function salvar(card) {
      var a = card.querySelector("[data-assunto]"), t = card.querySelector("[data-texto]"); if (!a) return;
      await agente(A, { acao: "salvar", id: card.dataset.id, assunto: a.value, texto: t.value, agendado_para: deInput(card.querySelector("[data-quando]").value) });
    }
    c.querySelectorAll("[data-id]").forEach(function (card) {
      var id = card.dataset.id, e = st.lista.find(function (x) { return x.id === id; });
      var b = function (s) { return card.querySelector(s); };
      b("[data-lead]").addEventListener("click", function () { A.abrirLead(e.lead_id); });
      if (b("[data-salvar]")) b("[data-salvar]").addEventListener("click", async function () { try { await salvar(card); A.toast("Alterações salvas."); } catch (x) { A.toast(x.message, true); } });
      b("[data-descartar]").addEventListener("click", async function () { try { await agente(A, { acao: "descartar", ids: [id] }); card.remove(); A.toast("Rascunho descartado."); render(el, A); } catch (x) { A.toast(x.message, true); } });
      if (b("[data-aprovar]")) b("[data-aprovar]").addEventListener("click", async function () {
        var btn = this; btn.disabled = true;
        try { await salvar(card); var q = deInput(b("[data-quando]").value); await agente(A, { acao: "aprovar", ids: [id], agendado_para: q }); A.toast("Aprovado. Sai " + (q && Date.parse(q) > Date.now() + 60e3 ? quando(q) : "nos próximos 5 minutos") + "."); render(el, A); }
        catch (x) { A.toast(x.message, true); btn.disabled = false; }
      });
    });
    c.querySelector("[data-aprovar-sel]").addEventListener("click", async function () {
      var ids = sel(); if (!ids.length || !confirm("Aprovar " + ids.length + " e-mail(s)? Cada um sai no horário marcado no cartão.")) return;
      try { var d = await agente(A, { acao: "aprovar", ids: ids }); A.toast(d.aprovados + " e-mail(s) aprovado(s)."); render(el, A); } catch (x) { A.toast(x.message, true); }
    });
    c.querySelector("[data-descartar-sel]").addEventListener("click", async function () {
      var ids = sel(); if (!ids.length || !confirm("Descartar " + ids.length + " rascunho(s)?")) return;
      try { await agente(A, { acao: "descartar", ids: ids }); A.toast("Descartado(s)."); render(el, A); } catch (x) { A.toast(x.message, true); }
    });
  }

  function abaAgendados(c, A, agen, el) {
    if (!agen.length) { c.innerHTML = '<div class="card ag-vazio"><b>Nenhum e-mail agendado.</b><p class="note">Os e-mails aprovados aparecem aqui até a hora do envio.</p></div>'; return; }
    c.innerHTML = '<div class="card"><div class="ag-tab">' + agen.map(function (e) {
      return '<div class="ag-row" data-id="' + e.id + '"><div><b>' + quando(e.agendado_para) + "</b>" + pill(e.origem) + '</div><div><span>' + A.esc(e.assunto) + "</span><small>" + A.esc(e.destinatario_nome || "") + " · " + A.esc(e.destinatario_email) + "</small>" + (e.erro ? '<small class="em-err">' + A.esc(e.erro) + "</small>" : "") + '</div><button class="btn ghost small" data-cancelar>Cancelar</button></div>';
    }).join("") + "</div></div>";
    c.querySelectorAll("[data-cancelar]").forEach(function (b) { b.addEventListener("click", async function () {
      var id = b.closest("[data-id]").dataset.id; if (!confirm("Cancelar este envio?")) return;
      try { await agente(A, { acao: "cancelar", ids: [id] }); A.toast("Envio cancelado."); render(el, A); } catch (x) { A.toast(x.message, true); }
    }); });
  }

  function abaRegras(c, A, el) {
    var r = {}; st.regras.forEach(function (x) { r[x.tipo] = x; });
    var hora = function (t, v) { return '<label>Horário do envio<select data-hora="' + t + '">' + [7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18].map(function (h) { return '<option value="' + h + '"' + (Number(v) === h ? " selected" : "") + ">" + h + ":00</option>"; }).join("") + "</select></label>"; };
    var tog = function (t) { return '<label class="ag-tog"><input type="checkbox" data-ativo="' + t + '"' + (r[t] && r[t].ativo ? " checked" : "") + "> <span>" + (r[t] && r[t].ativo ? "Ligada" : "Desligada") + "</span></label>"; };
    var f = (r.followup || {}).config || {}, bv = (r.boasvindas || {}).config || {}, dt = (r.data || {}).config || {};
    var passos = bv.passos || [1, 4, 9];
    c.innerHTML = '<div class="ag-regras">' +
      '<section class="card" data-regra="followup"><header><h4>Follow-up sem resposta</h4>' + tog("followup") + '</header><p class="note">Lead parado na mesma etapa recebe um e-mail de retomada escrito pela IA.</p>' +
      '<label>Dias sem novidade<input type="number" min="1" max="60" data-dias value="' + (f.dias || 5) + '"></label>' +
      '<div class="ag-etapas">' + A.ETAPAS.filter(function (e) { return ["fechado", "perdido"].indexOf(e.id) < 0; }).map(function (e) { return '<label><input type="checkbox" data-etapa value="' + e.id + '"' + ((f.etapas || []).indexOf(e.id) >= 0 ? " checked" : "") + "> " + e.nome + "</label>"; }).join("") + "</div>" + hora("followup", f.hora || 10) + "</section>" +
      '<section class="card" data-regra="boasvindas"><header><h4>Sequência de boas-vindas</h4>' + tog("boasvindas") + '</header><p class="note">Leads novos do site, anúncios e chat recebem 3 e-mails: apresentação, conteúdo útil e convite para conversa. Leads importados de planilha ficam de fora.</p>' +
      '<div class="ag-passos">' + [0, 1, 2].map(function (i) { return '<label>' + (i + 1) + 'º e-mail no dia<input type="number" min="0" max="60" data-passo value="' + (passos[i] != null ? passos[i] : [1, 4, 9][i]) + '"></label>'; }).join("") + "</div>" + hora("boasvindas", bv.hora || 10) + "</section>" +
      '<section class="card" data-regra="data"><header><h4>Data marcada no lead</h4>' + tog("data") + '</header><p class="note">No dia do “próximo contato” registrado no lead, a IA prepara o e-mail que cumpre o “próximo passo”.</p>' + hora("data", dt.hora || 9) + "</section>" +
      '</div><div class="ag-acts"><button class="btn primary" data-salvar-regras>Salvar regras</button></div>';
    c.querySelectorAll("[data-ativo]").forEach(function (i) { i.addEventListener("change", function () { i.nextElementSibling.textContent = i.checked ? "Ligada" : "Desligada"; }); });
    c.querySelector("[data-salvar-regras]").addEventListener("click", async function () {
      var g = function (t, s) { return c.querySelector('[data-regra="' + t + '"] ' + s); };
      var dados = {
        followup: { dias: Math.max(1, Number(g("followup", "[data-dias]").value) || 5), etapas: Array.prototype.slice.call(c.querySelectorAll("[data-etapa]:checked")).map(function (i) { return i.value; }), hora: Number(g("followup", "[data-hora]").value) },
        boasvindas: { passos: Array.prototype.slice.call(c.querySelectorAll("[data-passo]")).map(function (i) { return Math.max(0, Number(i.value) || 0); }).sort(function (a, b) { return a - b; }), hora: Number(g("boasvindas", "[data-hora]").value) },
        data: { hora: Number(g("data", "[data-hora]").value) }
      };
      if (!dados.followup.etapas.length) return A.toast("Escolha pelo menos uma etapa para o follow-up.", true);
      try {
        for (var t in dados) {
          var res = await A.sb.from("email_automacoes").update({ ativo: g(t, "[data-ativo]").checked, config: dados[t], atualizado_em: new Date().toISOString(), atualizado_por: A.S.me.id }).eq("tipo", t);
          if (res.error) throw res.error;
        }
        A.toast("Regras salvas. O agente verifica os leads a cada hora."); render(el, A);
      } catch (x) { A.falha(x); }
    });
  }

  function abaCampanha(c, A, el) {
    var amanha = new Date(Date.now() + 864e5); amanha.setHours(10, 0, 0, 0);
    c.innerHTML = '<div class="card ag-camp">' +
      '<label class="full">Nome da campanha<input data-nome placeholder="Ex.: Lançamento Faena · interessados em Brickell" maxlength="120"></label>' +
      '<div class="ag-sub">Quem recebe</div><div class="ag-etapas">' + A.ETAPAS.filter(function (e) { return ["fechado", "perdido"].indexOf(e.id) < 0; }).map(function (e) { return '<label><input type="checkbox" data-fetapa value="' + e.id + '"> ' + e.nome + "</label>"; }).join("") + "</div>" +
      '<div class="ag-grid"><label>Empreendimento<select data-femp><option value="">Todos</option>' + A.EMPREENDIMENTOS.map(function (n) { return "<option>" + A.esc(n) + "</option>"; }).join("") + "</select></label>" +
      '<label>Temperatura<select data-ftemp><option value="">Todas</option><option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option></select></label>' +
      '<label>Perfil<select data-fperfil><option value="">Todos</option>' + ["Investidor ou comprador", "Corretor de imóveis", "Imobiliária", "Construtora ou incorporadora", "Family office", "Outro"].map(function (p) { return "<option>" + p + "</option>"; }).join("") + "</select></label>" +
      '<label>Origem<select data-fcanal><option value="">Todas</option><option value="importacao">Planilha importada</option><option value="manual">Cadastro manual</option></select></label></div>' +
      '<p class="note" data-contagem>Nenhum filtro marcado = todos os leads abertos com e-mail.</p><button class="btn ghost small" data-contar>Ver quantos leads</button>' +
      '<div class="ag-sub">Conteúdo</div><div class="ag-modo"><label><input type="radio" name="agmodo" value="modelo" checked> Mesmo texto para todos (modelo)</label><label><input type="radio" name="agmodo" value="ia"> A IA personaliza para cada lead</label></div>' +
      '<div data-bloco-modelo><label>Modelo<select data-modelo><option value="">Em branco</option>' + st.modelos.map(function (m) { return '<option value="' + m.id + '">' + A.esc(m.nome) + "</option>"; }).join("") + "</select></label>" +
      '<label>Assunto<input data-assunto maxlength="200"></label><label>Mensagem<textarea data-texto rows="9" placeholder="Use {{nome_cliente}}, {{empreendimento}}, {{valor}}… para personalizar."></textarea></label></div>' +
      '<div data-bloco-ia hidden><label>O que a IA deve comunicar<textarea data-instr rows="4" placeholder="Ex.: convidar para o evento de lançamento do Faena em 20/11, com vagas limitadas; tom exclusivo."></textarea></label><p class="note">A IA escreve um e-mail diferente para cada lead (até 60 por campanha). Os textos ficam prontos em alguns minutos.</p></div>' +
      '<label class="ag-q">Enviar em<input type="datetime-local" data-quando value="' + paraInput(amanha.toISOString()) + '"></label>' +
      '<p class="note">Os e-mails vão primeiro para <b>Para aprovar</b>. Nada sai sem a sua aprovação.</p>' +
      '<div class="ag-acts"><button class="btn primary" data-criar>Criar rascunhos</button></div></div>';
    var q = function (s) { return c.querySelector(s); };
    function filtro() {
      return { etapas: Array.prototype.slice.call(c.querySelectorAll("[data-fetapa]:checked")).map(function (i) { return i.value; }), empreendimento: q("[data-femp]").value || null, temperatura: q("[data-ftemp]").value || null, perfil: q("[data-fperfil]").value || null, canal: q("[data-fcanal]").value || null };
    }
    function modo() { return c.querySelector("[name=agmodo]:checked").value; }
    c.querySelectorAll("[name=agmodo]").forEach(function (r) { r.addEventListener("change", function () { q("[data-bloco-modelo]").hidden = modo() !== "modelo"; q("[data-bloco-ia]").hidden = modo() !== "ia"; }); });
    q("[data-modelo]").addEventListener("change", function (e) {
      var m = st.modelos.find(function (x) { return x.id === e.target.value; }); if (!m) return;
      var d = document.createElement("div"); d.innerHTML = m.corpo_html.replace(/<li[^>]*>/gi, "\n• ").replace(/<\/(p|ul|ol)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<a [^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi, "$1");
      q("[data-assunto]").value = m.assunto; q("[data-texto]").value = (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    });
    function corpo(simular) { return { acao: "campanha", simular: simular, nome: q("[data-nome]").value || "simulação", filtro: filtro(), modo: modo(), template_id: q("[data-modelo]").value || null, assunto: q("[data-assunto]").value, texto: q("[data-texto]").value, instrucoes: q("[data-instr]").value, agendado_para: deInput(q("[data-quando]").value) }; }
    q("[data-contar]").addEventListener("click", async function () {
      try { var d = await agente(A, corpo(true)); q("[data-contagem]").textContent = d.total + " lead(s) recebem" + (d.exemplos && d.exemplos.length ? " — ex.: " + d.exemplos.join(", ") : "") + (modo() === "ia" && d.total > 60 ? " (a IA personaliza os 60 primeiros)" : ""); } catch (x) { A.toast(x.message, true); }
    });
    q("[data-criar]").addEventListener("click", async function () {
      if (!q("[data-nome]").value.trim()) return A.toast("Dê um nome para a campanha.", true);
      if (modo() === "modelo" && (!q("[data-assunto]").value.trim() || !q("[data-texto]").value.trim())) return A.toast("Preencha assunto e mensagem.", true);
      if (modo() === "ia" && !q("[data-instr]").value.trim()) return A.toast("Diga o que a IA deve comunicar.", true);
      var b = this; b.disabled = true; b.textContent = "Criando…";
      try { var d = await agente(A, corpo(false)); A.toast(d.total + " rascunho(s) criado(s). Revise e aprove em “Para aprovar”."); st.aba = "aprovar"; render(el, A); }
      catch (x) { A.toast(x.message, true); b.disabled = false; b.textContent = "Criar rascunhos"; }
    });
  }

  D.modulos.push({ id: "agente-emails", titulo: "Agente de E-mails", tituloLongo: "Agente de E-mails (IA)", icone: "✦", papeis: ["admin", "corretor"], render: render });
})();
