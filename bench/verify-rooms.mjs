// No two room floors may occupy the same ground.
//
// Two slabs at the same height fight for the same depth, and what that looks
// like is not "two rooms overlap" — it is the floor texture breaking up as the
// camera moves. It was reported as 「地板一閃一閃像破圖」 and took a while to
// recognise, so it gets a check.
//
// The way it happened: the traced partitions did not quite meet the walls, so
// the only closed loop left was the whole floor, and room detection added one
// 12.3 × 11.3 m 「房間」 on top of all ten drawn rooms. Detection ran, returned a
// polygon, added a room — nothing failed.
//
// Any overlap at all counts. The first version only flagged more than 1 m²,
// and the one that got through was 0.37 m² — a 138 × 27 strip where a room's
// bounding rectangle lay across the corridor. Small in area, and directly under
// a doorway, so it was the piece of floor you walk over.
//
// Needs the backend on :8791 and the plan saved as `img0199`.
//
//   node bench/verify-rooms.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
const DIST='/Users/bruuucemac/Projects/interior-designer/client/dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const s=await new Promise(ok=>{const sv=createServer(async(req,res)=>{const p=decodeURIComponent(req.url.split('?')[0]);
 if(p.startsWith('/api/')){const body=await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b))});
   const up=await fetch('http://127.0.0.1:8791'+req.url,{method:req.method,headers:{'content-type':'application/json'},body:req.method==='GET'?undefined:body});
   res.writeHead(up.status,{'content-type':'application/json'});res.end(await up.text());return}
 let f=join(DIST,p==='/'?'index.html':p); if(!existsSync(f))f=join(DIST,'index.html');
 res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'});res.end(await readFile(f))});sv.listen(0,()=>ok(sv))});
const b=await chromium.launch();const page=await b.newPage({viewport:{width:1400,height:900}});
await page.goto(`http://127.0.0.1:${s.address().port}/?perf=1&plan=img0199`);
await page.waitForTimeout(6000);
const r = JSON.parse(await page.evaluate(()=>{
  const rooms = window.__app.doc.objects.filter(o=>o.kind==='room');
  // Compare the actual shapes, not their bounding boxes. An L-shaped room's
  // box covers ground the room does not, so a box test both misses real
  // overlaps and invents ones that are not there — it reported 0.4 m² against a
  // corridor the room had already been reshaped to avoid.
  const poly = r => (r.poly && r.poly.length>=3) ? r.poly
    : [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
  const inside = (p, pts) => {
    let hit = false;
    for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
      if ((pts[i].y>p.y)!==(pts[j].y>p.y) &&
          p.x < (pts[j].x-pts[i].x)*(p.y-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x) hit=!hit;
    }
    return hit;
  };
  const STEP = 5;   // cm — a 5 cm grid finds anything worth seeing
  const overlap = (a,c)=>{
    const A=poly(a), C=poly(c);
    const xs=[...A,...C].map(p=>p.x), ys=[...A,...C].map(p=>p.y);
    let n=0;
    for(let x=Math.min(...xs)+STEP/2;x<Math.max(...xs);x+=STEP)
      for(let y=Math.min(...ys)+STEP/2;y<Math.max(...ys);y+=STEP)
        if(inside({x,y},A) && inside({x,y},C)) n++;
    return n*STEP*STEP;
  };
  const box = r => { const p=poly(r); const xs=p.map(q=>q.x),ys=p.map(q=>q.y);
    return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}; };
  const out=[];
  for(let i=0;i<rooms.length;i++) for(let j=i+1;j<rooms.length;j++){
    const a=overlap(rooms[i],rooms[j]);
    if(a>100) out.push(`${rooms[i].name}${rooms[i].auto?'(自動)':''} ∩ ${rooms[j].name}${rooms[j].auto?'(自動)':''} = ${(a/10000).toFixed(2)} m²`);
  }
  return JSON.stringify({
    總數: rooms.length,
    自動: rooms.filter(r=>r.auto).length,
    自動房間: rooms.filter(r=>r.auto).map(r=>`${r.name} ${(box(r).w/100).toFixed(1)}×${(box(r).h/100).toFixed(1)}m floor=${r.floor??'(預設)'}`),
    重疊: out,
  });
}));
await b.close();s.close();

console.log(`房間 ${r.總數} 個（自動 ${r.自動}）`);
for (const a of r.自動房間) console.log('  自動:', a);
if (r.重疊.length) {
  console.log('\n✖ 有重疊的地板：');
  for (const o of r.重疊) console.log('   ', o);
  process.exit(1);
}
console.log('\n✔ 沒有重疊的地板');
