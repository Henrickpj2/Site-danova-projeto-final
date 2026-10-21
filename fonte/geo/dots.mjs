import fs from 'fs';
import {feature} from 'topojson-client';
import {geoContains} from 'd3-geo';
const topo=JSON.parse(fs.readFileSync('node_modules/world-atlas/land-50m.json'));
const land=feature(topo,topo.objects.land);
const out=[]; const step=1.15;
for(let lat=-58;lat<=78;lat+=step){
  const r=Math.cos(lat*Math.PI/180); const s=step/Math.max(r,0.2);
  for(let lon=-180;lon<180;lon+=s){ if(geoContains(land,[lon,lat])) out.push([Math.round(lon*10)/10,Math.round(lat*10)/10]); }
}
fs.writeFileSync('dots.json',JSON.stringify(out.flat()));
console.log(out.length);
