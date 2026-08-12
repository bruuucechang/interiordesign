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
// Needs the backend on :8791 and the plan saved as `img9720`.
//
//   node bench/verify-rooms.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
const DIST='/Users/bruuucemac/Documents/Projects/interior-designer/client/dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const s=await new Promise(ok=>{const sv=createServer(async(req,res)=>{const p=decodeURIComponent(req.url.split('?')[0]);
 if(p.startsWith('/api/')){const body=await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b))});
   const up=await fetch('http://127.0.0.1:8791'+req.url,{method:req.method,headers:{'content-type':'application/json'},body:req.method==='GET'?undefined:body});
   res.writeHead(up.status,{'content-type':'application/json'});res.end(await up.text());return}
 let f=join(DIST,p==='/'?'index.html':p); if(!existsSync(f))f=join(DIST,'index.html');
 res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'});res.end(await readFile(f))});sv.listen(0,()=>ok(sv))});
const b=await chromium.launch();const page=await b.newPage({viewport:{width:1400,height:900}});
await page.goto(`http://127.0.0.1:${s.address().port}/?perf=1&plan=img9720`);
await page.waitForTimeout(6000);
const r = JSON.parse(await page.evaluate(()=>{
  const rooms = window.__app.doc.objects.filter(o=>o.kind==='room');
  const box = r => r.poly && r.poly.length>=3
    ? (()=>{const xs=r.poly.map(p=>p.x),ys=r.poly.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}})()
    : {x:r.x,y:r.y,w:r.w,h:r.h};
  const overlap = (a,c)=>{const A=box(a),C=box(c);
    const ox=Math.max(0,Math.min(A.x+A.w,C.x+C.w)-Math.max(A.x,C.x));
    const oy=Math.max(0,Math.min(A.y+A.h,C.y+C.h)-Math.max(A.y,C.y));
    return ox*oy};
  const out=[];
  for(let i=0;i<rooms.length;i++) for(let j=i+1;j<rooms.length;j++){
    const a=overlap(rooms[i],rooms[j]);
    if(a>10000) out.push(`${rooms[i].name}${rooms[i].auto?'(自動)':''} ∩ ${rooms[j].name}${rooms[j].auto?'(自動)':''} = ${(a/10000).toFixed(1)} m²`);
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
