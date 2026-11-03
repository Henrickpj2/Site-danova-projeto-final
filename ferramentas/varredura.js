// Varredura do site no ar: páginas, links, arquivos que falham, erros de console, layout no celular,
// cabeçalhos de segurança e arquivos que não deveriam estar públicos. Não envia formulários.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'https://danova-ai.com';
(async () => {
  const b = await chromium.launch();
  const vistos = new Set(), fila = ['/', '/crm/', '/livro.html', '/politica-de-privacidade.html', '/termos-de-uso.html'];
  const problemas = [], externos = new Set();
  while (fila.length && vistos.size < 40) {
    const path = fila.shift(); if (vistos.has(path)) continue; vistos.add(path);
    for (const vp of [{ width: 1366, height: 900, n: 'desktop' }, { width: 390, height: 844, n: 'celular' }]) {
      const p = await b.newPage({ viewport: vp }); const erros = [], falhas = [];
      p.on('pageerror', e => erros.push(e.message));
      p.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); });
      p.on('requestfailed', r => { const u = r.url(); if (!/google|facebook|doubleclick|analytics/.test(u)) falhas.push('FALHOU ' + u + ' ' + (r.failure() || {}).errorText); });
      p.on('response', r => { if (r.status() >= 400 && !/google|facebook/.test(r.url())) falhas.push(r.status() + ' ' + r.url()); });
      let st = 0; try { const r = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 }); st = r ? r.status() : 0; } catch (e) { problemas.push(`${path} [${vp.n}] não carregou: ${e.message.slice(0, 120)}`); await p.close(); continue; }
      await p.waitForTimeout(1500);
      const info = await p.evaluate(() => ({
        titulo: document.title, rolagemLateral: document.documentElement.scrollWidth > innerWidth + 2,
        links: [...document.querySelectorAll('a[href]')].map(a => a.href),
        imgsQuebradas: [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src).map(i => i.src),
        formularios: document.forms.length
      }));
      console.log(`${st} ${path} [${vp.n}] "${info.titulo.slice(0, 60)}" forms=${info.formularios}`);
      if (st >= 400) problemas.push(`${path} respondeu ${st}`);
      if (info.rolagemLateral) problemas.push(`${path} [${vp.n}] tem rolagem lateral`);
      info.imgsQuebradas.forEach(s => problemas.push(`${path} imagem quebrada ${s}`));
      [...new Set(erros)].forEach(e => problemas.push(`${path} [${vp.n}] erro JS: ${e}`));
      [...new Set(falhas)].forEach(f => problemas.push(`${path} [${vp.n}] ${f}`));
      if (vp.n === 'desktop') info.links.forEach(h => { try { const u = new URL(h); if (u.origin === new URL(BASE).origin) { const q = u.pathname; if (!vistos.has(q) && !/\.(pdf|jpg|png|webp|zip)$/.test(q)) fila.push(q); } else if (/^https?:/.test(u.protocol)) externos.add(u.origin + u.pathname); } catch (e) {} });
      await p.close();
    }
  }
  // links externos
  for (const u of [...externos].slice(0, 40)) { try { const r = await fetch(u, { method: 'GET', redirect: 'follow' }); if (r.status >= 400 && ![401, 403, 429, 999].includes(r.status)) problemas.push(`link externo ${r.status} ${u}`); } catch (e) { problemas.push(`link externo falhou ${u}`); } }
  // arquivos que não deveriam ser públicos
  const sensiveis = ['/crm/.htaccess', '/README.md', '/public_html/', '/.htaccess', '/.ftp-deploy-sync-state.json', '/.git/config', '/public_html/index.html', '/buscador.html', '/api/.htaccess', '/crm/_teste-camp.html', '/crm/_teste-int.html', '/_teste-lp.html', '/.env', '/wp-config.php', '/fonte/build.py', '/supabase/'];
  for (const s of sensiveis) { const r = await fetch(BASE + s, { redirect: 'manual' }); console.log(`exposição ${s} → ${r.status}`); if (r.status === 200) problemas.push(`arquivo exposto ao público: ${s}`); }
  // cabeçalhos
  const h = (await fetch(BASE + '/')).headers;
  const quer = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy'];
  quer.forEach(k => { console.log(`cabeçalho ${k}: ${h.get(k) || '(ausente)'}`); if (!h.get(k)) problemas.push(`cabeçalho de segurança ausente: ${k}`); });
  const hc = (await fetch(BASE + '/crm/')).headers; console.log('crm cache-control:', hc.get('cache-control'), '| x-robots-tag:', hc.get('x-robots-tag'));
  // api lead
  const g = await fetch(BASE + '/api/lead.php'); console.log('GET /api/lead.php →', g.status);
  console.log('\n===== PROBLEMAS (' + problemas.length + ') =====\n' + [...new Set(problemas)].join('\n'));
  await b.close();
})();
