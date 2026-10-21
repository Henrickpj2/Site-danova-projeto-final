// Gera o contorno do Sul da Flórida (SVG) e a posição dos empreendimentos no mesmo sistema de coordenadas.
import fs from 'fs';
import {feature} from 'topojson-client';
import {geoMercator, geoPath, geoClipRectangle} from 'd3-geo';
const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/land-10m.json'));
const land = feature(topo, topo.objects.land);
const W = 400, H = 520;
const bbox = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-80.75, 25.55], [-80.75, 26.85], [-79.85, 26.85], [-79.85, 25.55], [-80.75, 25.55]]] } };
const proj = geoMercator().fitExtent([[0, 0], [W, H]], bbox);
proj.postclip(geoClipRectangle(0, 0, W, H));
const path = geoPath(proj).digits(1);
const d = path(land);
const pts = {
  domus: [-80.198, 25.757], melia: [-80.2, 25.764], b1428: [-80.192, 25.758], casabella: [-80.188, 25.789],
  nobu: [-80.189, 25.767], faena: [-80.205, 25.772], continuum: [-80.153, 25.848], mandarinMia: [-80.185, 25.768],
  mandarinWpb: [-80.053, 26.715], turnberry: [-80.233, 26.062]
};
const out = {};
for (const [k, ll] of Object.entries(pts)) { const [x, y] = proj(ll); out[k] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10]; }
const cidades = { 'Miami': [-80.19, 25.77], 'Miami Beach': [-80.13, 25.79], 'Fort Lauderdale': [-80.14, 26.12], 'Boca Raton': [-80.1, 26.36], 'West Palm Beach': [-80.05, 26.71] };
const cid = {}; for (const [k, ll] of Object.entries(cidades)) { const [x, y] = proj(ll); cid[k] = [Math.round(x), Math.round(y)]; }
fs.writeFileSync('mapa.json', JSON.stringify({ W, H, d, pts: out, cidades: cid }));
console.log(d.length, JSON.stringify(out), JSON.stringify(cid));
