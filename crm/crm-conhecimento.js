/* danova AI — Base de conhecimento (RAG) da IA. Só administradores.
   Os documentos daqui alimentam o chat do site e o assistente do CRM: cada pergunta busca os trechos
   mais parecidos (pgvector) e a IA responde só com eles. Aceita texto colado ou arquivo .txt, .md, .csv, .pdf e .docx. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];

  var CATS = { geral: "Geral", empreendimento: "Empreendimento", servicos: "Serviços", plataforma: "Plataforma", precos: "Preços e condições", faq: "Perguntas frequentes", outro: "Outro" };
  var STATUS = { pendente: ["Na fila", ""], indexando: ["Indexando…", "warn"], pronto: ["Pronto", "ok"], erro: ["Erro", "bad"] };
  var LIMITE = 200000;
  var CDN = {
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    docx: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"
  };
  var st = { el: null, A: null, editando: null };

  function script(src) {
    return new Promise(function (ok, erro) {
      if (document.querySelector('script[src="' + src + '"]')) return ok();
      var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { erro(new Error("Não consegui carregar o leitor de arquivo.")); };
      document.head.appendChild(s);
    });
  }
  async function lerArquivo(f) {
    var nome = f.name.toLowerCase();
    if (/\.(txt|md|csv|json)$/.test(nome)) return await f.text();
    if (/\.pdf$/.test(nome)) {
      await script(CDN.pdf);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
      var pdf = await window.pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise, out = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        var c = await (await pdf.getPage(i)).getTextContent();
        out.push(c.items.map(function (it) { return it.str + (it.hasEOL ? "\n" : " "); }).join("").replace(/[ \t]+\n/g, "\n"));
      }
      var txt = out.join("\n\n").trim();
      if (!txt) throw new Error("Esse PDF parece ser só imagem (escaneado). Cole o texto manualmente.");
      return txt;
    }
    if (/\.docx$/.test(nome)) {
      await script(CDN.docx);
      return (await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
    }
    throw new Error("Formato não aceito. Use .txt, .md, .csv, .pdf ou .docx.");
  }
  function erroFn(e) {
    var m = (e && (e.message || e.erro)) || String(e);
    if (/sem_acesso/.test(m)) return "Só administradores podem mexer na base.";
    if (/Failed to send|FunctionsFetchError|404/.test(m)) return "A função 'conhecimento' ainda não foi publicada no Supabase.";
    return m;
  }
  async function indexar(A, id) {
    var r = await A.sb.functions.invoke("conhecimento", { body: { acao: "indexar", doc_id: id } });
    if (r.error) {
      var det = ""; try { det = (await r.error.context.json()).detalhe || ""; } catch (x) { }
      A.toast("Falha ao indexar: " + erroFn(det || r.error));
      return false;
    }
    A.toast("Documento indexado: " + r.data.trechos + " trecho(s).");
    return true;
  }

  function formHTML(A, d) {
    d = d || {};
    return '<form class="card kb-form" data-kbform>' +
      "<h3>" + (d.id ? "Editar documento" : "Adicionar à base") + "</h3>" +
      '<div class="kb-grid"><label>Título<input name="titulo" required maxlength="200" value="' + A.esc(d.titulo || "") + '" placeholder="Ex.: Tabela de preços Faena — outubro"></label>' +
      '<label>Categoria<select name="categoria">' + Object.keys(CATS).map(function (k) { return '<option value="' + k + '"' + (k === (d.categoria || "geral") ? " selected" : "") + ">" + CATS[k] + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="kb-arq">Arquivo (opcional) <input type="file" name="arquivo" accept=".txt,.md,.csv,.json,.pdf,.docx"><small>O texto do arquivo aparece abaixo para você revisar antes de salvar.</small></label>' +
      '<label>Conteúdo<textarea name="texto" rows="10" required maxlength="' + LIMITE + '" placeholder="Cole aqui o texto: descrição, preços, condições de pagamento, perguntas e respostas…">' + A.esc(d.texto || "") + "</textarea></label>" +
      '<div class="kb-acts"><span class="muted" data-cont></span><span class="spacer"></span>' + (d.id ? '<button type="button" class="btn ghost" data-cancelar>Cancelar</button>' : "") + '<button class="btn primary">' + (d.id ? "Salvar e reindexar" : "Salvar e indexar") + "</button></div></form>";
  }

  async function render(el, A) {
    st.el = el; st.A = A;
    var r = await A.sb.from("conhecimento_docs").select("id, titulo, categoria, ativo, status, erro, total_trechos, arquivo_nome, atualizado_em, texto").order("categoria").order("titulo");
    if (r.error) {
      el.innerHTML = '<div class="empty">' + (/conhecimento_docs/.test(r.error.message) ? "A base de conhecimento ainda não foi criada no banco. Aplique a migração <code>supabase/migracoes/2026-10-25-conhecimento.sql</code>." : A.esc(r.error.message)) + "</div>";
      return;
    }
    var docs = r.data || [];
    var ativos = docs.filter(function (d) { return d.ativo && d.status === "pronto"; });
    var trechos = ativos.reduce(function (s, d) { return s + (d.total_trechos || 0); }, 0);
    var editando = st.editando && docs.find(function (d) { return d.id === st.editando; });

    el.innerHTML =
      '<div class="kpis kpis-3">' + A.kpi("Documentos ativos", ativos.length, docs.length + " no total") + A.kpi("Trechos indexados", trechos, "pedaços que a IA consulta") +
      A.kpi("Usada por", "Chat + CRM", "voz: base no ElevenLabs") + "</div>" +
      '<div class="card kb-como"><p class="muted" style="margin:0">Cada pergunta feita no <b>chat do site</b> ou na <b>análise de lead do CRM</b> busca aqui os trechos mais parecidos e a IA responde só com eles. Mantenha preços e condições atualizados; para tirar algo do ar sem apagar, desligue <b>Ativo</b>.</p></div>' +
      formHTML(A, editando) +
      '<div class="card kb-teste"><h3>Testar a busca</h3><form class="filters" data-kbteste><input name="q" placeholder="Ex.: qual a forma de pagamento do Continuum?" style="flex:1;min-width:220px"><button class="btn">Buscar</button></form><div data-kbres></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Documento</th><th>Categoria</th><th>Status</th><th class="hide-sm">Trechos</th><th>Ativo</th><th></th></tr></thead><tbody>' +
      (docs.map(function (d) {
        var s = STATUS[d.status] || [d.status, ""];
        return "<tr><td><strong>" + A.esc(d.titulo) + '</strong><span class="sub">' + A.esc((d.texto || "").slice(0, 110)) + ((d.texto || "").length > 110 ? "…" : "") + "</span>" +
          '<span class="sub">' + (d.arquivo_nome ? "📎 " + A.esc(d.arquivo_nome) + " · " : "") + "atualizado " + A.dt(d.atualizado_em, true) + (d.erro ? ' · <span class="kb-erro">' + A.esc(d.erro) + "</span>" : "") + "</span></td>" +
          "<td>" + A.esc(CATS[d.categoria] || d.categoria) + '</td><td><span class="pill ' + s[1] + '">' + s[0] + '</span></td><td class="hide-sm">' + (d.total_trechos || 0) + "</td>" +
          '<td><label class="switch"><input type="checkbox" data-ativo="' + d.id + '"' + (d.ativo ? " checked" : "") + "><span></span></label></td>" +
          '<td class="kb-row-acts"><button class="btn small ghost" data-editar="' + d.id + '">Editar</button><button class="btn small ghost" data-reindexar="' + d.id + '" title="Gerar os trechos de novo">↻</button><button class="btn small ghost" data-excluir="' + d.id + '" title="Excluir">✕</button></td></tr>';
      }).join("") || '<tr><td colspan="6"><div class="empty">Nenhum documento ainda. Adicione o primeiro acima.</div></td></tr>') + "</tbody></table></div>";

    var form = el.querySelector("[data-kbform]"), ta = form.texto, cont = form.querySelector("[data-cont]");
    var arquivoAtual = null;
    var contar = function () { cont.textContent = ta.value.length.toLocaleString("pt-BR") + " / " + LIMITE.toLocaleString("pt-BR") + " caracteres"; };
    ta.addEventListener("input", contar); contar();
    form.arquivo.addEventListener("change", async function () {
      var f = form.arquivo.files[0]; if (!f) return;
      if (f.size > 20 * 1024 * 1024) { A.toast("Arquivo acima de 20 MB."); form.arquivo.value = ""; return; }
      cont.textContent = "Lendo " + f.name + "…";
      try {
        var txt = (await lerArquivo(f)).replace(/\u0000/g, "").trim();
        if (txt.length > LIMITE) { A.toast("O texto passou de 200 mil caracteres; foi cortado. Divida em mais documentos."); txt = txt.slice(0, LIMITE); }
        ta.value = txt; arquivoAtual = f;
        if (!form.titulo.value) form.titulo.value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 200);
        contar();
      } catch (e) { A.toast(e.message); form.arquivo.value = ""; contar(); }
    });
    var cancelar = form.querySelector("[data-cancelar]");
    if (cancelar) cancelar.addEventListener("click", function () { st.editando = null; render(el, A); });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = form.querySelector("button.primary"); btn.disabled = true; btn.textContent = "Salvando…";
      try {
        var dados = { titulo: form.titulo.value.trim(), categoria: form.categoria.value, texto: ta.value.trim(), status: "pendente", erro: null, atualizado_em: new Date().toISOString() };
        var id = editando ? editando.id : null;
        if (arquivoAtual) {
          var caminho = (A.S.me && A.S.me.id ? A.S.me.id : "admin") + "/" + Date.now() + "-" + arquivoAtual.name.replace(/[^\w.\-]+/g, "_").slice(-80);
          var up = await A.sb.storage.from("conhecimento").upload(caminho, arquivoAtual, { upsert: false });
          if (!up.error) { dados.arquivo_nome = arquivoAtual.name.slice(0, 200); dados.arquivo_path = caminho; }
        }
        var res = id ? await A.sb.from("conhecimento_docs").update(dados).eq("id", id).select("id").single()
          : await A.sb.from("conhecimento_docs").insert(dados).select("id").single();
        if (res.error) { A.falha(res.error); return; }
        btn.textContent = "Indexando…";
        await indexar(A, res.data.id);
        st.editando = null;
      } finally { render(el, A); }
    });

    el.querySelector("[data-kbteste]").addEventListener("submit", async function (e) {
      e.preventDefault();
      var q = e.target.q.value.trim(), box = el.querySelector("[data-kbres]"); if (!q) return;
      box.innerHTML = '<p class="muted">Buscando…</p>';
      var rr = await A.sb.functions.invoke("conhecimento", { body: { acao: "buscar", consulta: q } });
      if (rr.error) { box.innerHTML = '<p class="kb-erro">' + A.esc(erroFn(rr.error)) + "</p>"; return; }
      var t = rr.data.trechos || [];
      box.innerHTML = t.length ? '<ol class="kb-res">' + t.map(function (x) {
        return "<li><b>" + A.esc(x.titulo) + '</b> <span class="pill">' + Math.round((1 - x.distancia) * 100) + "% parecido</span><p>" + A.esc(x.texto.replace(/^\[[^\]]*\]\n/, "")) + "</p></li>";
      }).join("") + "</ol>" : '<p class="muted">Nada parecido na base. A IA vai responder que a equipe confirma (e usar a base fixa de reserva).</p>';
    });

    el.querySelectorAll("[data-ativo]").forEach(function (i) { i.addEventListener("change", async function () {
      var rr = await A.sb.from("conhecimento_docs").update({ ativo: i.checked }).eq("id", i.dataset.ativo);
      if (rr.error) return A.falha(rr.error); A.toast(i.checked ? "Documento ativo: a IA volta a usar." : "Documento desativado: a IA deixa de usar."); render(el, A);
    }); });
    el.querySelectorAll("[data-editar]").forEach(function (b) { b.addEventListener("click", function () { st.editando = b.dataset.editar; render(el, A).then(function () { el.querySelector("[data-kbform]").scrollIntoView({ behavior: "smooth", block: "start" }); }); }); });
    el.querySelectorAll("[data-reindexar]").forEach(function (b) { b.addEventListener("click", async function () { b.disabled = true; await indexar(A, b.dataset.reindexar); render(el, A); }); });
    el.querySelectorAll("[data-excluir]").forEach(function (b) { b.addEventListener("click", async function () {
      var d = docs.find(function (x) { return x.id === b.dataset.excluir; });
      if (!window.confirm("Excluir \"" + d.titulo + "\" da base? A IA deixa de usar estas informações.")) return;
      var rr = await A.sb.from("conhecimento_docs").delete().eq("id", d.id);
      if (rr.error) return A.falha(rr.error);
      if (d.arquivo_path) await A.sb.storage.from("conhecimento").remove([d.arquivo_path]);
      A.toast("Documento excluído."); render(el, A);
    }); });
  }

  D.modulos.push({ id: "conhecimento", titulo: "Conhecimento", tituloLongo: "Base de conhecimento da IA (RAG)", icone: "✦", papeis: ["admin"], render: render });
})();
