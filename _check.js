
/* ---------- tabs ---------- */
const tabs=document.querySelectorAll('.tab');
tabs.forEach(t=>t.addEventListener('click',()=>{
  tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen'+t.dataset.s).classList.add('active');
  window.scrollTo({top:document.querySelector('.tabs').offsetTop-10,behavior:'smooth'});
}));

/* ============ SCREEN 1 : SITE FINDER ============ */
/* factors: higher = better. Order matches the five criteria. */
const sites=[
  {id:1,name:"ORR Junction — Marathahalli",x:230,y:70,score:90,
    f:{"Land legal / clear title":86,"Grid load headroom":90,"Terrain suitability":85,"Foot traffic":96,"ROI":92},
    note:"Clean title and spare grid load at the adjacent substation, on the highest-traffic stretch of the ORR corridor."},
  {id:2,name:"Whitefield Tech Park gate",x:340,y:200,score:82,
    f:{"Land legal / clear title":92,"Grid load headroom":68,"Terrain suitability":80,"Foot traffic":88,"ROI":80},
    note:"Uncontested land and captive office-fleet demand, but grid load is tight — a transformer upgrade may be needed beyond 8 DC units."},
  {id:3,name:"Electronic City Toll",x:60,y:260,score:74,
    f:{"Land legal / clear title":70,"Grid load headroom":66,"Terrain suitability":72,"Foot traffic":90,"ROI":70},
    note:"Strong highway traffic, but a pending boundary dispute on the parcel and premium land cost compress early ROI."},
  {id:4,name:"Hebbal Flyover edge",x:60,y:70,score:64,
    f:{"Land legal / clear title":58,"Grid load headroom":80,"Terrain suitability":62,"Foot traffic":72,"ROI":55},
    note:"Sloped terrain raises civil cost and two operators already sit within 2km — splitting demand and dragging ROI down."}
];
const pinsG=document.getElementById('pins'),listG=document.getElementById('sitelist');
sites.forEach(s=>{
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','pin');g.dataset.id=s.id;
  g.innerHTML=`<circle class="halo" cx="${s.x}" cy="${s.y}" r="26"></circle>
    <circle class="body" cx="${s.x}" cy="${s.y}" r="15"></circle>
    <text x="${s.x}" y="${s.y}">${s.id}</text>`;
  g.addEventListener('click',()=>selectSite(s.id));pinsG.appendChild(g);
  const row=document.createElement('div');row.className='siterow';row.dataset.id=s.id;
  row.innerHTML=`<div class="rank">${s.id}</div><div class="nm">${s.name}</div><div class="sc">${s.score}<small>/100</small></div>`;
  row.addEventListener('click',()=>selectSite(s.id));listG.appendChild(row);
});
function selectSite(id){
  const s=sites.find(x=>x.id===id);
  document.querySelectorAll('.pin').forEach(p=>p.classList.toggle('sel',p.dataset.id==id));
  document.querySelectorAll('.siterow').forEach(r=>r.classList.toggle('sel',r.dataset.id==id));
  document.getElementById('sName').textContent=s.name;
  animateScore(s.score);
  const fc=document.getElementById('sFactors');fc.innerHTML='';
  Object.entries(s.f).forEach(([k,v])=>{
    const d=document.createElement('div');d.className='factor';
    d.innerHTML=`<div class="top"><b>${k}</b><span>${v}</span></div><div class="bar"><i class="${v<65?'low':''}" style="width:0%"></i></div>`;
    fc.appendChild(d);requestAnimationFrame(()=>d.querySelector('i').style.width=v+'%');
  });
  document.getElementById('sNote').textContent=s.note;
}
let scoreAnim;
function animateScore(t){const el=document.getElementById('sScore');let c=0;clearInterval(scoreAnim);
  scoreAnim=setInterval(()=>{c+=Math.ceil((t-c)/6);if(c>=t){c=t;clearInterval(scoreAnim)}el.textContent=c;},28);}
selectSite(1);

/* ============ SCREEN 2 : PLANNER ============ */
let pType='dc';
const fmt=n=>'₹'+(n>=1e7?(n/1e7).toFixed(2)+' Cr':n>=1e5?(n/1e5).toFixed(1)+' L':Math.round(n/1000)+'k');
function plan(){
  const n=+document.getElementById('rChargers').value;
  const rent=+document.getElementById('rRent').value*1000;
  const util=+document.getElementById('rUtil').value;
  document.getElementById('vChargers').textContent=n;
  document.getElementById('vRent').textContent='₹'+document.getElementById('rRent').value+'k';
  document.getElementById('vUtil').textContent=util;
  const unitCost=pType==='dc'?1100000:280000, kwhPS=pType==='dc'?25:12, margin=pType==='dc'?8:5;
  const capex=n*unitCost+900000, sess=n*util*30;
  const revenue=sess*kwhPS*(margin+(pType==='dc'?10:8));
  const power=sess*kwhPS*(pType==='dc'?9:7);
  const opex=rent+power+n*3000+45000, net=revenue-opex;
  document.getElementById('kCapex').textContent=fmt(capex);
  document.getElementById('kOpex').textContent=fmt(opex);
  document.getElementById('kRev').textContent=fmt(revenue);
  const netEl=document.getElementById('kNet');
  netEl.textContent=(net<0?'-':'')+fmt(Math.abs(net));
  netEl.className='num '+(net>=0?'good':'neg');
  const pay=document.getElementById('kPay'),note=document.getElementById('kPayNote');
  if(net<=0){pay.textContent='No payback';pay.style.color='var(--neg)';
    note.textContent='This configuration loses money monthly — adjust utilization, rent or charger count.';}
  else{const m=capex/net;pay.style.color='var(--accent)';
    pay.textContent=m<12?m.toFixed(1)+' months':(m/12).toFixed(1)+' years';
    note.textContent=`Recovering ${fmt(capex)} capex at ${fmt(net)} net/month.`;}
}
document.querySelectorAll('#rChargers,#rRent,#rUtil').forEach(r=>r.addEventListener('input',plan));
document.querySelectorAll('#segType button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('#segType button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');pType=b.dataset.t;plan();}));
plan();

/* ============ SCREEN 3 : DYNAMIC PRICING ============ */
const demand=[2,1,1,1,2,4,8,14,18,15,11,10,12,11,9,10,13,19,22,20,14,9,6,3];
const basePrice=18, maxD=Math.max(...demand);
const dynPrice=d=>Math.round(14+(d/maxD)*14);
let mode='dyn', selHour=18;
const chart=document.getElementById('chart'),hoursEl=document.getElementById('hours');
demand.forEach((d,h)=>{
  const col=document.createElement('div');col.className='col';col.dataset.h=h;
  if(d>=16)col.classList.add('peak');
  col.innerHTML=`<div class="pricetag">₹${dynPrice(d)}</div><div class="demand" style="height:${8+d/maxD*82}%"></div>`;
  col.addEventListener('click',()=>{selHour=h;renderPricing();});chart.appendChild(col);
  const hd=document.createElement('div');hd.textContent=(h%3===0)?(h+'h'):'';hoursEl.appendChild(hd);
});
document.querySelectorAll('#segMode button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('#segMode button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');mode=b.dataset.m;renderPricing();}));
function renderPricing(){
  const kwh=25;let s=0,dy=0;
  demand.forEach((d)=>{s+=d*kwh*basePrice;dy+=d*kwh*dynPrice(d);});
  document.querySelectorAll('#chart .col').forEach(c=>{
    c.classList.toggle('sel',+c.dataset.h===selHour);
    c.querySelector('.pricetag').textContent= mode==='dyn' ? '₹'+dynPrice(demand[+c.dataset.h]) : '₹'+basePrice;});
  document.getElementById('revStatic').textContent=fmt(s);
  document.getElementById('revDyn').textContent=fmt(dy);
  const up=((dy-s)/s*100).toFixed(1);
  document.getElementById('boxStatic').classList.toggle('win',mode==='static');
  document.getElementById('boxDyn').classList.toggle('win',mode==='dyn');
  const upl=document.getElementById('uplift');
  if(mode==='dyn') upl.innerHTML=`Dynamic pricing lifts daily revenue by <b>+${up}%</b> — selected hour ${selHour}:00 → <b>₹${dynPrice(demand[selHour])}/kWh</b> at ${demand[selHour]} sessions.`;
  else upl.innerHTML=`Flat ₹${basePrice}/kWh all day. Toggle to dynamic to recover <b>+${up}%</b> from peak demand.`;
}
renderPricing();

/* ---------- tile heatmap ---------- */
const zones=["Indiranagar","Koramangala","HSR Layout","Whitefield","ORR Tech","MG Road",
  "Jayanagar","Marathahalli","BTM Layout","Hebbal","Yelahanka","JP Nagar",
  "Sarjapur","Banashankari","Malleshwaram","KR Puram","Bellandur","E-City"];
const tdemand=[.92,.88,.74,.81,.97,.7,.55,.83,.6,.5,.42,.58,.66,.48,.52,.69,.86,.78];
const tgrid=document.getElementById('tilegrid');
zones.forEach((z,i)=>{
  const price=Math.round(14+tdemand[i]*16);
  const a=(0.1+tdemand[i]*0.85).toFixed(2);
  const el=document.createElement('div');el.className='tz';el.dataset.i=i;
  el.style.background=`rgba(17,163,107,${a})`;
  el.style.color=tdemand[i]>0.5?'#fff':'var(--ink)';
  el.style.borderColor=tdemand[i]>0.5?'transparent':'var(--line)';
  el.innerHTML=`<span class="p">₹${price}</span><span class="z">${z}</span>`;
  el.addEventListener('click',()=>{
    document.querySelectorAll('.tz').forEach(t=>t.classList.remove('sel'));
    el.classList.add('sel');
    document.getElementById('tzInfo').innerHTML=`<b style="color:var(--ink)">${z}</b> · ₹${price}/kWh · demand index ${(tdemand[i]*100|0)}`;
  });
  tgrid.appendChild(el);
});

/* ============ SCREEN 4 : CHARGE MARKET ============ */
const mkt={series:[18,17.6,18.2,19,18.7,19.4,20.1,19.6,20.3,21,20.6,21.4,22,21.5,22.3,21.8,22.6,23.1],
  side:'long',stake:5000,entry:null,open:false};
const traders=["fleetops_BLR","ev_arbitrage","gridhedge","node_42","chargecap","volt_trader","kw_capital"];
const svg=document.getElementById('mSvg');
function drawChart(){
  const s=mkt.series,n=s.length,mn=Math.min(...s)-1,mx=Math.max(...s)+1,W=600,H=150;
  const X=i=>i/(n-1)*W, Y=v=>H-((v-mn)/(mx-mn))*(H-14)-7;
  let line=s.map((v,i)=>`${i?'L':'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const up=s[n-1]>=s[0];const col=up?'#11a36b':'#d4584f';
  const area=`${line} L600 ${H} L0 ${H} Z`;
  svg.innerHTML=`<path d="${area}" fill="${up?'rgba(17,163,107,.10)':'rgba(212,88,79,.10)'}"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${X(n-1)}" cy="${Y(s[n-1])}" r="4" fill="${col}"/>`;
}
function curP(){return mkt.series[mkt.series.length-1];}
function fmtRs(n){return '₹'+Math.round(n).toLocaleString('en-IN');}
function renderMkt(){
  const c=curP(),first=mkt.series[0];
  document.getElementById('mPrice').textContent='₹'+c.toFixed(2);
  const pct=((c-first)/first*100);
  const chg=document.getElementById('mChg');
  chg.textContent=(pct>=0?'+':'')+pct.toFixed(1)+'%';chg.className='chg '+(pct>=0?'up':'down');
  document.getElementById('mEntry').textContent=mkt.open?'₹'+mkt.entry.toFixed(2):'—';
  const pnlEl=document.getElementById('mPnl');
  if(mkt.open){
    const move=(c-mkt.entry)/mkt.entry;
    const pnl=(mkt.side==='long'?move:-move)*mkt.stake;
    pnlEl.textContent=(pnl<0?'-':'+')+fmtRs(Math.abs(pnl));
    pnlEl.className='num '+(pnl>=0?'good':'neg');
  }else{pnlEl.textContent='—';pnlEl.className='num';}
  drawChart();
}
function feed(who,side,stake,price){
  const f=document.getElementById('mFeed');
  const r=document.createElement('div');r.className='feedrow';
  r.innerHTML=`<span class="who">${who}</span><span><span class="side ${side}">${side==='long'?'▲ LONG':'▼ SHORT'}</span> ${fmtRs(stake)}</span><span>₹${price.toFixed(2)}</span>`;
  f.prepend(r);while(f.children.length>14)f.removeChild(f.lastChild);
}
document.querySelectorAll('.sidebtn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.sidebtn').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');mkt.side=b.dataset.side;renderMkt();}));
document.getElementById('mStake').addEventListener('input',e=>{
  mkt.stake=+e.target.value;
  document.getElementById('mStakeV').textContent='₹'+mkt.stake.toLocaleString('en-IN');renderMkt();});
document.getElementById('mOpen').addEventListener('click',()=>{
  mkt.entry=curP();mkt.open=true;feed('You',mkt.side,mkt.stake,mkt.entry);renderMkt();});
document.getElementById('mClose').addEventListener('click',()=>{
  if(!mkt.open)return;mkt.open=false;feed('You closed',mkt.side,mkt.stake,curP());renderMkt();});
document.getElementById('mTick').addEventListener('click',()=>{
  let p=curP()*(1+(Math.random()-0.45)*0.05);p=Math.max(12,Math.min(32,p));
  mkt.series.push(+p.toFixed(2));if(mkt.series.length>40)mkt.series.shift();
  if(Math.random()>0.4)feed(traders[Math.random()*traders.length|0],
    Math.random()>0.5?'long':'short',(Math.random()*20+1|0)*1000,curP());
  renderMkt();});
[traders[0],traders[2],traders[4]].forEach((t,i)=>feed(t,i%2?'short':'long',(i+2)*3000,17.6+i*0.6));
renderMkt();
