#!/bin/sh
# Gera public_html/js/danova-globe.js a partir de globe-src.js + pontos de terra (geo/dots.json).
# Para recalcular os pontos: cd geo && npm i world-atlas@2.0.2 topojson-client@3.1.0 d3-geo@3.1.1 && node dots.mjs
cd "$(dirname "$0")"
{ printf 'window.DANOVA_GLOBE_DOTS='; cat geo/dots.json; printf ';\n'; cat globe-src.js; } > ../public_html/js/danova-globe.js
