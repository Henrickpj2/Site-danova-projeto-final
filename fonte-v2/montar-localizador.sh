#!/bin/sh
# Gera public_html/js/danova-localizador.js a partir de localizador.src.js + contorno do mapa (geo/mapa.json).
# Para recalcular o mapa: cd geo && npm i world-atlas@2.0.2 topojson-client@3.1.0 d3-geo@3.1.1 && node mapa.mjs
cd "$(dirname "$0")"
python3 -c "import json;m=json.load(open('geo/mapa.json'));s=open('localizador.src.js').read().replace('__MAPA_D__',m['d']);open('../public_html/js/danova-localizador.js','w').write(s)"
