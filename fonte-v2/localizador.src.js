/* danova AI — Localizador de empreendimentos (substitui o globo do topo) */
(function () {
  "use strict";
  var raiz = document.getElementById("locCard");
  if (!raiz) return;

  // Contorno do Sul da Flórida (Natural Earth 1:10m, projeção Mercator) e posições no mesmo sistema
  var MAPA_D = "__MAPA_D__";
  var PINOS = {
    miami: { x: 239, y: 432, nome: "Miami · Brickell · Downtown" },
    continuum: { x: 252.8, y: 401.3, nome: "North Bay Village" },
    turnberry: { x: 224, y: 315.9, nome: "Davie" },
    wpb: { x: 288.6, y: 54.3, nome: "West Palm Beach" }
  };
  var CIDADES = [["West Palm Beach", 290, 56], ["Boca Raton", 272, 197], ["Fort Lauderdale", 257, 293], ["Miami Beach", 268, 418], ["Miami", 228, 452]];

  // preco em US$ (a partir de); null = sob consulta
  var P = [
    { id: "domus-brickell-park", n: "Domus Brickell Park", loc: "Brickell", preco: 650000, reg: "brickell", obj: ["investir", "renda", "morar"], img: "img/domus.webp", pino: "miami", tag: "Mobiliado · entrega 2026" },
    { id: "melia-brickell", n: "Meliá Brickell", loc: "Brickell", preco: 500000, reg: "brickell", obj: ["investir", "renda"], img: "img/melia.webp", pino: "miami", tag: "Condo-hotel · gestão Meliá" },
    { id: "the-residences-at-1428-brickell", n: "The Residences at 1428 Brickell", loc: "Brickell", preco: 2900000, reg: "brickell", obj: ["morar", "investir"], img: "img/1428-brickell.webp", pino: "miami", tag: "Ultra-luxo · 70 andares" },
    { id: "casa-bella-residences-by-b-b-italia", n: "Casa Bella by B&B Italia", loc: "Downtown", preco: 1500000, reg: "brickell", obj: ["morar", "investir"], img: "img/casabella.webp", pino: "miami", tag: "Branded · entrega 2027" },
    { id: "nobu-residences-brickell", n: "Nobu Residences Brickell", loc: "Brickell", preco: 2100000, reg: "brickell", obj: ["morar", "investir"], img: "img/nobu-brickell.webp", pino: "miami", tag: "Branded · frente para a baía" },
    { id: "faena-residences-miami", n: "Faena Residences Miami", loc: "Miami River", preco: 1300000, reg: "brickell", obj: ["morar", "investir"], img: "img/faena.webp", pino: "miami", tag: "Branded · pré-construção" },
    { id: "the-residences-at-mandarin-oriental-miami", n: "Mandarin Oriental, Miami", loc: "Brickell Key", preco: 3900000, reg: "brickell", obj: ["morar", "familia"], img: "img/mandarin-miami.webp", pino: "miami", tag: "Branded · ilha privada" },
    { id: "continuum-club-residences", n: "Continuum Club & Residences", loc: "North Bay Village", preco: 1400000, reg: "beach", obj: ["morar", "familia", "investir"], img: "img/continuum.webp", pino: "continuum", tag: "Waterfront · 1 a 4 quartos" },
    { id: "mandarin-oriental-residences-west-palm-beach", n: "Mandarin Oriental West Palm Beach", loc: "West Palm Beach", preco: null, reg: "palm", obj: ["morar", "familia"], img: "img/mandarin-wpb.webp", pino: "wpb", tag: "Branded · preço sob consulta" },
    { id: "estates-by-turnberry", n: "Estates by Turnberry", loc: "Davie", preco: 1700000, reg: "broward", obj: ["familia", "morar"], img: "img/turnberry.webp", pino: "turnberry", tag: "Casas · condomínio fechado" }
  ];
  var ORC = [500000, 750000, 1000000, 1500000, 2000000, 3000000, 4000000, 6000000];
  var OBJ = [["morar", "Morar"], ["investir", "Investir"], ["renda", "Renda com aluguel"], ["familia", "Família / casa"]];
  var REG = [["todas", "Todas"], ["brickell", "Brickell e Downtown"], ["beach", "Miami Beach"], ["broward", "Broward"], ["palm", "Palm Beach"]];
  var S = { orc: 3, obj: "investir", reg: "todas" };

  function fmt(v) { return v >= 1000000 ? "US$ " + (v / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi" : "US$ " + Math.round(v / 1000) + " mil"; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Pesos: orçamento 40 (20 se até 20% acima ou sob consulta), objetivo 35, região 25.
  // "Combina" = 80 pontos ou mais, ou seja: objetivo e região certos, com orçamento dentro ou quase.
  function pontuar(p) {
    var orc = ORC[S.orc], ultimo = S.orc === ORC.length - 1, pts = 0, motivo;
    if (p.preco == null) { pts += 20; motivo = "preço sob consulta"; }
    else if (p.preco <= orc || ultimo) { pts += 40; motivo = "dentro do orçamento"; }
    else if (p.preco <= orc * 1.2) { pts += 20; motivo = "pouco acima do orçamento"; }
    else motivo = "acima do orçamento";
    if (p.obj.indexOf(S.obj) >= 0) pts += 35;
    if (S.reg === "todas" || S.reg === p.reg) pts += 25;
    return { p: p, pts: pts, motivo: motivo };
  }

  raiz.innerHTML =
    '<div class="loc-head"><div><h2 class="loc-title">Localizador de empreendimentos</h2><p>Escolha e veja na hora o que combina com você.</p></div><span class="loc-count" id="locCount"></span></div>' +
    '<div class="loc-filters">' +
    '<label class="loc-range"><span>Orçamento até <b id="locOrcTxt"></b></span><input type="range" id="locOrc" min="0" max="' + (ORC.length - 1) + '" step="1" value="' + S.orc + '" aria-label="Orçamento máximo"></label>' +
    '<div class="loc-group" role="group" aria-label="Objetivo"><span>Objetivo</span><div>' + OBJ.map(function (o) { return '<button type="button" data-obj="' + o[0] + '">' + o[1] + "</button>"; }).join("") + "</div></div>" +
    '<div class="loc-group" role="group" aria-label="Região"><span>Região</span><div>' + REG.map(function (r) { return '<button type="button" data-reg="' + r[0] + '">' + r[1] + "</button>"; }).join("") + "</div></div>" +
    "</div>" +
    '<div class="loc-body">' +
    '<svg class="loc-map" viewBox="150 20 175 470" role="img" aria-label="Mapa do Sul da Flórida com os empreendimentos"><defs><linearGradient id="locLand" x1="0" x2="1"><stop offset="0" stop-color="#16223a"/><stop offset="1" stop-color="#1d2c48"/></linearGradient></defs>' +
    '<rect x="150" y="20" width="175" height="470" fill="#0c1a2e"/><path d="' + MAPA_D + '" fill="url(#locLand)" stroke="#3ec5f0" stroke-opacity=".55" stroke-width=".9"/>' +
    CIDADES.map(function (c) { return '<text x="' + (c[1] - 6) + '" y="' + c[2] + '" text-anchor="end" class="loc-city">' + c[0] + "</text>"; }).join("") +
    Object.keys(PINOS).map(function (k) { var p = PINOS[k]; return '<g class="loc-pin" data-pino="' + k + '" transform="translate(' + p.x + " " + p.y + ')"><circle class="loc-pulse" r="9"/><circle class="loc-dot" r="5"/><text class="loc-n" y="3.5">0</text><title>' + p.nome + "</title></g>"; }).join("") +
    "</svg>" +
    '<ol class="loc-results" id="locResults" aria-live="polite"></ol>' +
    "</div>" +
    '<div class="loc-foot"><button type="button" class="btn btn-primary" id="locEnviar">Receber esta seleção ↗</button><a href="#empreendimentos">Ver todos os 10 ↓</a></div>';

  var $ = function (s) { return raiz.querySelector(s); };
  var rangeEl = $("#locOrc");

  function render() {
    $("#locOrcTxt").textContent = S.orc === ORC.length - 1 ? fmt(ORC[ORC.length - 2]) + "+" : fmt(ORC[S.orc]);
    var pct = S.orc / (ORC.length - 1) * 100;
    rangeEl.style.background = "linear-gradient(90deg,#3ec5f0,#6b3fd4 " + pct * .6 + "%,#ec3d8f " + pct + "%,#e3e8ef " + pct + "%)";
    Array.prototype.forEach.call(raiz.querySelectorAll("[data-obj]"), function (b) { b.classList.toggle("on", b.dataset.obj === S.obj); b.setAttribute("aria-pressed", b.dataset.obj === S.obj); });
    Array.prototype.forEach.call(raiz.querySelectorAll("[data-reg]"), function (b) { b.classList.toggle("on", b.dataset.reg === S.reg); b.setAttribute("aria-pressed", b.dataset.reg === S.reg); });

    var lista = P.map(pontuar).sort(function (a, b) { return b.pts - a.pts || (b.p.preco || 0) - (a.p.preco || 0); });
    var combinam = lista.filter(function (r) { return r.pts >= 80; });
    $("#locCount").innerHTML = "<b>" + combinam.length + "</b> de 10 combinam";
    var por = {}; combinam.forEach(function (r) { por[r.p.pino] = (por[r.p.pino] || 0) + 1; });
    Array.prototype.forEach.call(raiz.querySelectorAll(".loc-pin"), function (g) {
      var n = por[g.dataset.pino] || 0;
      g.classList.toggle("on", n > 0); g.querySelector(".loc-n").textContent = n || "";
    });
    var top = (combinam.length ? combinam : lista).slice(0, 3);
    $("#locResults").innerHTML = top.map(function (r, i) {
      var p = r.p;
      return '<li data-pino="' + p.pino + '" style="animation-delay:' + i * 60 + 'ms"><img src="' + p.img + '" alt="" loading="lazy"><div><strong>' + esc(p.n) + "</strong><small>" + esc(p.loc) + " · " + esc(p.tag) + '</small><span class="loc-price">' + (p.preco ? "a partir de " + fmt(p.preco) : "preço sob consulta") + '</span><span class="loc-match"><i style="width:' + r.pts + '%"></i></span><em>' + r.pts + "% compatível · " + r.motivo + '</em></div><a href="#' + p.id + '" class="loc-ver" data-ver="' + p.id + '" aria-label="Ver ' + esc(p.n) + '">→</a></li>';
    }).join("") + (combinam.length ? "" : '<li class="loc-vazio">Nenhum combina 100% — estes são os mais próximos. Aumente o orçamento ou troque a região.</li>');
    Array.prototype.forEach.call(raiz.querySelectorAll("#locResults li[data-pino]"), function (li) {
      li.addEventListener("mouseenter", function () { var g = raiz.querySelector('.loc-pin[data-pino="' + li.dataset.pino + '"]'); if (g) g.classList.add("hl"); });
      li.addEventListener("mouseleave", function () { Array.prototype.forEach.call(raiz.querySelectorAll(".loc-pin.hl"), function (g) { g.classList.remove("hl"); }); });
    });
    S.top = top.map(function (r) { return r.p.n; });
  }

  var timer;
  function medir() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (window.dataLayer) window.dataLayer.push({ event: "localizador_busca", orcamento: ORC[S.orc], objetivo: S.obj, regiao: S.reg, resultados: (S.top || []).join(" | ") });
    }, 800);
  }
  rangeEl.addEventListener("input", function () { S.orc = +rangeEl.value; render(); medir(); });
  raiz.addEventListener("click", function (e) {
    var b = e.target.closest("button, a");
    if (!b) return;
    if (b.dataset.obj) { S.obj = b.dataset.obj; render(); medir(); }
    else if (b.dataset.reg) { S.reg = b.dataset.reg; render(); medir(); }
    else if (b.dataset.ver) {
      e.preventDefault();
      var alvo = document.getElementById(b.dataset.ver);
      var todos = document.querySelector('.filter-btn[data-filter="todos"]'); if (todos) todos.click();
      if (alvo) { alvo.scrollIntoView({ behavior: "smooth", block: "center" }); alvo.classList.remove("flash"); void alvo.offsetWidth; alvo.classList.add("flash"); }
    } else if (b.id === "locEnviar") {
      var orcTxt = $("#locOrcTxt").textContent;
      var objTxt = OBJ.filter(function (o) { return o[0] === S.obj; })[0][1];
      var msg = "Quero receber plantas e preços desta seleção: " + (S.top || []).join(", ") + ". Orçamento até " + orcTxt + ", objetivo: " + objTxt.toLowerCase() + ".";
      if (window.dataLayer) window.dataLayer.push({ event: "localizador_enviar", orcamento: ORC[S.orc], objetivo: S.obj, regiao: S.reg });
      if (window.danovaAbrirChat) { window.danovaAbrirChat(msg); return; }
      var sel = document.getElementById("project"), notas = document.getElementById("notes");
      if (sel && S.top && S.top[0]) Array.prototype.forEach.call(sel.options, function (o) { if (S.top[0] && o.text.indexOf(S.top[0].split(" ")[0]) === 0) sel.value = o.value; });
      if (notas) notas.value = msg;
      var c = document.getElementById("contato"); if (c) c.scrollIntoView({ behavior: "smooth" });
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-focar-localizador]"), function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); document.getElementById("localizador").scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(function () { rangeEl.focus({ preventScroll: true }); }, 500); });
  });
  render();
})();
