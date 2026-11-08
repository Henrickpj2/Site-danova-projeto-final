/* danova AI — Eventos do site. Só administradores.
   Cria eventos e envia fotos/vídeos que aparecem no site em "Onde a danova AI esteve presente".
   Tabelas public.site_eventos e public.site_evento_midias + bucket público "eventos"
   (migração supabase/migracoes/2026-11-08-eventos-site.sql). */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {};
  D.modulos = D.modulos || [];

  var BUCKET = "eventos", LIMITE_MB = 50;
  var ICONES = ["◆", "◎", "◈", "★", "●", "▲", "✦", "◉"];
  var st = { aberto: null, novo: false, editando: null, enviando: null };

  function slugify(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "evento";
  }
  // arquivos antigos do site ficam em public_html/img/... (caminho relativo ao site)
  function urlVer(u) { return /^https?:\/\//.test(u) ? u : "../" + String(u).replace(/^\/+/, ""); }
  function ehLinkVideo(u) { return /youtube\.com|youtu\.be|vimeo\.com/.test(u); }
  function tipoDoArquivo(f) { return /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v)$/i.test(f.name) ? "video" : /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(f.name) ? "foto" : ""; }
  function nomeSeguro(n) { var p = String(n).split("."), ext = p.length > 1 ? p.pop().toLowerCase() : ""; return slugify(p.join(".")).slice(0, 40) + (ext ? "." + ext : ""); }

  // Fotos grandes viram WebP de até 2000 px (carregam rápido no site). GIF e arquivos pequenos ficam como estão.
  function otimizarFoto(f) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 700 * 1024) return Promise.resolve(f);
    return new Promise(function (ok) {
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (!b || b.size >= f.size) return ok(f);
          ok(new File([b], f.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" }));
        }, "image/webp", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ok(f); };
      img.src = url;
    });
  }

  function formHTML(A, e) {
    e = e || {};
    var v = function (k) { return A.esc(e[k] == null ? "" : e[k]); };
    return '<form class="card kb-form" data-eform>' +
      "<h3>" + (e.id ? "Editar evento" : "Novo evento") + "</h3>" +
      '<div class="kb-grid"><label>Nome do evento *<input name="nome" required maxlength="160" value="' + v("nome") + '" placeholder="Ex.: Brazil Investment Week 2026"></label>' +
      '<label>Local / descrição<input name="local" maxlength="300" value="' + v("local") + '" placeholder="Ex.: Miami · Flórida"></label></div>' +
      '<div class="kb-grid"><label>Selo (ano)<input name="tag" maxlength="20" value="' + A.esc(e.id ? (e.tag || "") : String(new Date().getFullYear())) + '"></label>' +
      '<label>Site oficial do evento (opcional)<input name="link" type="url" maxlength="500" value="' + v("link") + '" placeholder="https://"></label></div>' +
      '<div class="kb-grid"><label>Ícone<select name="icone">' + ICONES.map(function (i) { return "<option" + (i === (e.icone || "◆") ? " selected" : "") + ">" + i + "</option>"; }).join("") + "</select></label>" +
      '<label>Posição no site (1 = primeiro)<input name="ordem" type="number" min="0" max="999" value="' + A.esc(e.ordem != null ? e.ordem : "") + '"></label></div>' +
      '<label class="cad-aceite"><input type="checkbox" name="publicado"' + (e.id && !e.publicado ? "" : " checked") + "> <span>Mostrar no site</span></label>" +
      '<div class="kb-acts"><span class="spacer"></span><button type="button" class="btn ghost" data-ecancelar>Cancelar</button><button class="btn primary">' + (e.id ? "Salvar" : "Criar evento") + "</button></div></form>";
  }

  function midiaHTML(A, m, i, total) {
    var prev = m.tipo === "foto"
      ? '<img src="' + A.esc(urlVer(m.url)) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">'
      : ehLinkVideo(m.url)
        ? '<div style="display:grid;place-items:center;height:100%;font-size:12px;padding:8px;text-align:center">▶ ' + A.esc(m.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)) + "</div>"
        : '<video src="' + A.esc(urlVer(m.url)) + '" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>';
    return '<div class="ev-midia" style="position:relative;border-radius:12px;overflow:hidden;aspect-ratio:1;background:rgba(127,127,127,.15)">' + prev +
      '<span style="position:absolute;left:6px;top:6px;font-size:11px;font-weight:700;background:rgba(0,0,0,.6);color:#fff;border-radius:999px;padding:2px 8px">' + (m.tipo === "foto" ? "Foto " : "Vídeo ") + (i + 1) + "</span>" +
      '<div style="position:absolute;right:6px;bottom:6px;display:flex;gap:4px">' +
      (i > 0 ? '<button class="btn small" data-mmover="' + m.id + '" data-dir="-1" title="Mover para trás">‹</button>' : "") +
      (i < total - 1 ? '<button class="btn small" data-mmover="' + m.id + '" data-dir="1" title="Mover para frente">›</button>' : "") +
      '<button class="btn small" data-mexcluir="' + m.id + '" title="Remover do evento">✕</button></div></div>';
  }

  function galeriaHTML(A, ev, tipo) {
    var itens = (ev.site_evento_midias || []).filter(function (m) { return m.tipo === tipo; }).sort(function (a, b) { return a.ordem - b.ordem; });
    return "<h4 style=\"margin:18px 0 8px\">" + (tipo === "foto" ? "Fotos" : "Vídeos") + " (" + itens.length + ")</h4>" +
      (itens.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">' + itens.map(function (m, i) { return midiaHTML(A, m, i, itens.length); }).join("") + "</div>"
        : '<p class="muted" style="margin:0">Nenhum' + (tipo === "foto" ? "a foto" : " vídeo") + " ainda. No site aparece “" + (tipo === "foto" ? "Fotos" : "Vídeos") + " em breve”.</p>");
  }

  function painelHTML(A, ev) {
    return '<div class="card" data-epainel style="padding:18px 20px">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">' + A.esc(ev.icone) + " " + A.esc(ev.nome) + "</h3>" +
      (ev.publicado ? '<span class="tag" style="background:rgba(20,184,166,.18);color:#14b8a6">No site</span>' : '<span class="tag" style="background:rgba(148,163,184,.2)">Oculto</span>') + '<span class="spacer" style="flex:1"></span>' +
      '<button class="btn small ghost" data-efechar>Fechar</button></div>' +
      '<p class="muted" style="margin:4px 0 14px">' + A.esc([ev.local, ev.tag].filter(Boolean).join(" · ")) + "</p>" +
      '<label data-edrop style="display:block;border:2px dashed rgba(127,127,127,.45);border-radius:14px;padding:22px;text-align:center;cursor:pointer">' +
      '<input type="file" data-earquivos multiple accept="image/*,video/mp4,video/quicktime,video/webm" hidden>' +
      "<b>Enviar fotos e vídeos</b><br><span class=\"muted\">Clique para escolher ou arraste os arquivos aqui · fotos (JPG, PNG, WebP) e vídeos (MP4, MOV) até " + LIMITE_MB + " MB</span></label>" +
      (st.enviando ? '<p class="note" style="margin-top:10px">' + A.esc(st.enviando) + "</p>" : "") +
      '<form data-elink style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><input name="url" type="url" placeholder="Ou cole um link do YouTube / Vimeo" style="flex:1;min-width:220px"><button class="btn">Adicionar vídeo</button></form>' +
      galeriaHTML(A, ev, "foto") + galeriaHTML(A, ev, "video") + "</div>";
  }

  async function render(el, A) {
    var r = await A.sb.from("site_eventos").select("*, site_evento_midias(*)").order("ordem").order("criado_em");
    if (r.error) {
      el.innerHTML = '<div class="empty">' + (/site_eventos/.test(r.error.message) ? "A área de eventos ainda não foi criada no banco. Aplique a migração <code>supabase/migracoes/2026-11-08-eventos-site.sql</code>." : A.esc(r.error.message)) + "</div>";
      return;
    }
    var eventos = r.data || [];
    var aberto = st.aberto && eventos.find(function (e) { return e.id === st.aberto; });
    var editando = st.editando && eventos.find(function (e) { return e.id === st.editando; });
    var conta = function (e, t) { return (e.site_evento_midias || []).filter(function (m) { return m.tipo === t; }).length; };
    var totF = 0, totV = 0; eventos.forEach(function (e) { totF += conta(e, "foto"); totV += conta(e, "video"); });

    el.innerHTML =
      '<div class="kpis">' + A.kpi("Eventos", eventos.length, eventos.filter(function (e) { return e.publicado; }).length + " no site") +
      A.kpi("Fotos", totF, "em todos os eventos") + A.kpi("Vídeos", totV, "em todos os eventos") + "</div>" +
      '<div class="card kb-como"><p class="muted" style="margin:0">O que você cadastrar aqui aparece no site, na seção <b>Onde a danova AI esteve presente</b>, logo depois de salvar — não precisa mexer no GitHub. Clique em <b>Fotos e vídeos</b> no evento para enviar arquivos.</p></div>' +
      (st.novo || editando ? formHTML(A, editando) : "") +
      (aberto ? painelHTML(A, aberto) : "") +
      '<div class="filters"><span class="muted" style="flex:1">' + eventos.length + (eventos.length === 1 ? " evento" : " eventos") + '</span><a class="btn ghost" href="../#experiencias" target="_blank" rel="noopener">Ver no site ↗</a><button class="btn primary" data-enovo>+ Novo evento</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Evento</th><th>Fotos</th><th>Vídeos</th><th class="hide-sm">Posição</th><th>Site</th><th></th></tr></thead><tbody>' +
      (eventos.map(function (e) {
        return "<tr><td><strong>" + A.esc(e.icone + " " + e.nome) + "</strong>" + (e.local ? '<span class="sub">' + A.esc(e.local) + "</span>" : "") + "</td>" +
          "<td>" + conta(e, "foto") + "</td><td>" + conta(e, "video") + '</td><td class="hide-sm">' + e.ordem + "</td>" +
          '<td><label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" data-epub="' + e.id + '"' + (e.publicado ? " checked" : "") + ">" + (e.publicado ? "Visível" : "Oculto") + "</label></td>" +
          '<td class="kb-row-acts"><button class="btn small primary" data-eabrir="' + e.id + '">Fotos e vídeos</button><button class="btn small ghost" data-eeditar="' + e.id + '">Editar</button><button class="btn small ghost" data-eexcluir="' + e.id + '" title="Excluir evento">✕</button></td></tr>';
      }).join("") || '<tr><td colspan="6"><div class="empty">Nenhum evento ainda. Clique em “+ Novo evento”.</div></td></tr>') + "</tbody></table></div>";

    var rolar = function (sel) { var x = el.querySelector(sel); if (x) x.scrollIntoView({ behavior: "smooth", block: "start" }); };
    el.querySelector("[data-enovo]").addEventListener("click", function () { st.novo = true; st.editando = null; render(el, A).then(function () { rolar("[data-eform]"); }); });
    el.querySelectorAll("[data-eabrir]").forEach(function (b) { b.addEventListener("click", function () { st.aberto = b.dataset.eabrir; st.novo = false; st.editando = null; render(el, A).then(function () { rolar("[data-epainel]"); }); }); });
    el.querySelectorAll("[data-eeditar]").forEach(function (b) { b.addEventListener("click", function () { st.editando = b.dataset.eeditar; st.novo = false; render(el, A).then(function () { rolar("[data-eform]"); }); }); });
    el.querySelectorAll("[data-epub]").forEach(function (c) { c.addEventListener("change", async function () {
      var rr = await A.sb.from("site_eventos").update({ publicado: c.checked }).eq("id", c.dataset.epub);
      if (rr.error) return A.falha(rr.error); A.toast(c.checked ? "Evento visível no site." : "Evento oculto no site."); render(el, A);
    }); });
    el.querySelectorAll("[data-eexcluir]").forEach(function (b) { b.addEventListener("click", async function () {
      var e = eventos.find(function (x) { return x.id === b.dataset.eexcluir; });
      if (!window.confirm("Excluir o evento “" + e.nome + "” e todas as fotos e vídeos enviados para ele? Isso não pode ser desfeito.")) return;
      var arqs = (e.site_evento_midias || []).map(function (m) { return m.caminho; }).filter(Boolean);
      if (arqs.length) await A.sb.storage.from(BUCKET).remove(arqs);
      var rr = await A.sb.from("site_eventos").delete().eq("id", e.id);
      if (rr.error) return A.falha(rr.error);
      if (st.aberto === e.id) st.aberto = null;
      A.toast("Evento excluído."); render(el, A);
    }); });

    var form = el.querySelector("[data-eform]");
    if (form) {
      form.querySelector("[data-ecancelar]").addEventListener("click", function () { st.novo = false; st.editando = null; render(el, A); });
      form.addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var d = {
          nome: form.nome.value.trim(), local: form.local.value.trim() || null, tag: form.tag.value.trim() || null,
          link: form.link.value.trim() || null, icone: form.icone.value, publicado: form.publicado.checked
        };
        var ord = form.ordem.value.trim();
        d.ordem = ord !== "" ? Number(ord) : (editando ? editando.ordem : eventos.reduce(function (m, e) { return Math.max(m, e.ordem); }, 0) + 1);
        var res;
        if (editando) res = await A.sb.from("site_eventos").update(d).eq("id", editando.id).select().single();
        else {
          var base = slugify(d.nome), slug = base, n = 2;
          while (eventos.some(function (e) { return e.slug === slug; })) slug = base + "-" + n++;
          d.slug = slug;
          res = await A.sb.from("site_eventos").insert(d).select().single();
        }
        if (res.error) return A.falha(res.error);
        A.toast(editando ? "Evento atualizado." : "Evento criado. Agora envie as fotos e vídeos.");
        if (!editando) st.aberto = res.data.id;
        st.novo = false; st.editando = null;
        render(el, A).then(function () { rolar(editando ? ".kpis" : "[data-epainel]"); });
      });
    }

    var painel = el.querySelector("[data-epainel]");
    if (painel && aberto) {
      var midias = aberto.site_evento_midias || [];
      painel.querySelector("[data-efechar]").addEventListener("click", function () { st.aberto = null; render(el, A); });
      var inp = painel.querySelector("[data-earquivos]"), drop = painel.querySelector("[data-edrop]");
      inp.addEventListener("change", function () { enviar(Array.from(inp.files)); });
      ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.style.borderColor = "#14b8a6"; }); });
      ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.style.borderColor = ""; }); });
      drop.addEventListener("drop", function (e) { enviar(Array.from(e.dataTransfer.files || [])); });

      async function enviar(arquivos) {
        if (st.enviando) return;
        var validos = [], recusados = [];
        arquivos.forEach(function (f) {
          var t = tipoDoArquivo(f);
          if (!t) recusados.push(f.name + " (formato não aceito)");
          else if (t === "video" && f.size > LIMITE_MB * 1048576) recusados.push(f.name + " (vídeo acima de " + LIMITE_MB + " MB)");
          else validos.push({ f: f, t: t });
        });
        if (!validos.length) { A.toast(recusados.length ? "Não enviado: " + recusados.join(", ") : "Nenhum arquivo escolhido."); return; }
        var prox = { foto: 0, video: 0 };
        midias.forEach(function (m) { prox[m.tipo] = Math.max(prox[m.tipo], m.ordem + 1); });
        var ok = 0, erros = [];
        for (var i = 0; i < validos.length; i++) {
          st.enviando = "Enviando " + (i + 1) + " de " + validos.length + ": " + validos[i].f.name + "… não feche esta tela.";
          var nota = painel.querySelector(".note"); if (nota) nota.textContent = st.enviando; else drop.insertAdjacentHTML("afterend", '<p class="note" style="margin-top:10px">' + A.esc(st.enviando) + "</p>");
          var arq = validos[i].t === "foto" ? await otimizarFoto(validos[i].f) : validos[i].f;
          if (arq.size > LIMITE_MB * 1048576) { erros.push(arq.name + " (acima de " + LIMITE_MB + " MB)"); continue; }
          var caminho = aberto.slug + "/" + Date.now() + "-" + nomeSeguro(arq.name);
          var up = await A.sb.storage.from(BUCKET).upload(caminho, arq, { contentType: arq.type || undefined, cacheControl: "31536000", upsert: false });
          if (up.error) { erros.push(arq.name + " (" + up.error.message + ")"); continue; }
          var url = A.sb.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl + (validos[i].t === "video" ? "#t=0.1" : "");
          var ins = await A.sb.from("site_evento_midias").insert({ evento_id: aberto.id, tipo: validos[i].t, url: url, caminho: caminho, ordem: prox[validos[i].t]++ });
          if (ins.error) { await A.sb.storage.from(BUCKET).remove([caminho]); erros.push(arq.name + " (" + ins.error.message + ")"); continue; }
          ok++;
        }
        st.enviando = null;
        var falhas = erros.concat(recusados);
        A.toast(ok + (ok === 1 ? " arquivo enviado" : " arquivos enviados") + (falhas.length ? " · não enviados: " + falhas.join(", ") : " · já está no site."));
        render(el, A);
      }

      painel.querySelector("[data-elink]").addEventListener("submit", async function (e) {
        e.preventDefault();
        var u = e.target.url.value.trim();
        if (!ehLinkVideo(u)) { A.toast("Cole um link do YouTube ou do Vimeo."); return; }
        var ordem = midias.filter(function (m) { return m.tipo === "video"; }).reduce(function (mx, m) { return Math.max(mx, m.ordem + 1); }, 0);
        var rr = await A.sb.from("site_evento_midias").insert({ evento_id: aberto.id, tipo: "video", url: u, ordem: ordem });
        if (rr.error) return A.falha(rr.error); A.toast("Vídeo adicionado."); render(el, A);
      });

      painel.querySelectorAll("[data-mexcluir]").forEach(function (b) { b.addEventListener("click", async function () {
        var m = midias.find(function (x) { return x.id === b.dataset.mexcluir; });
        if (!window.confirm("Remover " + (m.tipo === "foto" ? "esta foto" : "este vídeo") + " do evento?")) return;
        var rr = await A.sb.from("site_evento_midias").delete().eq("id", m.id);
        if (rr.error) return A.falha(rr.error);
        if (m.caminho) await A.sb.storage.from(BUCKET).remove([m.caminho]);
        A.toast(m.tipo === "foto" ? "Foto removida." : "Vídeo removido."); render(el, A);
      }); });

      painel.querySelectorAll("[data-mmover]").forEach(function (b) { b.addEventListener("click", async function () {
        var m = midias.find(function (x) { return x.id === b.dataset.mmover; });
        var lista = midias.filter(function (x) { return x.tipo === m.tipo; }).sort(function (a, c) { return a.ordem - c.ordem; });
        var i = lista.indexOf(m), j = i + Number(b.dataset.dir); if (j < 0 || j >= lista.length) return;
        lista.splice(j, 0, lista.splice(i, 1)[0]);
        var res = await Promise.all(lista.map(function (x, k) { return x.ordem === k ? null : A.sb.from("site_evento_midias").update({ ordem: k }).eq("id", x.id); }));
        var err = res.find(function (x) { return x && x.error; }); if (err) return A.falha(err.error);
        render(el, A);
      }); });
    }
  }

  D.modulos.push({ id: "eventos", titulo: "Eventos", tituloLongo: "Eventos do site · fotos e vídeos", icone: "▣", papeis: ["admin"], antes: "conta", render: function (el, A) { render(el, A).catch(function (x) { A.falha(x); }); } });
})();
