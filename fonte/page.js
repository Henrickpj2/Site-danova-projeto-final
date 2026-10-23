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
        "Empreendimento: " + (d.get("project") || "Ainda estou avaliando"),
        "Objetivo: " + (d.get("goal") || "Não informado"),
        "Mensagem: " + (d.get("notes") || "Não informada")
      ].join("\n");
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

