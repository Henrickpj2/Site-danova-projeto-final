import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import html
P=[
 dict(n="Domus Brickell Park",img="domus.webp",tags="miami pre",badge="Pré-construção · mobiliado",loc="1611 SW 2nd Ave · Brickell, Miami",
  d="171 apartamentos totalmente mobiliados no coração do distrito financeiro de Brickell, com varanda privativa em todas as unidades.",
  f=["Studios a 2 quartos · 330 a 975 pés²","North Development · Zyscovich Architects","Rooftop com vista para a Biscayne Bay"],price="US$ 650 mil",when="Entrega final de 2026"),
 dict(n="Meliá Brickell",img="melia.webp",tags="miami branded pre",badge="1º Meliá residencial nos EUA",loc="1120 SW 3rd Ave · Brickell, Miami",
  d="Condo-hotel com gestão Meliá: sem inquilinos para buscar, sem manutenção, com distribuição global da rede hoteleira.",
  f=["110 unidades · 8 andares","Mobiliado por Adriana Hoyos · LEED Silver","20% na assinatura · 60% no fechamento"],price="US$ 500 mil",when="Entrega 2027"),
 dict(n="The Residences at 1428 Brickell",img="1428-brickell.webp",tags="miami pre",badge="Ultra-luxo",loc="1428 Brickell Ave · Miami",
  d="195 residências em 70 andares com interiores de Antonio Citterio — apresentada como a primeira torre residencial solar do mundo.",
  f=["Arquitectonica · ACPV · YTech","80 mil pés² de amenidades","Coberturas até US$ 14,4 milhões"],price="US$ 2,9 mi",when="2 quartos a partir de"),
 dict(n="Casa Bella Residences by B&B Italia",img="casabella.webp",tags="miami branded pre",badge="Branded residence",loc="1400 Biscayne Blvd · Downtown Miami",
  d="57 andares do Related Group com arquitetura e interiores de Piero Lissoni e peças curadas da coleção B&B Italia em cada residência.",
  f=["302 residências","Observatório no 60º andar","Aceita reservas em Bitcoin e USDT"],price="US$ 1,5 mi",when="Entrega 2027"),
 dict(n="Nobu Residences Brickell",img="nobu-brickell.webp",tags="miami branded",badge="Branded · em vendas",loc="619 Brickell · Bayfront, Miami",
  d="A primeira torre residencial Nobu em Miami: 75 andares assinados por Foster + Partners, de frente para a Biscayne Bay.",
  f=["Restaurante Nobu privado","Nobu Beach Club no rooftop","Chef in-residence e butler 24/7"],price="US$ 2,1 mi",when="Em vendas"),
 dict(n="Faena Residences Miami",img="faena.webp",tags="miami branded pre",badge="Branded · pré-construção",loc="Miami River · Miami",
  d="Duas torres unidas por uma Sky Bridge a 700 pés de altura, num distrito cultural de 14 acres — uma das obras finais de Rafael Viñoly.",
  f=["406 residências · 716 a 6.301 pés²","Clube privado Faena Bloom, sem taxa anual","Dock privativo e iate Faena"],price="US$ 1,3 mi",when="Pré-construção"),
 dict(n="Continuum Club & Residences",img="continuum.webp",tags="miami pre",badge="Waterfront · em construção",loc="1755 79th St Causeway · North Bay Village",
  d="236 residências com vista para a água em todas as unidades, entre Miami Beach e o continente. Yacht Club e Beach Club privados.",
  f=["1 a 4 quartos · 850 a 4.000 pés²","60 mil+ pés² de amenidades","40% durante a obra · 60% na entrega"],price="US$ 1,4 mi",when="Entrega prevista 2º tri 2028"),
 dict(n="The Residences at Mandarin Oriental, Miami",img="mandarin-miami.webp",tags="miami branded",badge="Branded · em construção",loc="One Island Drive · Brickell Key, Miami",
  d="Duas torres da Swire Properties com o novo hotel Mandarin Oriental, numa ilha privada a 5 minutos de Brickell. Arquitetura KPF.",
  f=["326 residências em 2 torres","100 mil pés² de amenidades","Mais de US$ 1,3 bilhão em vendas"],price="US$ 3,9 mi",when="North Tower · conclusão 2030"),
 dict(n="Mandarin Oriental Residences West Palm Beach",img="mandarin-wpb.webp",tags="florida branded",badge="Branded · em vendas",loc="West Palm Beach · Flórida",
  d="Residências Mandarin Oriental por Safdie Architects na “Wall Street do Sul”, onde já estão Goldman Sachs, Citadel e Vista Equity.",
  f=["Spa Mandarin e restaurante de assinatura","Butler 24/7 e concierge global","Quem compra primeiro escolhe andares e vistas"],price="Sob consulta",when="Vendas abertas"),
 dict(n="Estates by Turnberry",img="turnberry.webp",tags="florida",badge="Casas · comunidade fechada",loc="Davie, FL · leste de Weston",
  d="Comunidade fechada de casas de luxo com segurança 24h e escolas de ponta próximas — ideal para famílias internacionais.",
  f=["151 casas single-family · até 5.950 pés²","Lotes de 20 a 26 mil pés²","Clubhouse, trilhas equestres e 60+ acres verdes"],price="US$ 1,7 mi",when="Casas a partir de"),
]
pin='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>'
e=html.escape
cards=[]
for p in P:
  pre = "a partir de" if p["price"]!="Sob consulta" else "preço"
  facts="".join(f"<li>{e(x)}</li>" for x in p["f"])
  cards.append(f'''          <article class="property-card" data-tags="{p["tags"]}">
            <div class="property-image">
              <img src="img/{p["img"]}" alt="{e(p["n"])} — {e(p["loc"])}" loading="lazy">
              <span class="property-badge">{e(p["badge"])}</span>
            </div>
            <div class="property-body">
              <div class="location">{pin} {e(p["loc"])}</div>
              <h3>{e(p["n"])}</h3>
              <p>{e(p["d"])}</p>
              <ul class="facts">{facts}</ul>
              <div class="property-meta"><span class="price"><small>{e(p["when"]) if p["when"].endswith("de") else pre}</small>{e(p["price"])}</span><a class="text-link" href="#contato" data-project="{e(p["n"])}">Solicitar plantas ↗</a></div>
              {'' if p["when"].endswith("de") else f'<span style="display:block;font-size:11px;color:var(--muted);margin-top:8px">{e(p["when"])}</span>'}
            </div>
          </article>''')
opts="\n".join(f"                <option>{e(p['n'])}</option>" for p in P)
css=open('base.css').read()+open('extra.css').read()
body=open('body.html').read().replace('__CARDS__',"\n".join(cards)).replace('__OPTIONS__',opts)
head=f'''<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b1424">
  <title>DANOVA-AI | Real Estate Intelligence · Miami</title>
  <meta name="description" content="DANOVA-AI conecta empreendimentos de luxo no Sul da Flórida — Brickell, Miami River, Brickell Key, West Palm Beach — a investidores internacionais, com assessoria jurídica de Danielle Lisboa Martins, Esq.">
  <link rel="canonical" href="https://danova-ai.com/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="DANOVA-AI | Imóveis de luxo em Miami com assessoria jurídica">
  <meta property="og:description" content="Branded residences, pré-construção, EB-5, family office e cripto. Atendimento em PT · EN · ES.">
  <meta property="og:image" content="https://danova-ai.com/img/og-danova.jpg">
  <meta property="og:url" content="https://danova-ai.com/">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="preload" as="image" href="img/danova-logo.webp">
  <script src="js/danova-config.js?v=20261020"></script>
  <script src="js/crm-config.js?v=20261021"></script>
  <script src="js/danova-tracking.js?v=20261020" defer></script>
  <style>{css}  </style>
</head>
'''
js=open('page.js').read()
open('../public_html/index.html','w').write(head+body+"\n  <script src=\"js/danova-globe.js?v=20261020\" defer></script>\n  <script>\n"+js+"\n  </script>\n</body>\n</html>\n")
