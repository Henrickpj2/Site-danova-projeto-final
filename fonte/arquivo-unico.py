"""Gera um único arquivo HTML com o site + área de membros (CRM), imagens e scripts embutidos.
Uso: python3 fonte/arquivo-unico.py  ->  danova-site-completo.html (na raiz do repositório)
"""
import base64, mimetypes, os, re

AQUI = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(AQUI, "..", "public_html")
SAIDA = os.path.join(AQUI, "..", "danova-site-completo.html")

def ler(p):
    with open(os.path.join(PUB, p), encoding="utf-8") as f:
        return f.read()

# ---------- imagens -> data URI ----------
_cache = {}
def data_uri(nome):
    if nome not in _cache:
        caminho = os.path.join(PUB, "img", nome)
        mime = {"webp": "image/webp", "jpg": "image/jpeg", "png": "image/png"}[nome.rsplit(".", 1)[1]]
        with open(caminho, "rb") as f:
            _cache[nome] = "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())
    return _cache[nome]

def embutir_imagens(txt):
    # troca img/arquivo.ext e ../img/arquivo.ext (mas não URLs absolutas como https://danova-ai.com/img/...)
    return re.sub(r'(?<![\w/:.-])(?:\.\./)?img/([\w.-]+\.(?:webp|jpg|png))',
                  lambda m: data_uri(m.group(1)) if os.path.exists(os.path.join(PUB, "img", m.group(1))) else m.group(0), txt)

# ---------- escopo do CSS do CRM ----------
def escopo_css(css, pref="#crmRoot"):
    out, i, n = [], 0, len(css)
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    def bloco_regras(texto):
        res = []
        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", texto):
            sels = []
            for s in m.group(1).split(","):
                s = s.strip()
                if not s:
                    continue
                if s in (":root", "html", "body", "html, body"):
                    sels.append(pref)
                elif s.startswith("html") or s.startswith("body"):
                    sels.append(pref)
                else:
                    sels.append(pref + " " + s)
            res.append(", ".join(dict.fromkeys(sels)) + " {" + m.group(2) + "}")
        return "\n".join(res)
    while i < n:
        cand = [p for p in (css.find("@media", i), css.find("@keyframes", i)) if p >= 0]
        at = min(cand) if cand else -1
        if at < 0:
            out.append(bloco_regras(css[i:])); break
        out.append(bloco_regras(css[i:at]))
        abre = css.find("{", at)
        prof, j = 1, abre + 1
        while prof and j < n:
            if css[j] == "{": prof += 1
            elif css[j] == "}": prof -= 1
            j += 1
        if css.startswith("@keyframes", at):
            out.append(css[at:j])
        else:
            out.append(css[at:abre] + "{\n" + bloco_regras(css[abre + 1:j - 1]) + "\n}")
        i = j
    return "\n".join(out)

def script(conteudo):
    return "<script>\n" + conteudo.replace("</script", "<\\/script") + "\n</script>"

# ---------- site ----------
html = ler("index.html")

# scripts externos -> inline
tracking = ler("js/danova-tracking.js").replace(
    "if (f && f.tagName === 'FORM') sendLead(f);",
    "if (f && f.tagName === 'FORM' && !(f.closest && f.closest('#crmRoot'))) sendLead(f);")
assert "#crmRoot" in tracking
html = html.replace('<script src="js/danova-config.js?v=20261020"></script>', script(ler("js/danova-config.js")))
html = html.replace('<script src="js/crm-config.js?v=20261023"></script>', script(ler("js/crm-config.js")))
html = html.replace('<script src="js/danova-tracking.js?v=20261020" defer></script>', "")
html = html.replace('<script src="js/danova-localizador.js?v=20261021" defer></script>', "")
html = html.replace('<script src="js/danova-chat.js?v=20261021" defer></script>', "")
assert 'src="js/' not in html, re.findall(r'src="js/[^"]+"', html)
html = re.sub(r'\s*<link rel="preload" as="image" href="img/[^"]+">', "", html)

# links que dependiam de outros arquivos
html = html.replace('href="crm/index.html"', 'href="#crm"').replace('href="livro.html"', 'href="https://danova-ai.com/livro.html" target="_blank" rel="noopener"').replace('href="politica-de-privacidade.html"', 'href="https://danova-ai.com/politica-de-privacidade.html"').replace('href="termos-de-uso.html"', 'href="https://danova-ai.com/termos-de-uso.html"')
html = html.replace(
    '<span>Empreendimentos de Brickell a Palm Beach <a href="#empreendimentos">Explore os projetos ↗</a></span>',
    '<span>Empreendimentos de Brickell a Palm Beach <a href="#empreendimentos">Explore os projetos ↗</a> · <a href="#crm">Área de membros</a></span>')

# ---------- CRM ----------
crm_html = ler("crm/index.html")
corpo = re.search(r"<body>(.*?)<script", crm_html, re.S).group(1)
corpo = corpo.replace('id="toast"', 'id="crmToast"').replace('href="../index.html"', 'href="#inicio"')
crm_css = escopo_css(ler("crm/crm.css"))
crm_css += """
#crmRoot { min-height: 100vh; background: var(--bg); color: var(--ink); font-family: "DM Sans", system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
#crmRoot { display: none; }
html.crm-mode #crmRoot { display: block; }
html.crm-mode body > :not(#crmRoot):not(script) { display: none !important; }\nhtml.crm-mode .dn-chat { display: none !important; }
html.crm-mode body { background: #f4f6fa; }
"""
crm_js = ler("crm/crm.js")
trocas = [
    ('var t = $("#toast");', 'var t = $("#crmToast");'),
    ("'<form class=\"d-body\" id=\"leadForm\">'", "'<form class=\"d-body\" id=\"crmLeadForm\">'"),
    ('var form = $("#leadForm", D);', 'var form = $("#crmLeadForm", D);'),
    ("emailRedirectTo: location.origin + location.pathname", "emailRedirectTo: location.origin + location.pathname + \"#crm\""),
    ("redirectTo: location.origin + location.pathname", "redirectTo: location.origin + location.pathname + \"#crm\""),
    ("esc(location.origin + location.pathname)", "esc(location.origin + location.pathname + \"#crm\")"),
    ('var v = (location.hash || "").replace("#", "");', 'var v = (location.hash || "").replace(/^#crm\\/?/, "");'),
    ('history.replaceState(null, "", "#" + v);', 'history.replaceState(null, "", "#crm/" + v);'),
    ('else if (ev === "SIGNED_IN" && !recuperando && !S.me) { iniciar(); }', 'else if (ev === "SIGNED_IN" && !recuperando && !S.me && window.__crmAtivo) { iniciar(); }'),
    ("\n  iniciar();\n})();", "\n  window.danovaAbrirCRM = function () { if (!window.__crmIniciado) { window.__crmIniciado = true; iniciar(); } };\n})();"),
]
for a, b in trocas:
    assert a in crm_js, a
    crm_js = crm_js.replace(a, b)

roteador = """
(function () {
  function rota() {
    var h = location.hash || "";
    var crm = /^#crm/.test(h) || /(access_token|type=recovery|error_description)=/.test(h);
    document.documentElement.classList.toggle("crm-mode", crm);
    window.__crmAtivo = crm;
    if (crm) { window.scrollTo(0, 0); document.title = "danova AI · Área de membros"; if (window.danovaAbrirCRM) window.danovaAbrirCRM(); }
    else { document.title = "DANOVA-AI | Real Estate Intelligence · tráfego pago, CRM e vendas imobiliárias"; }
  }
  window.addEventListener("hashchange", rota);
  rota();
})();
"""

bloco_crm = (
    "<style>\n" + crm_css + "\n</style>\n"
    '<div id="crmRoot">' + corpo + "</div>\n"
    + script(ler("js/vendor/supabase-2.45.4.js").replace('throw new Error("Automatic publicPath is not supported in this browser")', 'e="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/"')) + "\n"
    + script(ler("crm/crm-modulos.js")) + "\n"
    + script(ler("crm/crm-dash.js")) + "\n"
    + script(ler("crm/crm-campanhas.js")) + "\n"
    + script(crm_js) + "\n"
    + script(ler("js/danova-localizador.js")) + "\n"
    + script(ler("js/danova-chat.js")) + "\n"
    + script(tracking) + "\n"
    + script(roteador) + "\n"
)
html = html.replace("</body>", bloco_crm + "</body>")
html = embutir_imagens(html)
faltando = set(re.findall(r'.{30}(?<![\w/:.-])(?:\.\./)?img/[\w.-]+\.(?:webp|jpg|png)', html))
if faltando:
    print("AVISO — referência de imagem sem arquivo local:", faltando)

with open(SAIDA, "w", encoding="utf-8") as f:
    f.write(html)
print("ok", SAIDA, round(len(html.encode()) / 1024), "KB")
