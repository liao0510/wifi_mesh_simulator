import {DEFAULT_RADIO, noiseDbm, receivedPower, buildMesh, accessLinks} from './radio.mjs?v=1.6';
const $=id=>document.getElementById(id), canvas=$('map'),ctx=canvas.getContext('2d');
const materialDefs={0:{name:'空白',color:'#15263b',loss:0},1:{name:'玻璃',color:'#80d4ee',loss:1},3:{name:'膠合木板',color:'#dfb67c',loss:3},6:{name:'木頭',color:'#a97541',loss:6},10:{name:'混凝土',color:'#7b8799',loss:10}};
const apColors=['#ffbe46','#42d4ff','#fb76b4','#a5e65d','#c69cff','#ff816b','#70e2b8','#e3cf65'];
const state={map:null,aps:[],clients:[],indoor:null,manual:null,mode:'rssi',tool:'select',selected:null,probe:null,drag:null,pan:null,view:{scale:1,ox:0,oy:0},results:null,seq:0,losses:{}};
let nextAP=1,nextClient=1; const W=()=>state.map?.width||100,H=()=>state.map?.height||100;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)); const number=(id,def)=>{let n=Number($(id).value);return Number.isFinite(n)?n:def};
const params=()=>({power:number('power',DEFAULT_RADIO.power),freq:Math.max(100,number('freq',DEFAULT_RADIO.freq)),band:number('band',DEFAULT_RADIO.band),nf:number('nf',DEFAULT_RADIO.nf),rssi:number('threshold',DEFAULT_RADIO.rssi),meshSnr:number('meshSnrThreshold',DEFAULT_RADIO.meshSnr),sinr:number('sinrThreshold',DEFAULT_RADIO.sinr)});
const noise=noiseDbm;
const idx=(x,y)=>y*W()+x,inside=(x,y)=>x>=0&&x<W()&&y>=0&&y<H();
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.display='none',3000)}
function setStatus(msg){$('status').textContent=msg}
function validate(raw){if(!raw||!Number.isInteger(raw.width)||!Number.isInteger(raw.height)||raw.width<10||raw.height<10||raw.width>300||raw.height>300)throw Error('地圖尺寸須介於 10–300');const w=raw.width,h=raw.height;if(!Array.isArray(raw.wall_map)||raw.wall_map.length!==h||raw.wall_map.some(row=>!Array.isArray(row)||row.length!==w))throw Error('wall_map 尺寸與 width/height 不符');const wall=raw.wall_map.map(row=>row.map(v=>{if(!Number.isInteger(v)||!(v in materialDefs))throw Error('不支援的材質 ID：'+v);return v}));let forbidden=Array.from({length:h},()=>Array(w).fill(0));if(raw.forbidden!==undefined){if(!Array.isArray(raw.forbidden)||raw.forbidden.length!==h||raw.forbidden.some(r=>!Array.isArray(r)||r.length!==w))throw Error('forbidden 尺寸錯誤');forbidden=raw.forbidden.map(r=>r.map(v=>Number(v)?1:0))}return {id:raw.id??0,width:w,height:h,wall_map:wall,forbidden};}
function buildMask(){let w=W(),h=H(),n=w*h,wall=state.map.wall_map,outer=new Uint8Array(n),queue=new Int32Array(n),head=0,tail=0;const add=(x,y)=>{if(!inside(x,y)||wall[y][x]!==0)return;let i=idx(x,y);if(outer[i])return;outer[i]=1;queue[tail++]=i};for(let x=0;x<w;x++){add(x,0);add(x,h-1)}for(let y=0;y<h;y++){add(0,y);add(w-1,y)}while(head<tail){let i=queue[head++],x=i%w,y=(i/w)|0;add(x-1,y);add(x+1,y);add(x,y-1);add(x,y+1)}let mask=new Uint8Array(n);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=idx(x,y);mask[i]=wall[y][x]===0&&!outer[i]?1:0;if(state.manual?.[i]===1&&wall[y][x]===0)mask[i]=1;if(state.manual?.[i]===-1)mask[i]=0}state.indoor=mask}
function loadMap(raw,name='匯入地圖'){state.seq++;state.map=validate(raw);state.aps=[];state.clients=[];state.manual=new Int8Array(W()*H());state.selected=null;state.probe=null;nextAP=1;nextClient=1;$('nodeX').max=W()-1;$('nodeY').max=H()-1;state.view={scale:1,ox:0,oy:0};buildMask();$('mapName').textContent=name;$('mapMeta').textContent=`${W()} × ${H()} · ${(W()*.1).toFixed(1)} × ${(H()*.1).toFixed(1)} m`;calculate()}
function selectedNode(){const s=state.selected;return s?(s.type==='ap'?state.aps:state.clients)[s.i]:null}
function syncCoordinates(){const node=selectedNode();$('moveSelected').disabled=!node;$('coordinateSelection').textContent=node?'已選取：'+node.id:'尚未選取物件';if(node){$('nodeKind').value=state.selected.type;$('nodeX').value=node.x;$('nodeY').value=node.y}}
function applyCoordinates(move){
 const rawX=$('nodeX').value.trim(),rawY=$('nodeY').value.trim(),x=Number(rawX),y=Number(rawY);
 if(!rawX||!rawY||!Number.isInteger(x)||!Number.isInteger(y)){toast('X 與 Y 必須是整數格點座標');return false}
 if(!inside(x,y)){toast(`座標超出範圍：X 為 0–${W()-1}，Y 為 0–${H()-1}`);return false}
 if(!validPlacement(x,y)){toast('只能放在有效室內、非禁止且無牆壁的格子');return false}
 if(!move){addNode($('nodeKind').value,x,y);return true}
 const node=selectedNode();if(!node){toast('請先選取要移動的 AP 或 Client');return false}
 node.x=x;node.y=y;state.probe=null;state.seq++;calculate();toast(node.id+' 已移至 ('+x+', '+y+')');return true;
}
$('coordinateForm').addEventListener('submit',e=>{e.preventDefault();applyCoordinates(false)});
$('moveSelected').addEventListener('click',()=>applyCoordinates(true));
function validPlacement(x,y){return inside(x,y)&&state.map.wall_map[y][x]===0&&!state.map.forbidden[y][x]&&state.indoor[idx(x,y)]===1}
function rssiAt(ap,x,y,p){return receivedPower(state.map.wall_map,ap,x,y,p,state.losses)}
function linkGraph(p){
 const received=state.aps.map(ap=>state.aps.map(target=>rssiAt(ap,target.x,target.y,p)));
 return buildMesh(received,p);
}
// Only threshold-qualified APs in the largest mesh may serve; ALL other APs interfere.
function evaluateClient(c,p,graph){
 const received=state.aps.map(ap=>rssiAt(ap,c.x,c.y,p));
 const result=accessLinks(received,graph.inMesh,p);
 let nearest=-1,nearDist=Infinity,bestMeshSinr=-Infinity;
 for(const [i,ap] of state.aps.entries()){
  const distance=Math.hypot(ap.x-c.x,ap.y-c.y)*.1;
  result.candidates[i].distance=distance;
  if(distance<nearDist){nearDist=distance;nearest=i}
  if(graph.inMesh[i])bestMeshSinr=Math.max(bestMeshSinr,result.candidates[i].sinr);
 }
 const selected=result.candidates[result.serving];
 return {...result,nearest,bestMeshSinr,rssi:selected?.rssi??-Infinity,
  reason:result.connected?'已連線':state.aps.length?'服務 Mesh 內無 AP 達到 Client SINR 門檻':'沒有 AP'};
}
function apMetrics(p,graph,clients,bestIndex,sbest){
 return state.aps.map((ap,i)=>{
  const servingClients=clients.flatMap((row,j)=>row.serving===i?[j]:[]);
  let assignedCells=0,coveredCells=0,peakSinr=-Infinity,totalSinr=0;
  for(let k=0;k<bestIndex.length;k++)if(state.indoor[k]&&bestIndex[k]===i){assignedCells++;totalSinr+=sbest[k];peakSinr=Math.max(peakSinr,sbest[k]);if(sbest[k]>=p.sinr)coveredCells++}
  const peers=graph.edges.filter(e=>e.i===i||e.j===i).map(e=>({peer:e.i===i?e.j:e.i,txSnr:e.i===i?e.snrAB:e.snrBA,rxSnr:e.i===i?e.snrBA:e.snrAB,ok:e.ok}));
  const values=servingClients.map(j=>clients[j].sinr);
  return {servingClients,assignedCells,coveredCells,avgSinr:assignedCells?totalSinr/assignedCells:null,
   peakSinr:Number.isFinite(peakSinr)?peakSinr:null,peers,inMesh:graph.inMesh[i],
   servingAvgSinr:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
   servingMinSinr:values.length?Math.min(...values):null};
 });
}
function calculate(){
 if(!state.map)return;
 const started=performance.now(),p=params(),n=W()*H();
 state.losses=Object.fromEntries(Object.entries(materialDefs).map(([id,material])=>[id,material.loss]));
 const graph=linkGraph(p),maps=state.aps.map(ap=>{
  const values=new Float32Array(n);values.fill(NaN);
  for(let y=0;y<H();y++)for(let x=0;x<W();x++)if(state.indoor[idx(x,y)])values[idx(x,y)]=rssiAt(ap,x,y,p);
  return values;
 });
 const best=new Float32Array(n),bestIndex=new Int16Array(n),sbest=new Float64Array(n);
 best.fill(-Infinity);bestIndex.fill(-1);sbest.fill(-Infinity);
 const noiseMw=10**(noise(p)/10);
 let valid=0,covered=0,sinrCovered=0,sum=0,sinrSum=0,min=Infinity,max=-Infinity;
 for(let i=0;i<n;i++){
  if(!state.indoor[i])continue;valid++;
  // Fixed always-on co-channel powers give the same RSSI/SINR ranking. Keep
  // below-threshold best mesh candidates visible, but do not associate clients.
  for(let ap=0;ap<maps.length;ap++)if(graph.inMesh[ap]&&maps[ap][i]>best[i]){best[i]=maps[ap][i];bestIndex[i]=ap}
  if(bestIndex[i]<0)continue;
  let interference=0;
  for(let ap=0;ap<maps.length;ap++)if(ap!==bestIndex[i])interference+=10**(maps[ap][i]/10);
  sbest[i]=best[i]-10*Math.log10(noiseMw+interference);
  sum+=best[i];sinrSum+=sbest[i];min=Math.min(min,best[i]);max=Math.max(max,best[i]);
  if(best[i]>=p.rssi)covered++;if(sbest[i]>=p.sinr)sinrCovered++;
 }
 const clients=state.clients.map(c=>evaluateClient(c,p,graph)),apInfo=apMetrics(p,graph,clients,bestIndex,sbest);
 state.results={best,bestIndex,sbest,graph,clients,apInfo,valid,covered,sinrCovered,
  avg:state.aps.length&&valid?sum/valid:null,avgSinr:state.aps.length&&valid?sinrSum/valid:null,
  min:Number.isFinite(min)?min:null,max:Number.isFinite(max)?max:null};
 $('calcTime').textContent=`${(performance.now()-started).toFixed(0)} ms`;updateUI();render();setStatus('計算完成');
}
const fmt=(n,unit='')=>Number.isFinite(n)?`${n.toFixed(1)}${unit}`:'—';
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function updateUI(){
 const r=state.results;
 $('coverageStat').textContent=r.valid?fmt(100*r.covered/r.valid,'%'):'—';
 $('sinrCoverageStat').textContent=r.valid?fmt(100*r.sinrCovered/r.valid,'%'):'—';
 $('avgStat').textContent=fmt(r.avg,' dBm');$('rangeStat').textContent=`${fmt(r.max)} / ${fmt(r.min)}`;
 $('sinrStat').textContent=fmt(r.avgSinr,' dB');
 $('meshStat').textContent=`${r.graph.inMesh.filter(Boolean).length} / ${state.aps.length}`;
 $('clientStat').textContent=state.clients.length?fmt(100*r.clients.filter(c=>c.connected).length/state.clients.length,'%'):'—';
 $('apCount').textContent=state.aps.length+' 顆';$('clientCount').textContent=state.clients.length+' 個';
 $('apList').innerHTML=state.aps.map((a,i)=>{
  const m=r.apInfo[i];return `<div class="node" data-ap="${i}"><div class="row"><strong style="color:${apColors[i%apColors.length]}">${safe(a.id)}</strong><button data-delete-ap="${i}">刪除</button></div>
   <div>座標 (${a.x}, ${a.y}) · ${fmt(a.power,' dBm')}</div>
   <div>服務 Mesh：${m.inMesh?'✓':'✕'} · SNR 達標鄰居：${m.peers.filter(v=>v.ok).length}</div>
   <div>Serving Clients：${m.servingClients.length}</div>
   <div>Serving SINR Avg / Min：${fmt(m.servingAvgSinr)} / ${fmt(m.servingMinSinr)} dB</div>
   <div>服務區平均 SINR：${fmt(m.avgSinr,' dB')}</div></div>`;
 }).join('')||'<p class="hint">尚未放置 AP</p>';
 $('clientList').innerHTML=state.clients.map((c,i)=>{
  const v=r.clients[i];return `<div class="node" data-client="${i}"><div class="row"><strong>${safe(c.id)}</strong><button data-delete-client="${i}">刪除</button></div>
   <div>(${c.x}, ${c.y}) · ${v.connected?'🟢 Connected':'🔴 Disconnected'}</div>
   <div>Serving：${v.serving>=0?safe(state.aps[v.serving].id):'—'}</div>
   <div>${v.connected?'Serving':'候選最高'} SINR：${fmt(v.connected?v.sinr:v.bestMeshSinr,' dB')}</div>
   <div>${v.reason}</div></div>`;
 }).join('')||'<p class="hint">尚未放置 Client</p>';
 showDetails();
}
function showDetails(){
 const s=state.selected,r=state.results,p=params();let txt='點選 AP、Client 或地圖位置查看訊號資訊。';
 syncCoordinates();
 if(s?.type==='ap'&&state.aps[s.i]){
  const a=state.aps[s.i],m=r.apInfo[s.i];
  const peers=m.peers.map(v=>`<tr><td>${safe(state.aps[v.peer].id)}</td><td>${fmt(v.txSnr)}</td><td>${fmt(v.rxSnr)}</td><td>${v.ok?'✓':'✕'}</td></tr>`).join('');
  const serving=m.servingClients.map(j=>`${safe(state.clients[j].id)} (${fmt(r.clients[j].sinr,' dB')})`).join('<br>')||'無';
  txt=`<b>${safe(a.id)}</b><br>座標：(${a.x}, ${a.y})<br>發射功率：${fmt(a.power,' dBm')}<br>服務 Mesh：${m.inMesh?'✓':'✕'}<br>Mesh SNR 門檻：${fmt(p.meshSnr,' dB')}<br>Serving Clients：${m.servingClients.length}<br>Serving SINR Avg / Min：${fmt(m.servingAvgSinr)} / ${fmt(m.servingMinSinr)} dB<br>服務區平均 SINR：${fmt(m.avgSinr,' dB')}<br><b>Serving Clients 明細</b><br>${serving}<br><b>AP–AP 雙向 SNR（dB）</b><table class="mini-table"><thead><tr><th>AP</th><th>TX SNR</th><th>RX SNR</th><th>連線</th></tr></thead><tbody>${peers||'<tr><td colspan="4">無其他 AP</td></tr>'}</tbody></table>`;
 }else if(s?.type==='client'&&state.clients[s.i]){
  const c=state.clients[s.i],v=r.clients[s.i],link=v.candidates[v.serving];
  const rows=v.candidates.map(q=>`<tr><td>${safe(state.aps[q.ap].id)}${q.ap===v.serving?' ★':''}</td><td>${fmt(q.rssi)}</td><td>${fmt(q.snr)}</td><td>${fmt(q.sinr)}</td><td>${q.mesh?'✓':'✕'}</td><td>${q.valid?'✓':'✕'}</td></tr>`).join('');
  txt=`<b>${safe(c.id)}</b><br>位置：(${c.x}, ${c.y})<br>最近 AP：${v.nearest>=0?safe(state.aps[v.nearest].id):'—'}<br>Serving AP：${v.serving>=0?safe(state.aps[v.serving].id):'—'}<br>RSSI：${fmt(v.rssi,' dBm')}<br>Serving SINR：${fmt(v.sinr,' dB')}<br>Noise：${fmt(noise(p),' dBm')}<br>總干擾：${fmt(link?.interferenceDbm,' dBm')}<br>Noise + Interference：${fmt(link?.noiseInterferenceDbm,' dBm')}<br>Client SINR 門檻：${fmt(p.sinr,' dB')}<br>Connected：${v.connected}<br>原因：${v.reason}<br><b>候選 AP 訊號比較（dBm / dB）</b><table class="mini-table"><thead><tr><th>AP</th><th>RSSI</th><th>SNR</th><th>SINR</th><th>Mesh</th><th>達標</th></tr></thead><tbody>${rows||'<tr><td colspan="6">無 AP</td></tr>'}</tbody></table>`;
 }else if(state.probe){
  const {x,y}=state.probe,i=idx(x,y),a=r.bestIndex[i];
  txt=`<b>地圖位置 (${x}, ${y})</b><br>材質：${materialDefs[state.map.wall_map[y][x]].name}<br>有效室內：${!!state.indoor[i]}<br>Mesh 最佳 AP：${a>=0?safe(state.aps[a].id):'—'}<br>RSSI：${fmt(r.best[i],' dBm')}<br>SINR：${fmt(r.sbest[i],' dB')}<br>Noise：${fmt(noise(p),' dBm')}`;
 }
 $('details').innerHTML=txt;
}
function color(t){t=clamp(t,0,1);if($('reverse').checked)t=1-t;const stops=[[37,75,156],[64,178,192],[103,201,116],[246,213,69],[236,67,62]],z=t*(stops.length-1),k=Math.min(stops.length-2,Math.floor(z)),a=z-k;return stops[k].map((v,j)=>Math.round(v*(1-a)+stops[k+1][j]*a))}
const off=document.createElement('canvas'),offctx=off.getContext('2d');function render(){if(!state.map||!state.results)return;let w=W(),h=H(),r=state.results;off.width=w;off.height=h;let image=offctx.createImageData(w,h),strong=number('maxColor',-30),weak=number('minColor',-100);if(strong<=weak)strong=weak+1;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=idx(x,y),k=i*4,m=state.map.wall_map[y][x],rgb=[20,34,54];if(state.indoor[i]){if(state.mode==='coverage'){let a=r.bestIndex[i];rgb=a<0?[29,44,64]:hexToRgb(apColors[a%apColors.length]);if(r.best[i]<params().rssi)rgb=rgb.map(v=>Math.round(v*.35))}else if(state.mode==='mesh'){rgb=[30,47,65]}else{let v=state.mode==='sinr'?r.sbest[i]:r.best[i],lo=state.mode==='sinr'?-10:weak,hi=state.mode==='sinr'?40:strong;rgb=Number.isFinite(v)?color((v-lo)/(hi-lo)):[26,42,65]}}if(m&&$('showMaterials').checked){let c=hexToRgb(materialDefs[m].color);rgb=c.map((v,j)=>Math.round(v*.92+rgb[j]*.08))}if(state.map.forbidden[y][x]&&m===0){rgb=rgb.map((v,j)=>Math.round(v*.6+([100,46,77][j])*.4))}image.data[k]=rgb[0];image.data[k+1]=rgb[1];image.data[k+2]=rgb[2];image.data[k+3]=255}offctx.putImageData(image,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();let {scale,ox,oy}=state.view;ctx.translate(ox,oy);ctx.scale(scale,scale);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,0,0,canvas.width,canvas.height);let cw=canvas.width/w,ch=canvas.height/h;if($('showGrid').checked&&w<=150){ctx.strokeStyle='#ffffff22';ctx.lineWidth=.4;ctx.beginPath();for(let x=0;x<=w;x++){ctx.moveTo(x*cw,0);ctx.lineTo(x*cw,canvas.height)}for(let y=0;y<=h;y++){ctx.moveTo(0,y*ch);ctx.lineTo(canvas.width,y*ch)}ctx.stroke()}if($('showLinks').checked||state.mode==='mesh'){
 const line=(x1,y1,x2,y2,style='#f0f9ff',dash=[])=>{
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
  ctx.strokeStyle=style;ctx.lineWidth=2.4;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
 };
 // Preserve every qualified bidirectional AP-AP SNR edge, including cycles.
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
for(let i=0;i<state.aps.length;i++){let a=state.aps[i],x=(a.x+.5)*cw,y=(a.y+.5)*ch;ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fillStyle=apColors[i%apColors.length];ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#081525';ctx.stroke();ctx.fillStyle='#071522';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);ctx.fillStyle='#fff';ctx.font='bold 11px sans-serif';ctx.fillText(a.id,x,y-18)}for(let i=0;i<state.clients.length;i++){let c=state.clients[i],x=(c.x+.5)*cw,y=(c.y+.5)*ch;ctx.fillStyle=r.clients[i].connected?'#7df3b1':'#ff8390';ctx.fillRect(x-5,y-5,10,10);ctx.strokeStyle='#091421';ctx.lineWidth=2;ctx.strokeRect(x-5,y-5,10,10);ctx.fillStyle='#fff';ctx.font='10px sans-serif';ctx.fillText(c.id,x,y-12)}if(state.probe){let {x,y}=state.probe;ctx.strokeStyle='#fff';ctx.lineWidth=1.6;ctx.strokeRect(x*cw,y*ch,cw,ch)}ctx.restore();$('legendStrong').textContent=state.mode==='sinr'?'40 dB':state.mode==='coverage'?'AP 分區':`${strong} dBm`;$('legendWeak').textContent=state.mode==='sinr'?'-10 dB':state.mode==='coverage'?'':`${weak} dBm`;$('gradient').style.display=['coverage','mesh'].includes(state.mode)?'none':'block';$('gradient').style.background=$('reverse').checked?'linear-gradient(90deg,#3263c9,#42b6a4,#facc15,#ef4444)':'linear-gradient(90deg,#ef4444,#facc15,#42b6a4,#3263c9)'}
function hexToRgb(h){return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16))}
function point(ev){let rect=canvas.getBoundingClientRect(),u=(ev.clientX-rect.left)*canvas.width/rect.width,v=(ev.clientY-rect.top)*canvas.height/rect.height,{scale,ox,oy}=state.view;return {x:Math.floor((u-ox)/scale/canvas.width*W()),y:Math.floor((v-oy)/scale/canvas.height*H()),u,v}}
function hit(x,y){for(let i=state.clients.length-1;i>=0;i--)if(Math.hypot(state.clients[i].x-x,state.clients[i].y-y)<=1.3)return {type:'client',i};for(let i=state.aps.length-1;i>=0;i--)if(Math.hypot(state.aps[i].x-x,state.aps[i].y-y)<=1.3)return {type:'ap',i};return null}
function addNode(type,x,y){if(!validPlacement(x,y)){toast('只能放在有效室內、非禁止且無牆壁的格子');return}if(type==='ap'){state.aps.push({id:`AP ${String(nextAP++).padStart(2,'0')}`,x,y,power:params().power});state.selected={type:'ap',i:state.aps.length-1}}else{state.clients.push({id:`Client ${String(nextClient++).padStart(2,'0')}`,x,y});state.selected={type:'client',i:state.clients.length-1}}state.probe=null;state.seq++;calculate()}
canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(!state.map)return;canvas.setPointerCapture(e.pointerId);let p=point(e);if(e.button===2){state.pan={u:p.u,v:p.v,ox:state.view.ox,oy:state.view.oy};return}if(!inside(p.x,p.y))return;if(state.tool==='ap'||state.tool==='client'){addNode(state.tool,p.x,p.y);return}if(state.tool==='indoor'||state.tool==='outdoor'){state.drag={type:'paint',value:state.tool==='indoor'?1:-1};paint(p.x,p.y);return}let h=hit(p.x,p.y);if(h&&state.tool==='select'){state.selected=h;state.probe=null;state.drag={type:'node',nodeType:h.type,i:h.i,x:p.x,y:p.y};showDetails();render()}else{state.selected=null;state.probe={x:p.x,y:p.y};showDetails();render()}});
function paint(x,y){if(!inside(x,y))return;let i=idx(x,y);if(state.map.wall_map[y][x]!==0)return;state.manual[i]=state.drag.value;state.indoor[i]=state.drag.value===1?1:0;render()}
canvas.addEventListener('pointermove',e=>{if(!state.map)return;let p=point(e);$('coords').textContent=inside(p.x,p.y)?`x: ${p.x} · y: ${p.y}  |  ${(p.x+.5)/10} m, ${(p.y+.5)/10} m`:'x: — · y: —';if(state.pan){state.view.ox=state.pan.ox+p.u-state.pan.u;state.view.oy=state.pan.oy+p.v-state.pan.v;render();return}if(!state.drag||!inside(p.x,p.y))return;if(state.drag.type==='paint'){paint(p.x,p.y);return}if(validPlacement(p.x,p.y)){let node=state.drag.nodeType==='client'?state.clients[state.drag.i]:state.aps[state.drag.i];if(node){node.x=p.x;node.y=p.y;state.drag.moved=true;render();setStatus('移動中，放開後更新 SINR / Mesh / Serving')}}});
canvas.addEventListener('pointerup',()=>{state.pan=null;if(state.drag){let d=state.drag;state.drag=null;if(d.type==='paint'||d.moved)calculate();else render()}});canvas.addEventListener('pointercancel',()=>{state.drag=null;state.pan=null;calculate()});
canvas.addEventListener('wheel',e=>{e.preventDefault();let p=point(e),old=state.view.scale,newScale=clamp(old*(e.deltaY<0?1.15:1/1.15),1,8),ratio=newScale/old;state.view.ox=p.u-(p.u-state.view.ox)*ratio;state.view.oy=p.v-(p.v-state.view.oy)*ratio;state.view.scale=newScale;render()},{passive:false});
function setTool(t){state.tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t))}document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(v=>v.classList.toggle('active',v===b));render()}));
['showMaterials','showGrid','showLinks','reverse','maxColor','minColor'].forEach(id=>$(id).addEventListener('change',render));['power','freq','band','nf','threshold','meshSnrThreshold','sinrThreshold'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='power')state.aps.forEach(a=>a.power=params().power);calculate()}));
$('materials').innerHTML=Object.entries(materialDefs).filter(([id])=>id!=='0').map(([id,m])=>`<label class="material"><span class="swatch" style="background:${m.color}"></span>${m.name} (${id})<input data-material="${id}" type="number" value="${m.loss}" min="0" step="0.5"></label>`).join('');document.querySelectorAll('[data-material]').forEach(el=>el.addEventListener('change',()=>{materialDefs[el.dataset.material].loss=Math.max(0,Number(el.value)||0);calculate()}));
$('apList').addEventListener('click',e=>{const del=e.target.closest('[data-delete-ap]');if(del){state.aps.splice(Number(del.dataset.deleteAp),1);state.selected=null;calculate();return}const node=e.target.closest('[data-ap]');if(node){state.selected={type:'ap',i:Number(node.dataset.ap)};state.probe=null;showDetails();render()}});
$('clientList').addEventListener('click',e=>{const del=e.target.closest('[data-delete-client]');if(del){state.clients.splice(Number(del.dataset.deleteClient),1);state.selected=null;calculate();return}const node=e.target.closest('[data-client]');if(node){state.selected={type:'client',i:Number(node.dataset.client)};state.probe=null;showDetails();render()}});
$('rebuildMask').addEventListener('click',()=>{state.manual.fill(0);buildMask();state.aps=state.aps.filter(a=>validPlacement(a.x,a.y));state.clients=state.clients.filter(c=>validPlacement(c.x,c.y));state.selected=null;calculate();toast('室內區域已重新辨識；手動修正已清除')});$('reset').addEventListener('click',()=>{if(!confirm('確定移除所有 AP 與 Client？'))return;state.aps=[];state.clients=[];state.selected=null;calculate()});
$('file').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  const obj=JSON.parse(await file.text());
  if(obj.map&&Array.isArray(obj.aps)){
   loadMap(obj.map,file.name);
   if(Array.isArray(obj.manual)&&obj.manual.length===W()*H()){state.manual=Int8Array.from(obj.manual);buildMask()}
   if(obj.materialLoss)for(const [id,value] of Object.entries(obj.materialLoss))if(materialDefs[id]&&Number.isFinite(Number(value))&&Number(value)>=0){materialDefs[id].loss=Number(value);const el=document.querySelector(`[data-material="${id}"]`);if(el)el.value=value}
   const settings=obj.settings??{};
   for(const id of ['power','freq','band','nf','threshold','meshSnrThreshold','sinrThreshold','maxColor','minColor'])if(settings[id]!==undefined)$(id).value=settings[id];
   if(settings.meshSnrThreshold===undefined&&settings.sinrThreshold!==undefined)$('meshSnrThreshold').value=settings.sinrThreshold;
   const validNode=node=>node&&Number.isInteger(node.x)&&Number.isInteger(node.y)&&validPlacement(node.x,node.y);
   state.aps=obj.aps.filter(validNode).map(a=>({id:String(a.id),x:a.x,y:a.y,power:Number.isFinite(Number(a.power))?Number(a.power):params().power}));
   state.clients=(Array.isArray(obj.clients)?obj.clients:[]).filter(validNode).map(c=>({id:String(c.id),x:c.x,y:c.y}));
   nextAP=Math.max(1,...state.aps.map(a=>Number(a.id.match(/\d+/)?.[0]||0)+1));
   nextClient=Math.max(1,...state.clients.map(c=>Number(c.id.match(/\d+/)?.[0]||0)+1));
   calculate();toast(obj.version===3?'專案匯入成功':'舊專案已使用新的 SNR Mesh / SINR 規則重新計算');
  }else{loadMap(obj,file.name);toast('地圖匯入成功')}
 }catch(err){toast('匯入失敗：'+err.message)}
 e.target.value='';
});
$('sample').addEventListener('click',loadSample);async function loadSample(){const token=state.seq;try{setStatus('載入範例中…');let res=await fetch('./assets/example1.json');if(!res.ok)throw Error('HTTP '+res.status);let json=await res.json();if(token!==state.seq)return;loadMap(json,'example1.json');toast('範例地圖載入完成')}catch(err){setStatus('請匯入 JSON');toast('範例載入失敗；直接開啟 file:// 時請手動匯入 JSON')}}
$('export').addEventListener('click',()=>{
 const settings={};['power','freq','band','nf','threshold','meshSnrThreshold','sinrThreshold','maxColor','minColor'].forEach(id=>settings[id]=$(id).value);
 const data={version:3,radioModel:'ap_mesh_update_snr_mesh_sinr_access',map:state.map,aps:state.aps,clients:state.clients,manual:Array.from(state.manual),materialLoss:Object.fromEntries(Object.entries(materialDefs).map(([id,m])=>[id,m.loss])),settings};
 const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='wifi-mesh-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
// Embedded empty map allows file:// preview without a server; GitHub Pages loads the example automatically.
loadMap({id:0,width:100,height:100,wall_map:Array.from({length:100},(_,y)=>Array.from({length:100},(_,x)=>x===0||x===99||y===0||y===99?10:0)),forbidden:Array.from({length:100},()=>Array(100).fill(0))},'空白地圖');loadSample();
