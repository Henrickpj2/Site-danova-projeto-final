    const DANOVA_WHATSAPP_NUMBER = "17863826782";

    const menuToggle = document.getElementById("menuToggle");
    const navLinks = document.getElementById("navLinks");
    menuToggle.addEventListener("click", () => {
      const open = navLinks.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.textContent = open ? "✕" : "☰";
    });
    navLinks.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.textContent = "☰";
    }));

    document.getElementById("year").textContent = new Date().getFullYear();

    const filterButtons = document.querySelectorAll(".filter-btn");
    const cards = document.querySelectorAll(".property-card");
    const emptyState = document.getElementById("emptyState");
    filterButtons.forEach(button => {
      button.addEventListener("click", () => {
        filterButtons.forEach(b => b.classList.remove("active"));
        button.classList.add("active");
        const filter = button.dataset.filter;
        let visible = 0;
        cards.forEach(card => {
          const tags = (card.dataset.tags || "").split(" ");
          const matches = filter === "todos" || tags.includes(filter);
          card.style.display = matches ? "" : "none";
          if (matches) visible++;
        });
        emptyState.style.display = visible ? "none" : "block";
      });
    });

    const projectSelect = document.getElementById("project");
    const profileSelect = document.getElementById("profile");
    function selectByText(select, text) {
      const option = Array.from(select.options).find(o => o.text === text);
      if (option) select.value = option.value;
    }
    document.querySelectorAll("[data-project]").forEach(link =>
      link.addEventListener("click", () => selectByText(projectSelect, link.dataset.project)));
    document.querySelectorAll("[data-interest]").forEach(link =>
      link.addEventListener("click", () => selectByText(profileSelect, link.dataset.interest)));
    const goalSelect = document.getElementById("goal");
    document.querySelectorAll("[data-goal]").forEach(link =>
      link.addEventListener("click", () => selectByText(goalSelect, link.dataset.goal)));

    const toast = document.getElementById("toast");
    function showToast(message) {
      toast.textContent = message;
      toast.classList.add("show");
      window.setTimeout(() => toast.classList.remove("show"), 5000);
    }

    const form = document.getElementById("leadForm");
    function buildMessage() {
      const d = new FormData(form);
      return [
        "Olá, Danielle! Gostaria de entrar em contato pelo site DANOVA-AI.",
        "",
        "Nome: " + d.get("name"),
        "E-mail: " + d.get("email"),
        "WhatsApp: " + d.get("phone"),
        "Perfil: " + d.get("profile"),
        d.get("company") ? "Empresa: " + d.get("company") : "",
        d.get("country") ? "Região: " + d.get("country") : "",
        d.get("budget") ? "Investimento mensal em mídia: " + d.get("budget") : "",
        "Empreendimento: " + (d.get("project") || "Ainda estou avaliando"),
        "Necessidade: " + (d.get("goal") || "Não informada"),
        "Mensagem: " + (d.get("notes") || "Não informada")
      ].filter(Boolean).join("\n");
    }
    // Roda antes do script de medição (que envia o lead para /api/lead.php):
    // valida o formulário e monta a mensagem completa no campo "message".
    window.addEventListener("submit", event => {
      if (event.target !== form) return;
      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        form.reportValidity();
        return;
      }
      document.getElementById("fullMessage").value = buildMessage();
    }, true);

    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!form.checkValidity()) return;
      // Envia o lead estruturado direto para o CRM (Supabase). O e-mail de aviso segue pelo /api/lead.php.
      try {
        const crm = window.DANOVA_CRM;
        if (crm && crm.url) {
          const dados = Object.fromEntries(new FormData(form).entries());
          dados.lead_page = "home"; dados.source = "leadForm";
          dados.notes = [dados.company ? "Empresa: " + dados.company : "", dados.notes || "",
            "Consentimento de contato e Política de Privacidade: aceito em " + new Date().toLocaleString("pt-BR")].filter(Boolean).join("\n");
          dados.language = (document.documentElement.lang || "pt").slice(0, 2);
          fetch(crm.url + "/rest/v1/rpc/enviar_lead", {
            method: "POST", keepalive: true,
            headers: { "Content-Type": "application/json", apikey: crm.anonKey, Authorization: "Bearer " + crm.anonKey },
            body: JSON.stringify({ dados: dados })
          }).catch(() => {});
        }
      } catch (e) {}
      if (!window.__danovaTracking) {
        // Fallback se o script de medição não carregar: envia direto ao receptor de leads.
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.source = "leadForm"; payload.page = "home";
        fetch("/api/lead.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
      }
      const url = "https://wa.me/" + DANOVA_WHATSAPP_NUMBER + "?text=" + encodeURIComponent(buildMessage());
      window.open(url, "_blank", "noopener,noreferrer");
      showToast("Obrigado! Recebemos sua solicitação — a conversa no WhatsApp foi aberta em uma nova aba.");
      form.reset();
    });

    // Pedido de vídeo pronto para anúncios → CRM (lead + pedido). O e-mail de aviso segue pelo script de medição.
    const videoForm = document.getElementById("videoForm");
    if (videoForm) videoForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!videoForm.checkValidity()) { videoForm.reportValidity(); return; }
      const f = new FormData(videoForm), btn = videoForm.querySelector("button[type=submit]");
      const lista = n => f.getAll(n);
      const attr = {};
      videoForm.querySelectorAll('input[type=hidden]').forEach(i => { if (i.name) attr[i.name] = i.value; });
      const dados = Object.assign(attr, {
        empreendimento: f.get("empreendimento"), name: f.get("name"), email: f.get("email"), phone: f.get("phone"),
        formatos: lista("formatos"), duracoes: lista("duracoes"), idiomas: lista("idiomas"), plataformas: ["meta", "google"],
        material: f.get("material"), briefing: f.get("briefing"), website: f.get("website"), profile: "Construtora ou incorporadora"
      });
      const crm = window.DANOVA_CRM;
      btn.disabled = true;
      try {
        if (!crm || !crm.url) throw new Error("sem crm");
        const r = await fetch(crm.url + "/rest/v1/rpc/solicitar_video", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: crm.anonKey, Authorization: "Bearer " + crm.anonKey },
          body: JSON.stringify({ dados: dados })
        });
        if (!r.ok) throw new Error("http " + r.status);
        try { (window.dataLayer = window.dataLayer || []).push({ event: "video_pedido", formatos: dados.formatos.join(","), empreendimento: dados.empreendimento }); } catch (e) {}
        showToast("Pedido recebido! Nossa equipe responde com orçamento e prazo.");
        videoForm.reset();
      } catch (e) {
        const msg = "Olá! Quero um vídeo pronto para anúncios do empreendimento " + (dados.empreendimento || "") + ". Formatos: " + dados.formatos.join(", ") + ".";
        window.open("https://wa.me/" + DANOVA_WHATSAPP_NUMBER + "?text=" + encodeURIComponent(msg), "_blank", "noopener,noreferrer");
        showToast("Não conseguimos registrar agora — abrimos o WhatsApp para você enviar o pedido.");
      } finally { btn.disabled = false; }
    });

    // Painel do topo: anima os números fictícios quando aparecem na tela
    (function () {
      const nums = document.querySelectorAll("[data-hd]");
      if (!nums.length || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const animar = el => {
        const alvo = Number(el.dataset.hd), pre = el.dataset.pre || "", ini = performance.now();
        const passo = t => { const k = Math.min(1, (t - ini) / 1100), v = Math.round(alvo * (1 - Math.pow(1 - k, 3)));
          el.textContent = pre + v.toLocaleString("pt-BR"); if (k < 1) requestAnimationFrame(passo); };
        requestAnimationFrame(passo);
      };
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { animar(e.target); io.unobserve(e.target); } }), { threshold: .4 });
      nums.forEach(n => io.observe(n));
    })();


    // ===== Eventos: galeria de fotos e vídeos =====
    // Para publicar: coloque os arquivos em img/eventos/<evento>/ e liste aqui.
    // Fotos: "img/eventos/cmi-rio-2026/01.webp"  ·  Vídeos: arquivo .mp4 ou link do YouTube/Vimeo.
    // Carrossel do mosaico "Eventos, Marketing & PR" (arrastar para o lado)
    const DANOVA_CARROSSEIS = {
      networking: { nome: "Eventos & Networking", fotos: ["img/eventos/global-family-office-2026/01.webp", "img/eventos/sinal-junho-fifa-2026/01.webp", "img/eventos/sinal-junho-fifa-2026/02.webp", "img/eventos/sinal-junho-fifa-2026/03.webp", "img/eventos/sinal-junho-fifa-2026/04.webp", "img/eventos/sinal-junho-fifa-2026/05.webp", "img/eventos/global-family-office-2026/03.webp", "img/eventos/cmi-rio-2026/04.webp"] },
      imprensa: { nome: "PR & Imprensa", fotos: ["img/eventos/global-family-office-2026/05.webp", "img/eventos/cmi-rio-2026/05.webp", "img/imprensa/painel-politico-1.webp", "img/imprensa/painel-politico-2.webp", "img/imprensa/painel-politico-3.webp"] },
      campanhas: { nome: "Campanhas & Lançamentos", fotos: ["img/eventos/sinal-junho-fifa-2026/08.webp", "img/eventos/sinal-junho-fifa-2026/09.webp", "img/eventos/sinal-junho-fifa-2026/10.webp", "img/eventos/sinal-junho-fifa-2026/11.webp", "img/eventos/global-family-office-2026/02.webp", "img/eventos/global-family-office-2026/04.webp"] },
      conteudo: { nome: "Conteúdo & Autoridade", fotos: ["img/eventos/sinal-junho-fifa-2026/06.webp", "img/eventos/sinal-junho-fifa-2026/07.webp", "img/eventos/sinal-junho-fifa-2026/12.webp", "img/eventos/sinal-junho-fifa-2026/video-01.mp4#t=0.1"] }
    };
    (function () {
      const box = document.getElementById("carrossel"); if (!box) return;
      const trilho = document.getElementById("crsTrilho"), tit = document.getElementById("crsTit"), cont = document.getElementById("crsCont");
      const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      let voltar = null, total = 0;
      document.querySelectorAll("[data-carrossel]").forEach(b => { const c = DANOVA_CARROSSEIS[b.dataset.carrossel]; const q = b.querySelector(".evx-qtd"); if (c && q) q.textContent = c.fotos.length + " ›"; });
      const atual = () => Math.round(trilho.scrollLeft / Math.max(1, trilho.clientWidth));
      const marcar = () => { const i = atual(); cont.textContent = (i + 1) + " / " + total; trilho.querySelectorAll("video").forEach((v, k) => { if (k !== i && !v.paused) v.pause(); }); };
      const ir = d => trilho.scrollTo({ left: (atual() + d) * trilho.clientWidth, behavior: "smooth" });
      const fechar = () => { box.hidden = true; document.body.style.overflow = ""; trilho.innerHTML = ""; if (voltar) voltar.focus(); };
      const abrir = (k, botao) => {
        const c = DANOVA_CARROSSEIS[k]; if (!c) return; voltar = botao; total = c.fotos.length; tit.textContent = c.nome;
        trilho.innerHTML = c.fotos.map((u, i) => '<figure class="crs-slide">' + (/\.mp4/.test(u)
          ? '<video src="' + esc(u) + '" controls playsinline preload="metadata"></video>'
          : '<img src="' + esc(u) + '" alt="' + esc(c.nome) + " — " + (i + 1) + '" loading="' + (i < 2 ? "eager" : "lazy") + '" draggable="false">') + "</figure>").join("");
        box.hidden = false; document.body.style.overflow = "hidden"; trilho.scrollLeft = 0; marcar(); trilho.focus();
        if (window.dataLayer) window.dataLayer.push({ event: "carrossel_eventos", galeria: k });
      };
      document.querySelectorAll("[data-carrossel]").forEach(b => b.addEventListener("click", () => abrir(b.dataset.carrossel, b)));
      let t; trilho.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(marcar, 60); });
      box.querySelector(".crs-prev").addEventListener("click", () => ir(-1));
      box.querySelector(".crs-next").addEventListener("click", () => ir(1));
      box.querySelector("[data-crs-x]").addEventListener("click", fechar);
      let arrastou = false;
      box.addEventListener("click", e => { if (arrastou) { arrastou = false; return; } if (e.target === box || e.target.classList.contains("crs-slide")) fechar(); });
      document.addEventListener("keydown", e => { if (box.hidden) return; if (e.key === "Escape") fechar(); else if (e.key === "ArrowRight") ir(1); else if (e.key === "ArrowLeft") ir(-1); });
      // arrastar com o mouse no computador
      let x0 = null, s0 = 0; trilho.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse" || e.target.tagName === "VIDEO") return; x0 = e.clientX; s0 = trilho.scrollLeft; trilho.style.scrollSnapType = "none"; });
      window.addEventListener("pointermove", e => { if (x0 !== null) trilho.scrollLeft = s0 - (e.clientX - x0); });
      window.addEventListener("pointerup", e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; arrastou = Math.abs(dx) > 5; trilho.style.scrollSnapType = ""; const base = Math.round(s0 / trilho.clientWidth); const alvo = Math.abs(dx) > 50 ? base + (dx < 0 ? 1 : -1) : base; trilho.scrollTo({ left: alvo * trilho.clientWidth, behavior: "smooth" }); });
    })();
    const DANOVA_EVENTOS = {
      "sinal-junho-fifa-2026": { nome: "Sinal Junho FIFA 2026", fotos: ["img/eventos/sinal-junho-fifa-2026/01.webp", "img/eventos/sinal-junho-fifa-2026/02.webp", "img/eventos/sinal-junho-fifa-2026/03.webp", "img/eventos/sinal-junho-fifa-2026/04.webp", "img/eventos/sinal-junho-fifa-2026/05.webp", "img/eventos/sinal-junho-fifa-2026/06.webp", "img/eventos/sinal-junho-fifa-2026/07.webp", "img/eventos/sinal-junho-fifa-2026/08.webp", "img/eventos/sinal-junho-fifa-2026/09.webp", "img/eventos/sinal-junho-fifa-2026/10.webp", "img/eventos/sinal-junho-fifa-2026/11.webp", "img/eventos/sinal-junho-fifa-2026/12.webp"], videos: ["img/eventos/sinal-junho-fifa-2026/video-01.mp4#t=0.1"] },
      "cmi-rio-2026": { nome: "CMI Rio 2026", fotos: ["img/eventos/cmi-rio-2026/01.webp", "img/eventos/cmi-rio-2026/02.webp", "img/eventos/cmi-rio-2026/03.webp", "img/eventos/cmi-rio-2026/04.webp", "img/eventos/cmi-rio-2026/05.webp", "img/eventos/cmi-rio-2026/06.webp"], videos: [] },
      "painel-politico": { nome: "Painel Político · 14/09/2026", tipoTitulo: "Na imprensa", imprensa: true, fotos: ["img/imprensa/painel-politico-1.webp", "img/imprensa/painel-politico-2.webp", "img/imprensa/painel-politico-3.webp"], videos: [] },
      "global-family-office-2026": { nome: "Global Family Office 2026", fotos: ["img/eventos/global-family-office-2026/01.webp", "img/eventos/global-family-office-2026/02.webp", "img/eventos/global-family-office-2026/03.webp", "img/eventos/global-family-office-2026/04.webp", "img/eventos/global-family-office-2026/05.webp"], videos: [] }
    };
    (function () {
      const modal = document.getElementById("eventModal"); if (!modal) return;
      const corpo = document.getElementById("eventModalCorpo"), titulo = document.getElementById("eventModalTitulo"), tipoEl = document.getElementById("eventModalTipo");
      let voltarPara = null;
      const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const embed = url => {
        const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
        if (yt) return '<iframe src="https://www.youtube-nocookie.com/embed/' + yt[1] + '" title="Vídeo do evento" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
        const vm = url.match(/vimeo\.com\/(\d+)/);
        if (vm) return '<iframe src="https://player.vimeo.com/video/' + vm[1] + '" title="Vídeo do evento" allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
        return '<video src="' + esc(url) + '" controls preload="metadata" playsinline></video>';
      };
      const abrir = (id, tipo, botao) => {
        const ev = DANOVA_EVENTOS[id]; if (!ev) return;
        const itens = ev[tipo] || [];
        tipoEl.textContent = ev.tipoTitulo || (tipo === "fotos" ? "Fotos" : "Vídeos"); titulo.textContent = ev.nome;
        corpo.innerHTML = itens.length
          ? '<div class="event-galeria ' + tipo + (ev.imprensa ? " imprensa" : "") + '">' + itens.map((u, i) => tipo === "fotos"
              ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="' + esc(ev.nome) + " — foto " + (i + 1) + '" loading="lazy"></a>'
              : embed(u)).join("") + "</div>"
          : '<div class="event-vazio"><b>' + (tipo === "fotos" ? "Fotos em breve" : "Vídeos em breve") + '</b>Assim que o material do evento estiver pronto, ele aparece aqui.</div>';
        voltarPara = botao; modal.hidden = false; document.body.style.overflow = "hidden";
        modal.querySelector("[data-fechar-evento]").focus();
        if (window.dataLayer) window.dataLayer.push({ event: "evento_galeria", evento: id, tipo: tipo });
      };
      const fechar = () => { modal.hidden = true; document.body.style.overflow = ""; corpo.innerHTML = ""; if (voltarPara) voltarPara.focus(); };
      document.querySelectorAll(".event-card [data-galeria]").forEach(b => b.addEventListener("click", () => abrir(b.closest(".event-card").dataset.evento, b.dataset.galeria, b)));
      document.querySelectorAll("[data-imprensa]").forEach(b => b.addEventListener("click", () => { abrir(b.dataset.imprensa, "fotos", b); const alvo = corpo.querySelectorAll("img")[+b.dataset.i || 0]; if (alvo) setTimeout(() => alvo.scrollIntoView({ block: "start" }), 60); }));
      document.querySelectorAll(".event-card [data-galeria]").forEach(b => { const ev = DANOVA_EVENTOS[b.closest(".event-card").dataset.evento]; const n = ev && (ev[b.dataset.galeria] || []).length; if (n) b.innerHTML = b.textContent + ' <span class="event-n">' + n + "</span>"; });
      modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-fechar-evento]")) fechar(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) fechar(); });
    })();
