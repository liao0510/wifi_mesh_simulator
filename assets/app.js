const $=id=>document.getElementById(id), canvas=$('map'),ctx=canvas.getContext('2d');
const materialDefs={0:{name:'空白',color:'#15263b',loss:0},1:{name:'玻璃',color:'#80d4ee',loss:1},3:{name:'膠合木板',color:'#dfb67c',loss:2},6:{name:'木頭',color:'#a97541',loss:3},10:{name:'混凝土',color:'#7b8799',loss:8}};
const apColors=['#ffbe46','#42d4ff','#fb76b4','#a5e65d','#c69cff','#ff816b','#70e2b8','#e3cf65'];
const state={map:null,aps:[],clients:[],indoor:null,manual:null,mode:'rssi',tool:'select',selected:null,probe:null,drag:null,pan:null,view:{scale:1,ox:0,oy:0},results:null,seq:0,gatewayId:null};
let nextAP=1,nextClient=1; const W=()=>state.map?.width||100,H=()=>state.map?.height||100;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)); const number=(id,def)=>{let n=Number($(id).value);return Number.isFinite(n)?n:def};
const params=()=>({power:number('power',20),freq:Math.max(100,number('freq',5000)),backfreq:Math.max(100,number('backfreq',5180)),band:number('band',80),nf:number('nf',7),rssi:number('threshold',-60),sinr:number('sinrThreshold',10)});
const noise=p=>-174+10*Math.log10(p.band*1e6)+p.nf;
const idx=(x,y)=>y*W()+x,inside=(x,y)=>x>=0&&x<W()&&y>=0&&y<H();
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.display='none',3000)}
function setStatus(msg){$('status').textContent=msg}
function validate(raw){if(!raw||!Number.isInteger(raw.width)||!Number.isInteger(raw.height)||raw.width<10||raw.height<10||raw.width>300||raw.height>300)throw Error('地圖尺寸須介於 10–300');const w=raw.width,h=raw.height;if(!Array.isArray(raw.wall_map)||raw.wall_map.length!==h||raw.wall_map.some(row=>!Array.isArray(row)||row.length!==w))throw Error('wall_map 尺寸與 width/height 不符');const wall=raw.wall_map.map(row=>row.map(v=>{if(!Number.isInteger(v)||!(v in materialDefs))throw Error('不支援的材質 ID：'+v);return v}));let forbidden=Array.from({length:h},()=>Array(w).fill(0));if(raw.forbidden!==undefined){if(!Array.isArray(raw.forbidden)||raw.forbidden.length!==h||raw.forbidden.some(r=>!Array.isArray(r)||r.length!==w))throw Error('forbidden 尺寸錯誤');forbidden=raw.forbidden.map(r=>r.map(v=>Number(v)?1:0))}return {id:raw.id??0,width:w,height:h,wall_map:wall,forbidden};}
function buildMask(){let w=W(),h=H(),n=w*h,wall=state.map.wall_map,outer=new Uint8Array(n),queue=new Int32Array(n),head=0,tail=0;const add=(x,y)=>{if(!inside(x,y)||wall[y][x]!==0)return;let i=idx(x,y);if(outer[i])return;outer[i]=1;queue[tail++]=i};for(let x=0;x<w;x++){add(x,0);add(x,h-1)}for(let y=0;y<h;y++){add(0,y);add(w-1,y)}while(head<tail){let i=queue[head++],x=i%w,y=(i/w)|0;add(x-1,y);add(x+1,y);add(x,y-1);add(x,y+1)}let mask=new Uint8Array(n);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=idx(x,y);mask[i]=wall[y][x]===0&&!outer[i]?1:0;if(state.manual?.[i]===1&&wall[y][x]===0)mask[i]=1;if(state.manual?.[i]===-1)mask[i]=0}state.indoor=mask}
function loadMap(raw,name='匯入地圖'){state.seq++;state.map=validate(raw);state.gatewayId=null;state.aps=[];state.clients=[];state.manual=new Int8Array(W()*H());state.selected=null;state.probe=null;nextAP=1;nextClient=1;state.view={scale:1,ox:0,oy:0};buildMask();$('mapName').textContent=name;$('mapMeta').textContent=`${W()} × ${H()} · ${(W()*.1).toFixed(1)} × ${(H()*.1).toFixed(1)} m`;calculate()}
function gatewayIndex(){return state.aps.findIndex(a=>a.id===state.gatewayId)}
function validPlacement(x,y){return inside(x,y)&&state.map.wall_map[y][x]===0&&!state.map.forbidden[y][x]&&state.indoor[idx(x,y)]===1}
// Exact 2D grid traversal between CELL CENTERS. Loss coefficients are dB per 0.1 m
// of path inside a material cell. Corner touches contribute zero path length.
function lossAlong(ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay,span=Math.hypot(dx,dy);
 if(span===0)return 0;
 let ix=Math.floor(ax),iy=Math.floor(ay),t=0,loss=0;
 const sx=Math.sign(dx),sy=Math.sign(dy);
 const txStep=dx===0?Infinity:1/Math.abs(dx),tyStep=dy===0?Infinity:1/Math.abs(dy);
 let tx=dx===0?Infinity:(sx>0?(ix+1-ax):(ax-ix))/Math.abs(dx);
 let ty=dy===0?Infinity:(sy>0?(iy+1-ay):(ay-iy))/Math.abs(dy);
 const maxIterations=W()+H()+4;
 for(let step=0;step<maxIterations&&t<1-1e-12;step++){
  const next=Math.min(1,tx,ty);
  if(ix>=0&&ix<W()&&iy>=0&&iy<H()&&next>t){
   const mat=state.map.wall_map[iy][ix];
   loss+=materialDefs[mat].loss*(next-t)*span;
  }
  if(next>=1)break;
  // Moving across both boundaries at a corner is intentional.
  if(tx<=next+1e-12){ix+=sx;tx+=txStep}
  if(ty<=next+1e-12){iy+=sy;ty+=tyStep}
  t=next;
 }
 return loss;
}
function rssiAt(ap,x,y,p,backhaul=false){let dx=(ap.x-x)*.1,dy=(ap.y-y)*.1,d=Math.max(.1,Math.hypot(dx,dy)),f=backhaul?p.backfreq:p.freq;let fspl=32.44+20*Math.log10(f)+20*Math.log10(d/1000);return (ap.power??p.power)-fspl-lossAlong(ap.x+.5,ap.y+.5,x+.5,y+.5)}
function linkGraph(p){
 const n=state.aps.length,N=noise(p),edges=[],adj=Array.from({length:n},()=>[]);
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  const ab=rssiAt(state.aps[i],state.aps[j].x,state.aps[j].y,p,true);
  const ba=rssiAt(state.aps[j],state.aps[i].x,state.aps[i].y,p,true);
  const linkSinr=Math.min(ab-N,ba-N),ok=linkSinr>=p.sinr;
  edges.push({i,j,ab,ba,linkSinr,ok});
  if(ok){adj[i].push({v:j,quality:linkSinr});adj[j].push({v:i,quality:linkSinr})}
 }
 // Maximum bottleneck SINR path from Gateway (widest-path routing).
 const gateway=gatewayIndex(),backhaulSinr=Array(n).fill(-Infinity),parent=Array(n).fill(-1),done=Array(n).fill(false);
 if(gateway>=0){backhaulSinr[gateway]=Infinity;
  for(let count=0;count<n;count++){
   let u=-1;for(let i=0;i<n;i++)if(!done[i]&&(u<0||backhaulSinr[i]>backhaulSinr[u]))u=i;
   if(u<0||backhaulSinr[u]===-Infinity)break;
   done[u]=true;
   for(const {v,quality} of adj[u]){
    const candidate=Math.min(backhaulSinr[u],quality);
    if(candidate>backhaulSinr[v]){backhaulSinr[v]=candidate;parent[v]=u}
   }
  }
 }
 const reachable=backhaulSinr.map(v=>v!==-Infinity);
 // Diagnostic only: even a disconnected AP shows its strongest potential neighbor's SINR.
 const candidateParent=Array(n).fill(-1),candidateSinr=Array(n).fill(-Infinity);
 const nearestParent=Array(n).fill(-1),nearestSinr=Array(n).fill(-Infinity);
 for(let i=0;i<n;i++){
  let distance=Infinity;
  for(let j=0;j<n;j++)if(i!==j){
   const a=state.aps[i],b=state.aps[j],d=Math.hypot(a.x-b.x,a.y-b.y);
   if(d<distance){distance=d;nearestParent[i]=j}
  }
 }
 for(const edge of edges){
  for(const [i,j] of [[edge.i,edge.j],[edge.j,edge.i]])if(edge.linkSinr>candidateSinr[i]){
   candidateSinr[i]=edge.linkSinr;candidateParent[i]=j;
  }
 }
 for(let i=0;i<n;i++)if(nearestParent[i]>=0){
  const e=edges.find(e=>(e.i===i&&e.j===nearestParent[i])||(e.j===i&&e.i===nearestParent[i]));
  if(e)nearestSinr[i]=e.linkSinr;
 }
 return {edges,reachable,parent,gateway,backhaulSinr,candidateParent,candidateSinr,nearestParent,nearestSinr};
}
// Association is strictly SINR-driven. RSSI threshold is used only for area coverage statistics.
function evaluateClient(c,p,graph){
 let nearest=-1,nearDist=Infinity,serving=-1,best=-Infinity,signal=-Infinity,N=noise(p);
 const candidates=[];
 state.aps.forEach((ap,i)=>{
  const d=Math.hypot(ap.x-c.x,ap.y-c.y);
  if(d<nearDist){nearDist=d;nearest=i}
  const rssi=rssiAt(ap,c.x,c.y,p),sinr=rssi-N;
  candidates.push({ap:i,rssi,sinr,distance:d*.1,mesh:graph.reachable[i]});
  if(sinr>best){best=sinr;serving=i;signal=rssi}
 });
 const connected=serving>=0&&best>=p.sinr&&graph.reachable[serving];
 const reason=serving<0?'沒有 AP':best<p.sinr?'SINR 未達門檻':!graph.reachable[serving]?'Serving AP 無法連回 Gateway':'已連線';
 const backhaulSinr=serving<0?null:graph.backhaulSinr[serving];
 const e2eSinr=serving<0?null:Math.min(best,backhaulSinr);
 return {nearest,serving,rssi:signal,sinr:best,backhaulSinr,e2eSinr,connected,reason,candidates};
}
function apMetrics(p,graph,clients,bestIndex,sbest){
 const n=state.aps.length, N=noise(p);
 return state.aps.map((ap,i)=>{
  const servingClients=clients.map((v,j)=>v.serving===i?j:-1).filter(j=>j>=0);
  const connectedClients=servingClients.filter(j=>clients[j].connected);
  let assignedCells=0,coveredCells=0,peakSinr=-Infinity,avgSinr=0;
  for(let k=0;k<bestIndex.length;k++)if(state.indoor[k]&&bestIndex[k]===i){assignedCells++;avgSinr+=sbest[k];peakSinr=Math.max(peakSinr,sbest[k]);if(sbest[k]>=p.sinr)coveredCells++}
  const peers=graph.edges.filter(e=>e.i===i||e.j===i).map(e=>({peer:e.i===i?e.j:e.i,txSinr:(e.i===i?e.ab:e.ba)-N,rxSinr:(e.i===i?e.ba:e.ab)-N,ok:e.ok}));
  const parent=graph.parent[i],uplink=parent<0?null:peers.find(v=>v.peer===parent);
  const servingSinrs=servingClients.map(j=>clients[j].sinr);
  const servingAvgSinr=servingSinrs.length?servingSinrs.reduce((a,b)=>a+b,0)/servingSinrs.length:null;
  const servingMinSinr=servingSinrs.length?Math.min(...servingSinrs):null;
  const candidateParent=graph.candidateParent[i],candidateSinr=graph.candidateSinr[i],nearestParent=graph.nearestParent[i],nearestSinr=graph.nearestSinr[i];
  return {servingClients,connectedClients,assignedCells,coveredCells,avgSinr:assignedCells?avgSinr/assignedCells:null,peakSinr:Number.isFinite(peakSinr)?peakSinr:null,peers,parent,uplink,reachable:graph.reachable[i],backhaulSinr:graph.backhaulSinr[i],candidateParent,candidateSinr,nearestParent,nearestSinr,servingAvgSinr,servingMinSinr};
 });
}
function calculate(){if(!state.map)return;const start=performance.now(),p=params(),n=W()*H(),best=new Float32Array(n),bestIndex=new Int16Array(n),sbest=new Float32Array(n),N=noise(p);best.fill(-Infinity);sbest.fill(-Infinity);bestIndex.fill(-1);for(let a=0;a<state.aps.length;a++){let ap=state.aps[a];for(let y=0;y<H();y++)for(let x=0;x<W();x++){let i=idx(x,y);if(!state.indoor[i])continue;let r=rssiAt(ap,x,y,p);if(r>best[i]){best[i]=r;sbest[i]=r-N;bestIndex[i]=a}}}let graph=linkGraph(p),clients=state.clients.map(c=>evaluateClient(c,p,graph)),valid=0,covered=0,sinrCovered=0,sum=0,sinrSum=0,min=Infinity,max=-Infinity;for(let i=0;i<n;i++){if(!state.indoor[i])continue;valid++;let r=best[i];if(!Number.isFinite(r))continue;sum+=r;sinrSum+=sbest[i];min=Math.min(min,r);max=Math.max(max,r);if(r>=p.rssi)covered++;if(sbest[i]>=p.sinr)sinrCovered++}const apInfo=apMetrics(p,graph,clients,bestIndex,sbest);state.results={best,bestIndex,sbest,graph,clients,apInfo,valid,covered,sinrCovered,avg:state.aps.length&&valid?sum/valid:null,avgSinr:state.aps.length&&valid?sinrSum/valid:null,min:Number.isFinite(min)?min:null,max:Number.isFinite(max)?max:null};$('calcTime').textContent=`${(performance.now()-start).toFixed(0)} ms`;updateUI();render();setStatus('計算完成')}
const fmt=(n,unit='')=>Number.isFinite(n)?`${n.toFixed(1)}${unit}`:'—';
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function updateUI(){
 const r=state.results,p=params();
 $('coverageStat').textContent=r.valid?fmt(100*r.covered/r.valid,'%'):'—';
 $('sinrCoverageStat').textContent=r.valid?fmt(100*r.sinrCovered/r.valid,'%'):'—';
 $('avgStat').textContent=fmt(r.avg,' dBm');
 $('rangeStat').textContent=`${fmt(r.max)} / ${fmt(r.min)}`;
 $('sinrStat').textContent=fmt(r.avgSinr,' dB');
 $('meshStat').textContent=`${r.graph.reachable.filter(Boolean).length} / ${state.aps.length}`;
 $('clientStat').textContent=state.clients.length?fmt(100*r.clients.filter(c=>c.connected).length/state.clients.length,'%'):'—';
 $('apCount').textContent=state.aps.length+' 顆';$('clientCount').textContent=state.clients.length+' 個';
 $('apList').innerHTML=state.aps.map((a,i)=>{
  const m=r.apInfo[i], isGateway=i===r.graph.gateway, parent=m.parent>=0?state.aps[m.parent].id:(isGateway?'Gateway':m.candidateParent>=0?state.aps[m.candidateParent].id+'（未達標候選）':'—');
  const linkSinr=m.uplink?Math.min(m.uplink.txSinr,m.uplink.rxSinr):null;
  return `<div class="node" data-ap="${i}"><div class="row"><strong style="color:${apColors[i%apColors.length]}">${a.id}${isGateway?' · Gateway':''}</strong><button data-delete-ap="${i}">刪除</button></div>
  <div>座標 (${a.x}, ${a.y}) · ${fmt(a.power,' dBm')}</div>
  <div>Mesh：${m.reachable?'✓ Gateway 可達':'✕ Gateway 不可達'} · 上游：${parent}</div>
  <div>Backhaul SINR：${isGateway?'Gateway':m.reachable?fmt(m.backhaulSinr,' dB'):'未連通'} · Link SINR：${fmt(linkSinr,' dB')}</div>
  <div>最近 AP SINR：${fmt(m.nearestSinr,' dB')}</div>
  <div>Serving Clients：${m.servingClients.length}（Connected ${m.connectedClients.length}）</div>
  <div>Serving SINR Avg / Min：${fmt(m.servingAvgSinr)} / ${fmt(m.servingMinSinr)} dB</div>
  <div>服務區平均 SINR：${fmt(m.avgSinr,' dB')}</div></div>`
 }).join('')||'<p class="hint">尚未放置 AP</p>';
 $('clientList').innerHTML=state.clients.map((c,i)=>{
  const v=r.clients[i];return `<div class="node" data-client="${i}"><div class="row"><strong>${c.id}</strong><button data-delete-client="${i}">刪除</button></div>
  <div>(${c.x}, ${c.y}) · ${v.connected?'🟢 Connected':'🔴 Disconnected'}</div>
  <div>Nearest：${v.nearest>=0?state.aps[v.nearest].id:'—'}</div>
  <div>Serving：${v.serving>=0?state.aps[v.serving].id:'—'}</div>
  <div>Serving SINR：${fmt(v.sinr,' dB')}</div>
  <div>Backhaul：${v.serving===r.graph.gateway?'Gateway（直連）':v.backhaulSinr===-Infinity?'未連通':fmt(v.backhaulSinr,' dB')}</div>
  <div>${v.reason}</div></div>`
 }).join('')||'<p class="hint">尚未放置 Client</p>';
 showDetails();
}
function showDetails(){
 const s=state.selected,r=state.results,p=params();let txt='點選 AP、Client 或地圖位置查看訊號資訊。';
 if(s?.type==='ap'&&state.aps[s.i]){
  const a=state.aps[s.i],m=r.apInfo[s.i],isGateway=s.i===r.graph.gateway;
  const peerRows=m.peers.map(v=>`<tr><td>${state.aps[v.peer].id}</td><td>${fmt(v.txSinr,' dB')}</td><td>${fmt(v.rxSinr,' dB')}</td><td>${v.ok?'✓':'✕'}</td></tr>`).join('');
  const serving=m.servingClients.map(j=>`${state.clients[j].id} (${fmt(r.clients[j].sinr,' dB')}, ${r.clients[j].connected?'Connected':'Disconnected'})`).join('<br>')||'無';
  const linkSinr=m.uplink?Math.min(m.uplink.txSinr,m.uplink.rxSinr):null;
  txt=`<b>${a.id}${isGateway?' (Gateway)':''}</b><br>座標：(${a.x}, ${a.y}) · (${fmt((a.x+.5)*.1)}, ${fmt((a.y+.5)*.1)}) m<br>發射功率：${fmt(a.power,' dBm')}<br><button data-set-gateway="${s.i}" ${isGateway?'disabled':''}>設為 Gateway</button><br>Mesh：${m.reachable?'✓ Gateway 可達':'✕ Gateway 不可達'}<br>上游：${m.parent>=0?state.aps[m.parent].id:(isGateway?'Gateway':m.candidateParent>=0?state.aps[m.candidateParent].id+'（未達標候選）':'—')}<br>Backhaul SINR：${isGateway?'Gateway':m.reachable?fmt(m.backhaulSinr,' dB'):'未連通'}<br>Link SINR：${fmt(linkSinr,' dB')}<br>最近 AP：${m.nearestParent>=0?state.aps[m.nearestParent].id:'—'}<br>最近 AP SINR：${fmt(m.nearestSinr,' dB')}<br>Serving Clients：${m.servingClients.length}（Connected ${m.connectedClients.length}）<br>Serving SINR Avg / Min：${fmt(m.servingAvgSinr)} / ${fmt(m.servingMinSinr)} dB<br>服務區平均 SINR：${fmt(m.avgSinr,' dB')}<br>服務區最高 SINR：${fmt(m.peakSinr,' dB')}<br><b>Serving Clients 明細</b><br>${serving}<br><b>Backhaul Mesh 鄰居（本端→對端 / 對端→本端）</b><table class="mini-table"><thead><tr><th>AP</th><th>TX SINR</th><th>RX SINR</th><th>可連</th></tr></thead><tbody>${peerRows||'<tr><td colspan="4">無其他 AP</td></tr>'}</tbody></table>`;
 }else if(s?.type==='client'&&state.clients[s.i]){
  const c=state.clients[s.i],v=r.clients[s.i];
  const rows=v.candidates.map(q=>`<tr><td>${state.aps[q.ap].id}${q.ap===v.serving?' ★':''}</td><td>${fmt(q.rssi)}</td><td>${fmt(q.sinr)}</td><td>${q.mesh?'✓':'✕'}</td></tr>`).join('');
  txt=`<b>${c.id}</b><br>位置：(${c.x}, ${c.y})<br>最近 AP：${v.nearest>=0?state.aps[v.nearest].id:'—'}<br>Serving AP（最高 SINR）：${v.serving>=0?state.aps[v.serving].id:'—'}<br>RSSI：${fmt(v.rssi,' dBm')}<br>Serving SINR：${fmt(v.sinr,' dB')}<br>Backhaul SINR：${v.serving===r.graph.gateway?'Gateway（直連）':v.backhaulSinr===-Infinity?'未連通':fmt(v.backhaulSinr,' dB')}<br>End-to-End 瓶頸 SINR：${fmt(v.e2eSinr,' dB')}<br>SINR 門檻：${fmt(p.sinr,' dB')}<br>Connected：${v.connected}<br>原因：${v.reason}<br><b>候選 AP 訊號比較</b><table class="mini-table"><thead><tr><th>AP</th><th>RSSI</th><th>SINR</th><th>Mesh</th></tr></thead><tbody>${rows||'<tr><td colspan="4">無 AP</td></tr>'}</tbody></table>`;
 }else if(state.probe){
  const {x,y}=state.probe,i=idx(x,y),a=r.bestIndex[i],indoor=!!state.indoor[i];
  txt=`<b>地圖位置 (${x}, ${y})</b><br>座標：(${fmt((x+.5)*.1)}, ${fmt((y+.5)*.1)}) m<br>材質：${materialDefs[state.map.wall_map[y][x]].name}<br>有效室內：${indoor}<br>最佳 AP：${a>=0?state.aps[a].id:'—'}<br>RSSI：${fmt(r.best[i],' dBm')}<br>SINR：${fmt(r.sbest[i],' dB')}<br>Noise：${fmt(noise(p),' dBm')}`;
 }
 $('details').innerHTML=txt;
}
$('details').addEventListener('click',e=>{const b=e.target.closest('[data-set-gateway]');if(!b)return;const ap=state.aps[Number(b.dataset.setGateway)];if(!ap)return;state.gatewayId=ap.id;calculate();toast(ap.id+' 已設為 Gateway')});
function color(t){t=clamp(t,0,1);if($('reverse').checked)t=1-t;const stops=[[37,75,156],[64,178,192],[103,201,116],[246,213,69],[236,67,62]],z=t*(stops.length-1),k=Math.min(stops.length-2,Math.floor(z)),a=z-k;return stops[k].map((v,j)=>Math.round(v*(1-a)+stops[k+1][j]*a))}
const off=document.createElement('canvas'),offctx=off.getContext('2d');function render(){if(!state.map||!state.results)return;let w=W(),h=H(),r=state.results;off.width=w;off.height=h;let image=offctx.createImageData(w,h),strong=number('maxColor',-30),weak=number('minColor',-100);if(strong<=weak)strong=weak+1;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=idx(x,y),k=i*4,m=state.map.wall_map[y][x],rgb=[20,34,54];if(state.indoor[i]){if(state.mode==='coverage'){let a=r.bestIndex[i];rgb=a<0?[29,44,64]:hexToRgb(apColors[a%apColors.length]);if(r.best[i]<params().rssi)rgb=rgb.map(v=>Math.round(v*.35))}else if(state.mode==='mesh'){rgb=[30,47,65]}else{let v=state.mode==='sinr'?r.sbest[i]:r.best[i],lo=state.mode==='sinr'?-10:weak,hi=state.mode==='sinr'?40:strong;rgb=Number.isFinite(v)?color((v-lo)/(hi-lo)):[26,42,65]}}if(m&&$('showMaterials').checked){let c=hexToRgb(materialDefs[m].color);rgb=c.map((v,j)=>Math.round(v*.92+rgb[j]*.08))}if(state.map.forbidden[y][x]&&m===0){rgb=rgb.map((v,j)=>Math.round(v*.6+([100,46,77][j])*.4))}image.data[k]=rgb[0];image.data[k+1]=rgb[1];image.data[k+2]=rgb[2];image.data[k+3]=255}offctx.putImageData(image,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();let {scale,ox,oy}=state.view;ctx.translate(ox,oy);ctx.scale(scale,scale);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,0,0,canvas.width,canvas.height);let cw=canvas.width/w,ch=canvas.height/h;if($('showGrid').checked&&w<=150){ctx.strokeStyle='#ffffff22';ctx.lineWidth=.4;ctx.beginPath();for(let x=0;x<=w;x++){ctx.moveTo(x*cw,0);ctx.lineTo(x*cw,canvas.height)}for(let y=0;y<=h;y++){ctx.moveTo(0,y*ch);ctx.lineTo(canvas.width,y*ch)}ctx.stroke()}if($('showLinks').checked||state.mode==='mesh'){
 const line=(x1,y1,x2,y2,style='#f0f9ff',dash=[])=>{
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
  ctx.strokeStyle=style;ctx.lineWidth=2.4;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
 };
 // Connectivity Graph: show every pair of APs with qualified bidirectional SINR.
 // Routing (parent / gateway / backhaul SINR) is unchanged and calculated separately.
 for(const edge of r.graph.edges){
  if(!edge.ok)continue;
  const a=state.aps[edge.i],b=state.aps[edge.j];
  line((a.x+.5)*cw,(a.y+.5)*ch,(b.x+.5)*cw,(b.y+.5)*ch,'#f0f9ff');
 }
 // Each connected Client has one white line to its single highest-SINR Serving AP.
 for(let i=0;i<state.clients.length;i++){
  const v=r.clients[i];if(!v.connected||v.serving<0)continue;
  const c=state.clients[i],a=state.aps[v.serving];
  line((c.x+.5)*cw,(c.y+.5)*ch,(a.x+.5)*cw,(a.y+.5)*ch,'#ffffff',[3,3]);
 }
}
for(let i=0;i<state.aps.length;i++){let a=state.aps[i],x=(a.x+.5)*cw,y=(a.y+.5)*ch;ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fillStyle=apColors[i%apColors.length];ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#081525';ctx.stroke();ctx.fillStyle='#071522';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);ctx.fillStyle='#fff';ctx.font='bold 11px sans-serif';ctx.fillText(a.id+(i===r.graph.gateway?' ★':''),x,y-18)}for(let i=0;i<state.clients.length;i++){let c=state.clients[i],x=(c.x+.5)*cw,y=(c.y+.5)*ch;ctx.fillStyle=r.clients[i].connected?'#7df3b1':'#ff8390';ctx.fillRect(x-5,y-5,10,10);ctx.strokeStyle='#091421';ctx.lineWidth=2;ctx.strokeRect(x-5,y-5,10,10);ctx.fillStyle='#fff';ctx.font='10px sans-serif';ctx.fillText(c.id,x,y-12)}if(state.probe){let {x,y}=state.probe;ctx.strokeStyle='#fff';ctx.lineWidth=1.6;ctx.strokeRect(x*cw,y*ch,cw,ch)}ctx.restore();$('legendStrong').textContent=state.mode==='sinr'?'40 dB':state.mode==='coverage'?'AP 分區':`${strong} dBm`;$('legendWeak').textContent=state.mode==='sinr'?'-10 dB':state.mode==='coverage'?'':`${weak} dBm`;$('gradient').style.display=['coverage','mesh'].includes(state.mode)?'none':'block';$('gradient').style.background=$('reverse').checked?'linear-gradient(90deg,#3263c9,#42b6a4,#facc15,#ef4444)':'linear-gradient(90deg,#ef4444,#facc15,#42b6a4,#3263c9)'}
function hexToRgb(h){return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16))}
function point(ev){let rect=canvas.getBoundingClientRect(),u=(ev.clientX-rect.left)*canvas.width/rect.width,v=(ev.clientY-rect.top)*canvas.height/rect.height,{scale,ox,oy}=state.view;return {x:Math.floor((u-ox)/scale/canvas.width*W()),y:Math.floor((v-oy)/scale/canvas.height*H()),u,v}}
function hit(x,y){for(let i=state.clients.length-1;i>=0;i--)if(Math.hypot(state.clients[i].x-x,state.clients[i].y-y)<=1.3)return {type:'client',i};for(let i=state.aps.length-1;i>=0;i--)if(Math.hypot(state.aps[i].x-x,state.aps[i].y-y)<=1.3)return {type:'ap',i};return null}
function addNode(type,x,y){if(!validPlacement(x,y)){toast('只能放在有效室內、非禁止且無牆壁的格子');return}if(type==='ap'){state.aps.push({id:`AP ${String(nextAP++).padStart(2,'0')}`,x,y,power:params().power});if(state.gatewayId===null)state.gatewayId=state.aps[state.aps.length-1].id;state.selected={type:'ap',i:state.aps.length-1}}else{state.clients.push({id:`Client ${String(nextClient++).padStart(2,'0')}`,x,y});state.selected={type:'client',i:state.clients.length-1}}state.probe=null;calculate()}
canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(!state.map)return;canvas.setPointerCapture(e.pointerId);let p=point(e);if(e.button===2){state.pan={u:p.u,v:p.v,ox:state.view.ox,oy:state.view.oy};return}if(!inside(p.x,p.y))return;if(state.tool==='ap'||state.tool==='client'){addNode(state.tool,p.x,p.y);return}if(state.tool==='indoor'||state.tool==='outdoor'){state.drag={type:'paint',value:state.tool==='indoor'?1:-1};paint(p.x,p.y);return}let h=hit(p.x,p.y);if(h&&state.tool==='select'){state.selected=h;state.probe=null;state.drag={type:'node',nodeType:h.type,i:h.i,x:p.x,y:p.y};showDetails();render()}else{state.selected=null;state.probe={x:p.x,y:p.y};showDetails();render()}});
function paint(x,y){if(!inside(x,y))return;let i=idx(x,y);if(state.map.wall_map[y][x]!==0)return;state.manual[i]=state.drag.value;state.indoor[i]=state.drag.value===1?1:0;render()}
canvas.addEventListener('pointermove',e=>{if(!state.map)return;let p=point(e);$('coords').textContent=inside(p.x,p.y)?`x: ${p.x} · y: ${p.y}  |  ${(p.x+.5)/10} m, ${(p.y+.5)/10} m`:'x: — · y: —';if(state.pan){state.view.ox=state.pan.ox+p.u-state.pan.u;state.view.oy=state.pan.oy+p.v-state.pan.v;render();return}if(!state.drag||!inside(p.x,p.y))return;if(state.drag.type==='paint'){paint(p.x,p.y);return}if(validPlacement(p.x,p.y)){let node=state.drag.nodeType==='client'?state.clients[state.drag.i]:state.aps[state.drag.i];if(node){node.x=p.x;node.y=p.y;state.drag.moved=true;render();setStatus('移動中，放開後更新 SINR / Mesh / Serving')}}});
canvas.addEventListener('pointerup',()=>{state.pan=null;if(state.drag){let d=state.drag;state.drag=null;if(d.type==='paint'||d.moved)calculate();else render()}});canvas.addEventListener('pointercancel',()=>{state.drag=null;state.pan=null;calculate()});
canvas.addEventListener('wheel',e=>{e.preventDefault();let p=point(e),old=state.view.scale,newScale=clamp(old*(e.deltaY<0?1.15:1/1.15),1,8),ratio=newScale/old;state.view.ox=p.u-(p.u-state.view.ox)*ratio;state.view.oy=p.v-(p.v-state.view.oy)*ratio;state.view.scale=newScale;render()},{passive:false});
function setTool(t){state.tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t))}document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(v=>v.classList.toggle('active',v===b));render()}));
['showMaterials','showGrid','showLinks','reverse','maxColor','minColor'].forEach(id=>$(id).addEventListener('change',render));['power','freq','backfreq','band','nf','threshold','sinrThreshold'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='power')state.aps.forEach(a=>a.power=params().power);calculate()}));
$('materials').innerHTML=Object.entries(materialDefs).filter(([id])=>id!=='0').map(([id,m])=>`<label class="material"><span class="swatch" style="background:${m.color}"></span>${m.name} (${id})<input data-material="${id}" type="number" value="${m.loss}" min="0" step="0.5"></label>`).join('');document.querySelectorAll('[data-material]').forEach(el=>el.addEventListener('change',()=>{materialDefs[el.dataset.material].loss=Math.max(0,Number(el.value)||0);calculate()}));
$('apList').addEventListener('click',e=>{let del=e.target.closest('[data-delete-ap]');if(del){let i=Number(del.dataset.deleteAp);let removed=state.aps.splice(i,1)[0];if(removed?.id===state.gatewayId){state.gatewayId=state.aps[0]?.id??null;toast(state.gatewayId?'原 Gateway 已刪除，改由 '+state.gatewayId+' 擔任 Gateway':'Gateway 已刪除')}state.selected=null;calculate();return}let node=e.target.closest('[data-ap]');if(node){state.selected={type:'ap',i:Number(node.dataset.ap)};state.probe=null;showDetails();render()}});$('clientList').addEventListener('click',e=>{let del=e.target.closest('[data-delete-client]');if(del){state.clients.splice(Number(del.dataset.deleteClient),1);state.selected=null;calculate();return}let node=e.target.closest('[data-client]');if(node){state.selected={type:'client',i:Number(node.dataset.client)};state.probe=null;showDetails();render()}});
$('rebuildMask').addEventListener('click',()=>{state.manual.fill(0);buildMask();state.aps=state.aps.filter(a=>validPlacement(a.x,a.y));state.clients=state.clients.filter(c=>validPlacement(c.x,c.y));calculate();toast('室內區域已重新辨識；手動修正已清除')});$('reset').addEventListener('click',()=>{if(!confirm('確定移除所有 AP 與 Client？'))return;state.aps=[];state.clients=[];state.gatewayId=null;state.selected=null;calculate()});
$('file').addEventListener('change',async e=>{let f=e.target.files[0];if(!f)return;try{let obj=JSON.parse(await f.text());if(obj.map&&obj.aps){loadMap(obj.map,f.name);state.aps=Array.isArray(obj.aps)?obj.aps:[];state.clients=Array.isArray(obj.clients)?obj.clients:[];state.gatewayId=state.aps.some(a=>a.id===obj.gatewayId)?obj.gatewayId:(state.aps[0]?.id??null);if(Array.isArray(obj.manual)&&obj.manual.length===W()*H()){state.manual=Int8Array.from(obj.manual);buildMask()}if(obj.materialLoss)for(let [id,v] of Object.entries(obj.materialLoss))if(materialDefs[id]){materialDefs[id].loss=Number(v);let el=document.querySelector(`[data-material="${id}"]`);if(el)el.value=v}if(obj.settings)for(let [id,v] of Object.entries(obj.settings))if($(id))$(id).value=v;nextAP=state.aps.length+1;nextClient=state.clients.length+1;calculate()}else loadMap(obj,f.name);toast('匯入成功')}catch(err){toast('匯入失敗：'+err.message)}e.target.value=''});
$('sample').addEventListener('click',loadSample);async function loadSample(){const token=state.seq;try{setStatus('載入範例中…');let res=await fetch('./assets/example1.json');if(!res.ok)throw Error('HTTP '+res.status);let json=await res.json();if(token!==state.seq)return;loadMap(json,'example1.json');toast('範例地圖載入完成')}catch(err){setStatus('請匯入 JSON');toast('範例載入失敗；直接開啟 file:// 時請手動匯入 JSON')}}
$('export').addEventListener('click',()=>{let settings={};['power','freq','backfreq','band','nf','threshold','sinrThreshold','maxColor','minColor'].forEach(id=>settings[id]=$(id).value);let data={version:2,map:state.map,aps:state.aps,clients:state.clients,gatewayId:state.gatewayId,manual:Array.from(state.manual),materialLoss:Object.fromEntries(Object.entries(materialDefs).map(([k,v])=>[k,v.loss])),settings};let blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='wifi-mesh-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
// Embedded empty map allows file:// preview without a server; GitHub Pages loads the example automatically.
loadMap({id:0,width:100,height:100,wall_map:Array.from({length:100},(_,y)=>Array.from({length:100},(_,x)=>x===0||x===99||y===0||y===99?10:0)),forbidden:Array.from({length:100},()=>Array(100).fill(0))},'空白地圖');loadSample();
