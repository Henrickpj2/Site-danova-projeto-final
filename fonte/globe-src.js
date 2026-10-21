/* danova AI — globo interativo: rotas de investimento América Latina/Europa → Sul da Flórida */
(function () {
  "use strict";
  var stage = document.getElementById("globeStage");
  var canvas = document.getElementById("globe");
  if (!stage || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var DOTS = window.DANOVA_GLOBE_DOTS || [];
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var D2R = Math.PI / 180;

  var ORIGINS = [
    { code: "SP", name: "São Paulo", ll: [-46.63, -23.55] },
    { code: "RJ", name: "Rio de Janeiro", ll: [-43.17, -22.91] },
    { code: "BSB", name: "Brasília", ll: [-47.88, -15.79] },
    { code: "BA", name: "Buenos Aires", ll: [-58.38, -34.6] },
    { code: "BOG", name: "Bogotá", ll: [-74.07, 4.71] },
    { code: "CDMX", name: "Cidade do México", ll: [-99.13, 19.43] },
    { code: "LIS", name: "Lisboa", ll: [-9.14, 38.72] }
  ];
  // coordenadas aproximadas de cada empreendimento
  var PROJECTS = [
    { n: "Domus Brickell Park", loc: "Brickell · Miami", p: "US$ 650 mil", img: "img/domus.webp", ll: [-80.198, 25.757], v: 0.65 },
    { n: "Faena Residences Miami", loc: "Miami River", p: "US$ 1,3 mi", img: "img/faena.webp", ll: [-80.205, 25.772], v: 1.3 },
    { n: "Meliá Brickell", loc: "Brickell · Miami", p: "US$ 500 mil", img: "img/melia.webp", ll: [-80.2, 25.764], v: 0.5 },
    { n: "Continuum Club & Residences", loc: "North Bay Village", p: "US$ 1,4 mi", img: "img/continuum.webp", ll: [-80.153, 25.848], v: 1.4 },
    { n: "The Residences at 1428 Brickell", loc: "Brickell · Miami", p: "US$ 2,9 mi", img: "img/1428-brickell.webp", ll: [-80.192, 25.758], v: 2.9 },
    { n: "Mandarin Oriental Residences", loc: "West Palm Beach", p: "sob consulta", img: "img/mandarin-wpb.webp", ll: [-80.053, 26.715], v: 2.5 },
    { n: "Casa Bella by B&B Italia", loc: "Downtown · Miami", p: "US$ 1,5 mi", img: "img/casabella.webp", ll: [-80.188, 25.789], v: 1.5 },
    { n: "Estates by Turnberry", loc: "Davie · Flórida", p: "US$ 1,7 mi", img: "img/turnberry.webp", ll: [-80.233, 26.062], v: 1.7 },
    { n: "Nobu Residences Brickell", loc: "Brickell · Miami", p: "US$ 2,1 mi", img: "img/nobu-brickell.webp", ll: [-80.189, 25.767], v: 2.1 },
    { n: "Mandarin Oriental, Miami", loc: "Brickell Key · Miami", p: "US$ 3,9 mi", img: "img/mandarin-miami.webp", ll: [-80.185, 25.768], v: 3.9 }
  ];
  var GRAD = ["#3ec5f0", "#6b3fd4", "#ec3d8f", "#f7a24a"];

  // ---------- geometria ----------
  function toVec(ll) { var l = ll[0] * D2R, p = ll[1] * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; }
  function slerp(a, b, t) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2], om = Math.acos(Math.max(-1, Math.min(1, d))), so = Math.sin(om) || 1;
    var k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }
  function lerpColor(t) {
    t = Math.max(0, Math.min(0.999, t)) * (GRAD.length - 1);
    var i = Math.floor(t), f = t - i, a = hex(GRAD[i]), b = hex(GRAD[i + 1]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function hex(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function rgba(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a.toFixed(3) + ")"; }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function angDiff(a, b) { var d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }

  var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  var lam = -62 * D2R, phi = 6 * D2R, tilt = 0;
  var cl, sl, cp, sp;
  function setView() { cl = Math.cos(-lam); sl = Math.sin(-lam); cp = Math.cos(phi); sp = Math.sin(phi); }
  function proj(v, scale) {
    var x1 = v[0] * cl - v[1] * sl, y1 = v[0] * sl + v[1] * cl, z1 = v[2];
    var depth = x1 * cp + z1 * sp, up = -x1 * sp + z1 * cp, k = R * (scale || 1);
    return { x: cx + y1 * k, y: cy - up * k, d: depth, r2: y1 * y1 + up * up };
  }
  function vis(p) { return p.d > 0 || p.r2 > 1.0005; }

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.40; cx = W / 2; cy = H * 0.47;
  }

  var dotVecs = [];
  for (var i = 0; i < DOTS.length; i += 2) dotVecs.push(toVec([DOTS[i], DOTS[i + 1]]));
  var grat = [];
  for (var la = -60; la <= 60; la += 30) { var row = []; for (var lo = -180; lo <= 180; lo += 4) row.push(toVec([lo, la])); grat.push(row); }
  for (var lo2 = -180; lo2 < 180; lo2 += 30) { var col = []; for (var la2 = -80; la2 <= 80; la2 += 4) col.push(toVec([lo2, la2])); grat.push(col); }

  var MIAMI = toVec([-80.19, 25.77]);
  function buildArc(fromLL, toV) {
    var a = toVec(fromLL), pts = [];
    var dist = Math.acos(a[0] * toV[0] + a[1] * toV[1] + a[2] * toV[2]), lift = 0.06 + dist * 0.2;
    for (var s = 0; s <= 80; s++) { var t = s / 80, v = slerp(a, toV, t), h = 1 + lift * Math.sin(Math.PI * t); pts.push([v[0] * h, v[1] * h, v[2] * h]); }
    return pts;
  }
  var arcs = ORIGINS.map(function (o) { return buildArc(o.ll, MIAMI); });
  PROJECTS.forEach(function (p) { p.vec = toVec(p.ll); });
  ORIGINS.forEach(function (o) { o.vec = toVec(o.ll); });

  // ---------- estado da narrativa ----------
  var CYCLE = 7000;
  var origin = 0, proj_i = 0, cycleStart = 0, lastArrival = -1;
  var targetLam = lam, targetPhi = phi, fromLam = lam, fromPhi = phi;
  var dragging = false, holdUntil = 0, vel = 0, lastX = 0, lastY = 0, interacted = false;
  var ripples = [];

  function viewFor(o) {
    var a = o.ll, mid = [(a[0] + -80.19) / 2, (a[1] + 25.77) / 2];
    return [mid[0] * D2R, Math.max(-10, Math.min(28, mid[1] + 4)) * D2R];
  }
  function startCycle(now) {
    cycleStart = now; lastArrival = -1;
    var v = viewFor(ORIGINS[origin]);
    fromLam = lam; fromPhi = phi; targetLam = lam + angDiff(lam, v[0]); targetPhi = v[1];
    hideCard();
    updateOriginButtons();
  }

  // ---------- UI ----------
  var card = document.getElementById("spotCard"), feed = document.getElementById("routeFeed");
  var bar = document.getElementById("originBar"), hint = document.getElementById("dragHint");
  function hideCard() { if (card) card.classList.remove("show"); }
  function showCard(p) {
    if (!card) return;
    var img = card.querySelector("img"); img.src = p.img; img.alt = p.n;
    document.getElementById("spotLoc").textContent = p.loc;
    document.getElementById("spotName").textContent = p.n;
    document.getElementById("spotPrice").textContent = p.p === "sob consulta" ? "preço sob consulta" : "a partir de " + p.p;
    card.classList.add("show");
  }
  function pushFeed(o, p) {
    if (!feed) return;
    var li = document.createElement("li");
    li.innerHTML = "<span></span><i>→</i><em></em>";
    li.querySelector("span").textContent = o.name;
    li.querySelector("em").textContent = p.n;
    li.querySelector("em").style.fontStyle = "normal";
    feed.insertBefore(li, feed.firstChild);
    while (feed.children.length > 3) feed.removeChild(feed.lastChild);
  }
  if (bar) {
    ORIGINS.forEach(function (o, idx) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "origin-btn"; b.innerHTML = "<i></i>" + o.name;
      b.addEventListener("click", function () { origin = idx; proj_i = (proj_i + 1) % PROJECTS.length; holdUntil = 0; startCycle(performance.now()); kick(); });
      bar.appendChild(b);
    });
  }
  function updateOriginButtons() { if (!bar) return; Array.prototype.forEach.call(bar.children, function (b, i) { b.classList.toggle("active", i === origin); b.setAttribute("aria-pressed", i === origin); }); }

  // arrastar para girar
  stage.addEventListener("pointerdown", function (e) {
    if (e.target.closest && e.target.closest("a,button")) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY; vel = 0;
    stage.classList.add("dragging"); stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
    if (!interacted && hint) { interacted = true; hint.style.opacity = "0"; }
  });
  stage.addEventListener("pointermove", function (e) {
    if (dragging) {
      var dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      vel = -dx / R; lam += vel; phi = Math.max(-60 * D2R, Math.min(60 * D2R, phi + dy / R));
      holdUntil = performance.now() + 3500; kick();
    } else if (e.pointerType === "mouse") {
      var r = stage.getBoundingClientRect(); tilt = ((e.clientX - r.left) / r.width - .5) * 2;
    }
  });
  function endDrag() { if (!dragging) return; dragging = false; stage.classList.remove("dragging"); }
  stage.addEventListener("pointerup", endDrag); stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("pointerleave", function () { tilt = 0; });

  // ---------- desenho ----------
  function draw(now) {
    var ct = (now - cycleStart) / CYCLE;
    if (ct >= 1 && !reduce) { origin = (origin + 1) % ORIGINS.length; proj_i = (proj_i + 1) % PROJECTS.length; startCycle(now); ct = 0; }

    // câmera
    if (dragging) { /* controlado pelo usuário */ }
    else if (holdUntil && now < holdUntil) { lam += vel; vel *= 0.94; }
    else if (holdUntil) { holdUntil = 0; startCycle(now); ct = 0; }
    else if (reduce) { lam = targetLam; phi = targetPhi; }
    else {
      var k = ease(Math.min(1, ct / 0.22));
      lam = fromLam + (targetLam - fromLam) * k + Math.sin(now / 4000) * 0.02 + tilt * 0.05 * k;
      phi = fromPhi + (targetPhi - fromPhi) * k;
    }
    setView();

    ctx.clearRect(0, 0, W, H);

    // anel orbital (parte de trás)
    var ringA = now / 9000;
    drawRing(ringA, false);

    // esfera
    var g = ctx.createRadialGradient(cx - R * .4, cy - R * .45, R * .05, cx, cy, R * 1.02);
    g.addColorStop(0, "#1b1840"); g.addColorStop(.55, "#0b0b1d"); g.addColorStop(1, "#040510");
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    var rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, "rgba(62,197,240,.55)"); rim.addColorStop(.5, "rgba(107,63,212,.35)"); rim.addColorStop(1, "rgba(247,162,74,.45)");
    ctx.strokeStyle = rim; ctx.lineWidth = 1.2; ctx.stroke();

    // graticule
    ctx.strokeStyle = "rgba(143,160,181,.08)"; ctx.lineWidth = 1;
    for (var gi = 0; gi < grat.length; gi++) {
      ctx.beginPath(); var on = false;
      for (var gj = 0; gj < grat[gi].length; gj++) { var q = proj(grat[gi][gj]); if (q.d <= 0) { on = false; continue; } if (!on) { ctx.moveTo(q.x, q.y); on = true; } else ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }

    // terra — pontos com tom que varia levemente por latitude (gradiente da marca)
    var ds = Math.max(1.1, R / 160);
    for (var i = 0; i < dotVecs.length; i++) {
      var p = proj(dotVecs[i]); if (p.d <= 0.1) continue;
      var shade = 0.15 + 0.85 * p.d * p.d;
      ctx.fillStyle = "rgba(226,232,255," + shade.toFixed(3) + ")";
      ctx.fillRect(p.x - ds / 2, p.y - ds / 2, ds, ds);
    }

    // rotas secundárias: tracejado fino + partículas
    for (var a = 0; a < arcs.length; a++) {
      if (a === origin) continue;
      strokeArc(arcs[a], 0, 1, 0.22, 1, [2, 6], now);
      if (!reduce) for (var pi = 0; pi < 2; pi++) particle(arcs[a], ((now / 5200) + pi / 2 + a * 0.13) % 1, 1.6, 0.6);
    }

    // rota ativa: desenho progressivo
    var travel = reduce ? 1 : Math.max(0, Math.min(1, (ct - 0.2) / 0.38));
    var act = arcs[origin];
    strokeArc(act, 0, 1, 0.18, 1.2, [3, 5], now);
    if (travel > 0) strokeArc(act, 0, travel, 1, 2.4, null, now);
    if (travel > 0 && travel < 1) particle(act, travel, 4.2, 1, true);

    // chegada
    var arrived = travel >= 1;
    if (arrived && lastArrival !== cycleStart) {
      lastArrival = cycleStart; ripples.push({ t: now });
      showCard(PROJECTS[proj_i]); pushFeed(ORIGINS[origin], PROJECTS[proj_i]);
    }

    // pinos de origem
    for (var o = 0; o < ORIGINS.length; o++) {
      var op = proj(ORIGINS[o].vec); if (op.d <= 0) continue;
      var on2 = o === origin;
      ctx.beginPath(); ctx.arc(op.x, op.y, on2 ? 4.5 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = on2 ? "#3ec5f0" : "rgba(62,197,240,.6)"; ctx.fill();
      if (on2) { ctx.beginPath(); ctx.arc(op.x, op.y, 8 + Math.sin(now / 300) * 2, 0, Math.PI * 2); ctx.strokeStyle = "rgba(62,197,240,.45)"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.font = "700 11px DM Sans, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillText(ORIGINS[o].name, op.x + 10, op.y + 4); }
    }

    // skyline de luz sobre Miami: uma barra por empreendimento, altura proporcional ao preço
    var mp0 = proj(MIAMI);
    if (mp0.d > 0.05) {
      var bw = Math.max(2.2, R / 95), gap = bw * 0.7, total = PROJECTS.length * (bw + gap) - gap;
      for (var b = 0; b < PROJECTS.length; b++) {
        var pr = PROJECTS[b], active = b === proj_i && arrived;
        var hh = (10 + pr.v * R / 26) * (reduce ? 1 : (0.9 + 0.1 * Math.sin(now / 500 + b * 1.7))) * (active ? 1.15 : 1);
        var bx = mp0.x - total / 2 + b * (bw + gap), by = mp0.y - 2;
        var lg = ctx.createLinearGradient(0, by, 0, by - hh);
        if (active) { lg.addColorStop(0, "rgba(247,162,74,1)"); lg.addColorStop(1, "rgba(236,61,143,.15)"); }
        else { lg.addColorStop(0, "rgba(236,61,143,.85)"); lg.addColorStop(1, "rgba(62,197,240,.08)"); }
        ctx.fillStyle = lg; ctx.fillRect(bx, by - hh, bw, hh);
        if (active) { ctx.fillStyle = "#fff"; ctx.fillRect(bx, by - hh - 2, bw, 2); }
      }
    }
    var mp = proj(MIAMI);
    if (mp.d > 0) {
      ctx.beginPath(); ctx.arc(mp.x, mp.y, 5, 0, Math.PI * 2); ctx.fillStyle = "#f7a24a"; ctx.shadowColor = "#ec3d8f"; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0;
    }
    // ondas de chegada
    ripples = ripples.filter(function (r) { return now - r.t < 1600; });
    ripples.forEach(function (r) {
      var k = (now - r.t) / 1600; if (mp.d <= 0) return;
      ctx.beginPath(); ctx.ellipse(mp.x, mp.y, 6 + k * 46, (6 + k * 46) * 0.6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(247,162,74," + (0.8 * (1 - k)).toFixed(3) + ")"; ctx.lineWidth = 2; ctx.stroke();
    });

    drawRing(ringA, true);

    // cartão preso ao ponto de Miami, com linha-guia
    if (card && card.classList.contains("show") && mp.d > 0) {
      var cw = card.offsetWidth, ch = card.offsetHeight;
      var left = mp.x + 34, topY = mp.y - ch - 34, right = true;
      if (left + cw > W - 4) { left = mp.x - cw - 34; right = false; }
      if (topY < 4) topY = mp.y + 30;
      if (W < 460) { left = W - cw - 2; topY = H - ch - 2; right = true; } // telas estreitas: cartão no canto inferior
      left = Math.max(4, Math.min(W - cw - 4, left));
      card.style.left = left + "px"; card.style.top = topY + "px";
      var ax = right ? left : left + cw, ay = topY + ch / 2;
      ctx.beginPath(); ctx.moveTo(mp.x, mp.y); ctx.lineTo(ax + (right ? -14 : 14), mp.y < ay ? ay : ay); ctx.lineTo(ax, ay);
      ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
    } else if (card && mp.d <= 0) { card.classList.remove("show"); }
  }

  function strokeArc(pts, t0, t1, alpha, width, dash, now) {
    var n = pts.length - 1, s0 = Math.floor(t0 * n), s1 = Math.ceil(t1 * n);
    ctx.lineWidth = width; ctx.lineCap = "round";
    if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = reduce ? 0 : -now / 50; }
    for (var s = s0; s < s1; s++) {
      var a = proj(pts[s]), b = proj(pts[s + 1]); if (!vis(a) || !vis(b)) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = rgba(lerpColor(s / n), alpha); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  function particle(pts, t, r, alpha, glow) {
    var n = pts.length - 1, idx = Math.min(n, Math.floor(t * n)), p = proj(pts[idx]); if (!vis(p)) return;
    var c = lerpColor(t);
    if (glow) { ctx.shadowColor = rgba(c, 1); ctx.shadowBlur = 18; }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = glow ? "#fff" : rgba(c, alpha); ctx.fill();
    ctx.shadowBlur = 0;
    if (glow) for (var k = 1; k <= 6; k++) {
      var q = proj(pts[Math.max(0, idx - k * 2)]); if (!vis(q)) continue;
      ctx.beginPath(); ctx.arc(q.x, q.y, r * (1 - k / 7), 0, Math.PI * 2); ctx.fillStyle = rgba(c, 0.5 * (1 - k / 7)); ctx.fill();
    }
  }
  // anel inclinado com marcadores — metade atrás, metade à frente da esfera
  function drawRing(a, front) {
    var rx = R * 1.22, ry = R * 0.26, rot = -0.32;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : 2 * Math.PI);
    ctx.strokeStyle = front ? "rgba(143,217,255,.35)" : "rgba(143,217,255,.12)"; ctx.lineWidth = 1; ctx.stroke();
    for (var k = 0; k < 3; k++) {
      var ang = (a * Math.PI * 2 + k * 2.1) % (Math.PI * 2), isFront = Math.sin(ang) > 0;
      if (isFront !== front) continue;
      var x = Math.cos(ang) * rx, y = Math.sin(ang) * ry;
      ctx.beginPath(); ctx.arc(x, y, front ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = k === 0 ? "#f7a24a" : (k === 1 ? "#3ec5f0" : "#ec3d8f"); ctx.globalAlpha = front ? 1 : .4; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---------- laço ----------
  var running = true, rafOn = false;
  function frame(now) { rafOn = false; draw(now); if (running && !reduce) { rafOn = true; requestAnimationFrame(frame); } }
  function kick() { if (!rafOn) { rafOn = true; requestAnimationFrame(frame); } }
  resize(); setView();
  window.addEventListener("resize", function () { resize(); kick(); });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { running = es[0].isIntersecting; if (running) kick(); }).observe(stage);
  startCycle(performance.now());
  if (reduce) { showCard(PROJECTS[0]); pushFeed(ORIGINS[0], PROJECTS[0]); }
  kick();
})();
