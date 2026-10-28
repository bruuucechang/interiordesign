// B17：真實平面圖上拖燈要多久（牆擋光之後每間房要算隔壁從門口透過來的燈）。
//
//   psql -d interior_design -Atc "select data from floorplans where id='plan1151022'" > /tmp/a1.json
//   cd client && npx tsx ../bench/b17-drag.ts /tmp/a1.json [格距 8]
//
// 每盞燈往右推 4 cm 量一次 lightFloor（帶房間快取＋每盞燈的快取，跟照度面板一樣），
// 印中位數、p90、最慢；再推一扇門（整層的牆變了，全部重算）。拖曳時面板用 8 cm 格點，門檻 50 ms。
import { readFileSync } from 'node:fs';
import { lightFloor } from '../client/src/core/lightmap';
import { PLANES, REFLECTANCE } from '../client/src/core/lighting';
const d = JSON.parse(readFileSync(process.argv[2],'utf8')); const objs = d.floors[0].objects; const ceil = d.floors[0].height;
const step = Number(process.argv[3] ?? 8);
const v = { height: PLANES.desk, rho: REFLECTANCE.medium, on: null, step };
const cache = new Map(), parts = new Map();
let t = performance.now(); lightFloor(objs, ceil, v, cache, parts); console.log('first full floor ms', (performance.now()-t).toFixed(0));
const lights = objs.filter((o:any)=>o.kind==='electrical');
const times:[number,string][] = [];
for (let rep=0; rep<2; rep++) for (const L of lights) { L.x += 4; t = performance.now(); lightFloor(objs, ceil, v, cache, parts); times.push([performance.now()-t, L.item+' '+L.id]); }
times.sort((a,b)=>a[0]-b[0]);
console.log('drag median', times[times.length>>1][0].toFixed(1), 'p90', times[Math.floor(times.length*0.9)][0].toFixed(1), 'max', times.at(-1)![0].toFixed(1), times.slice(-3).map(x=>x[1]+':'+x[0].toFixed(0)).join(' '));
const door = objs.find((o:any)=>o.kind==='door'); door.x += 1; t=performance.now(); lightFloor(objs, ceil, v, cache, parts); console.log('nudge door ms', (performance.now()-t).toFixed(0));
door.x += 1; t=performance.now(); lightFloor(objs, ceil, v, cache, parts); console.log('nudge door again ms', (performance.now()-t).toFixed(0));
