/* danova AI CRM — Google Ads por ID da conta (123-456-7890).
   Cadastre o ID → o CRM pede ao integrador autorizado (Make · Google Ads Reports) os dados das campanhas
   → investimento, impressões, cliques, conversões por campanha e por dia. Atualiza sozinho 2x por dia e no botão. */
(function () {
  "use strict";
  var D = window.DanovaCRM = window.DanovaCRM || {}; D.modulos = D.modulos || [];
  var st = { dias: 30, conta: "", timer: null };
  var ERR = { id_invalido: "Confira o ID: são 10 números, no formato 123-456-7890.", conta_de_outro_cliente: "Esta conta já está ligada a outro cliente.",
    sem_conta_vinculada: "Seu login ainda não está ligado a uma empresa.", integrador_nao_configurado: "A integração ainda não foi ativada pela equipe DANOVA.",
    sem_contas: "Cadastre uma conta do Google Ads primeiro.", aguarde: "Os dados foram atualizados há menos de 10 minutos.", nao_autenticado: "Sua sessão expirou. Entre de novo." };

  async function chamar(A, corpo) {
    var r = await A.sb.functions.invoke("meta-integrador", { body: corpo });
    var e = r.data && r.data.erro;
    try { var j = r.error && r.error.context && await r.error.context.json(); if (j && j.erro) e = j.erro; } catch (x) {}
    if (r.error && !e) e = r.error.message || "falha";
    if (e) throw new Error(ERR[e] || e);
    return r.data;
  }
  function fmtId(v) { var d = String(v || "").replace(/\D/g, "").slice(0, 10); return d.length > 6 ? d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6) : d.length > 3 ? d.slice(0, 3) + "-" + d.slice(3) : d; }
  function n(v) { return Number(v || 0); }
  function moeda(v, m) { return (m === "USD" ? "US$ " : "R$ ") + n(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function int(v) { return Math.round(n(v)).toLocaleString("pt-BR"); }
  function quando(iso) { return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "ainda não"; }

  async function render(el, A) {
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    var admin = A.isAdmin();
    el.innerHTML = '<div class="gad"><p class="note">Carregando Google Ads…</p></div>';
    var r = await Promise.all([
      A.sb.from("contas_anuncio").select("id, conta_externa, nome, situacao, ultimo_erro, ultima_sync, moeda, conta_id").eq("plataforma", "google").eq("ativo", true).not("conta_externa", "like", "000-000-%").order("nome"),
      admin ? A.sb.from("contas").select("id, nome").order("nome") : Promise.resolve({ data: [] })
    ]);
    var contas = r[0].data || [], clientes = r[1].data || [];
    if (st.conta && !contas.some(function (c) { return c.id === st.conta; })) st.conta = "";
    var alvo = st.conta ? contas.filter(function (c) { return c.id === st.conta; }) : contas;
    var desde = new Date(Date.now() - (st.dias - 1) * 864e5).toISOString().slice(0, 10);
    var met = alvo.length ? ((await A.sb.from("campanhas_metricas").select("data, conta_anuncio, campanha, impressoes, cliques, custo, moeda, conversoes, valor_conversoes")
      .eq("plataforma", "google").in("conta_anuncio", alvo.map(function (c) { return c.conta_externa; })).gte("data", desde).order("data", { ascending: false }).limit(5000)).data || []) : [];
    var mo = (alvo[0] && alvo[0].moeda) || (met[0] && met[0].moeda) || "BRL";
    var tot = met.reduce(function (t, l) { t.custo += n(l.custo); t.imp += n(l.impressoes); t.cli += n(l.cliques); t.conv += n(l.conversoes); t.val += n(l.valor_conversoes); return t; }, { custo: 0, imp: 0, cli: 0, conv: 0, val: 0 });
    var porCamp = {};
    met.forEach(function (l) { var c = porCamp[l.campanha] || (porCamp[l.campanha] = { nome: l.campanha, custo: 0, imp: 0, cli: 0, conv: 0, ult: l.data }); c.custo += n(l.custo); c.imp += n(l.impressoes); c.cli += n(l.cliques); c.conv += n(l.conversoes); if (l.data > c.ult) c.ult = l.data; });
    var camps = Object.keys(porCamp).map(function (k) { return porCamp[k]; }).sort(function (a, b) { return b.custo - a.custo; });
    var situ = { conectada: ["Conectada", "ok"], aguardando: ["Aguardando dados", "esp"], erro: ["Sem acesso", "err"] };

    el.innerHTML = '<div class="gad">' +
      '<section class="card gad-add"><div><h3>Google Ads</h3><p class="note">Coloque o ID da conta do Google Ads e o CRM puxa as campanhas: investimento, impressões, cliques e conversões por dia. Atualiza sozinho às 6h40 e 18h40, ou na hora pelo botão.</p></div>' +
      '<form data-add><label>ID da conta<input name="id" placeholder="123-456-7890" inputmode="numeric" autocomplete="off" maxlength="12" required></label>' +
      (admin ? '<label>Cliente<select name="cliente"><option value="">Agência (DANOVA)</option>' + clientes.map(function (c) { return '<option value="' + c.id + '">' + A.esc(c.nome) + "</option>"; }).join("") + "</select></label>" : "") +
      '<button class="btn primary">Adicionar e puxar dados</button></form>' +
      '<p class="gad-dica">O ID fica no canto superior direito do Google Ads (ads.google.com), acima do nome da conta.</p></section>' +
      (contas.length ? '<section class="card"><div class="gad-h"><h3>Contas <small>' + contas.length + '</small></h3><button class="btn ghost small" data-atualizar>↻ Atualizar agora</button></div>' +
        contas.map(function (c) { var s = situ[c.situacao] || [c.situacao, ""]; return '<div class="gad-conta"><div><b>' + A.esc(c.nome) + '</b><small>' + A.esc(c.conta_externa) + " · atualizada " + quando(c.ultima_sync) + "</small>" + (c.ultimo_erro ? '<small class="gad-err">' + A.esc(c.ultimo_erro) + "</small>" : "") + '</div><span class="gad-st ' + s[1] + '">' + s[0] + "</span>" + (admin ? '<button class="btn ghost small" data-remover="' + c.id + '" title="Parar de acompanhar">✕</button>' : "") + "</div>"; }).join("") + "</section>" : "") +
      (contas.length ? '<section class="card"><div class="gad-h"><h3>Desempenho</h3><div class="gad-f">' +
        (contas.length > 1 ? '<select data-conta><option value="">Todas as contas</option>' + contas.map(function (c) { return '<option value="' + c.id + '"' + (st.conta === c.id ? " selected" : "") + ">" + A.esc(c.nome) + "</option>"; }).join("") + "</select>" : "") +
        '<select data-dias>' + [[7, "7 dias"], [14, "14 dias"], [30, "30 dias"], [90, "90 dias"]].map(function (d) { return '<option value="' + d[0] + '"' + (st.dias === d[0] ? " selected" : "") + ">" + d[1] + "</option>"; }).join("") + "</select></div></div>" +
        (met.length ? '<div class="gad-kpis">' +
          [["Investimento", moeda(tot.custo, mo)], ["Impressões", int(tot.imp)], ["Cliques", int(tot.cli)], ["CTR", tot.imp ? (tot.cli / tot.imp * 100).toFixed(2).replace(".", ",") + "%" : "—"], ["CPC médio", tot.cli ? moeda(tot.custo / tot.cli, mo) : "—"], ["Conversões", (Math.round(tot.conv * 10) / 10).toLocaleString("pt-BR")], ["Custo/conversão", tot.conv ? moeda(tot.custo / tot.conv, mo) : "—"]]
            .map(function (k) { return "<div><small>" + k[0] + "</small><b>" + k[1] + "</b></div>"; }).join("") + "</div>" +
          '<div class="table-wrap"><table><thead><tr><th>Campanha</th><th>Investimento</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>Conversões</th><th>Custo/conv.</th></tr></thead><tbody>' +
          camps.map(function (c) { return "<tr><td>" + A.esc(c.nome) + "</td><td>" + moeda(c.custo, mo) + "</td><td>" + int(c.imp) + "</td><td>" + int(c.cli) + "</td><td>" + (c.imp ? (c.cli / c.imp * 100).toFixed(2).replace(".", ",") + "%" : "—") + "</td><td>" + (Math.round(c.conv * 10) / 10).toLocaleString("pt-BR") + "</td><td>" + (c.conv ? moeda(c.custo / c.conv, mo) : "—") + "</td></tr>"; }).join("") +
          "</tbody></table></div>"
        : '<p class="note gad-vazio">Ainda sem dados neste período. Clique em <b>↻ Atualizar agora</b>; os números aparecem em até 1 minuto.</p>') + "</section>" : "") +
      "</div>";

    var f = el.querySelector("[data-add]");
    f.id.addEventListener("input", function () { f.id.value = fmtId(f.id.value); });
    f.addEventListener("submit", async function (e) {
      e.preventDefault(); var b = f.querySelector("button"), id = f.id.value.replace(/\D/g, "");
      if (id.length !== 10) return A.toast(ERR.id_invalido, true);
      b.disabled = true; b.textContent = "Adicionando…";
      var args = { p_id: id }; if (admin) args.p_cliente = f.cliente.value || null;
      var res = await A.sb.rpc("google_registrar_conta", args);
      if (res.error) { b.disabled = false; b.textContent = "Adicionar e puxar dados"; var m = res.error.message || ""; return A.toast(ERR[(m.match(/id_invalido|conta_de_outro_cliente|sem_conta_vinculada/) || [])[0]] || m, true); }
      try { await chamar(A, { acao: "disparar", plataforma: "google", conta: res.data.id, dias: 30 }); A.toast("Conta " + res.data.conta + " adicionada. Buscando os dados no Google Ads…"); }
      catch (x) { A.toast("Conta adicionada. " + x.message, true); }
      st.conta = res.data.id; render(el, A); setTimeout(function () { if (document.body.contains(el)) render(el, A); }, 45000);
    });
    var at = el.querySelector("[data-atualizar]");
    if (at) at.addEventListener("click", async function () {
      at.disabled = true; at.textContent = "Buscando…";
      try { await chamar(A, { acao: "disparar", plataforma: "google", conta: st.conta || undefined, dias: Math.max(st.dias, 3) }); A.toast("Pedido enviado ao Google Ads. Os números aparecem em até 1 minuto."); setTimeout(function () { if (document.body.contains(el)) render(el, A); }, 40000); }
      catch (x) { A.toast(x.message, true); }
      at.disabled = false; at.textContent = "↻ Atualizar agora";
    });
    el.querySelectorAll("[data-remover]").forEach(function (b) { b.addEventListener("click", async function () {
      if (!confirm("Parar de acompanhar esta conta do Google Ads? Os dados já importados continuam salvos.")) return;
      var res = await A.sb.from("contas_anuncio").update({ ativo: false }).eq("id", b.dataset.remover);
      if (res.error) return A.falha(res.error); A.toast("Conta removida do acompanhamento."); render(el, A);
    }); });
    var sc = el.querySelector("[data-conta]"); if (sc) sc.addEventListener("change", function () { st.conta = sc.value; render(el, A); });
    var sd = el.querySelector("[data-dias]"); if (sd) sd.addEventListener("change", function () { st.dias = +sd.value; render(el, A); });
    // enquanto a tela estiver aberta, recarrega os números a cada 2 minutos
    st.timer = setInterval(function () { if (!document.body.contains(el)) { clearInterval(st.timer); st.timer = null; return; } if (!el.querySelector("input:focus, select:focus")) render(el, A); }, 120000);
  }

  D.modulos.push({ id: "google-ads", titulo: "Google Ads", tituloLongo: "Google Ads · campanhas", icone: "G", papeis: ["admin", "construtora"], render: function (el, A) { render(el, A).catch(function (x) { el.innerHTML = '<div class="card"><p class="note">Não foi possível carregar (' + A.esc(x.message || x) + ").</p></div>"; }); } });
})();
