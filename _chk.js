
const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
const round=n=>Math.round(n);
// weights for the five criteria (sum=100)
const W={legal:10,grid:20,terrain:15,foot:25,roi:30};

// ---------- map ----------
const map=L.map('map',{zoomControl:true}).setView([12.9560,77.7010],14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
let marker=null;
map.on('click',e=>setPoint(e.latlng.lat,e.latlng.lng));

function setMarker(lat,lng){
  if(marker)marker.setLatLng([lat,lng]);
  else marker=L.marker([lat,lng]).addTo(map);
}

// ---------- fetch helpers with timeout ----------
async function jget(url,opts={},ms=20000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(url,{...opts,signal:c.signal});if(!r.ok)throw new Error(r.status);return await r.json();}
  finally{clearTimeout(t);}
}
const OVERPASS='https://overpass-api.de/api/interpreter';
async function overpassCount(query){
  const data=await jget(OVERPASS,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'data='+encodeURIComponent(query)});
  const el=(data.elements||[]).find(e=>e.type==='count');
  return el?parseInt(el.tags.total||el.tags.nodes||'0',10):0;
}

// ---------- live metrics ----------
async function getTerrain(lat,lng){
  const d=0.0015, dl=d/Math.cos(lat*Math.PI/180);
  const lats=[lat,lat+d,lat-d,lat,lat].join(',');
  const lngs=[lng,lng,lng,lng+dl,lng-dl].join(',');
  const j=await jget(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
  const el=j.elevation; const ctr=el[0];
  const maxDiff=Math.max(...el.slice(1).map(v=>Math.abs(v-ctr)));
  const slope=maxDiff/167*100;                 // % grade over ~167m
  const score=clamp(100-slope*8);
  return {score:round(score),fact:`Elevation ${round(ctr)} m · slope ≈ ${slope.toFixed(1)}% over 167 m`};
}
async function getFoot(lat,lng){
  const q=`[out:json][timeout:25];(node(around:500,${lat},${lng})[shop];node(around:500,${lat},${lng})[amenity];node(around:500,${lat},${lng})[office];node(around:500,${lat},${lng})[public_transport];);out count;`;
  const n=await overpassCount(q);
  const score=clamp(Math.log10(n+1)/Math.log10(300)*100);
  return {score:round(score),count:n,fact:`${n} POIs (shops, transit, offices, amenities) within 500 m`};
}
async function getCompetition(lat,lng){
  const q=`[out:json][timeout:25];(node(around:1500,${lat},${lng})[amenity=charging_station];);out count;`;
  const n=await overpassCount(q);
  const score=clamp(100-n*12);
  return {score:round(score),count:n};
}

// ---------- render one factor ----------
function paintBar(k,score){
  const bar=document.getElementById('b-'+k);
  bar.className=score<45?'low':score<65?'mid':'';
  bar.style.width=score+'%';
  document.getElementById('v-'+k).textContent=score;
}
function setFact(k,txt,err=false){const f=document.getElementById('f-'+k);if(f){f.textContent=txt;f.className='fact'+(err?' err':'');}}
function loading(k){document.getElementById('v-'+k).innerHTML='<span class="spin"></span>';}

const state={terrain:null,foot:null,roi:null,legal:70,grid:70};

function recomputeOverall(){
  // only count metrics that resolved; manual always present
  const parts=[];
  for(const k of ['legal','grid','terrain','foot','roi']){
    const s=state[k];
    if(s!=null)parts.push([W[k],s]);
  }
  if(!parts.length)return;
  const wsum=parts.reduce((a,[w])=>a+w,0);
  const score=round(parts.reduce((a,[w,s])=>a+w*s,0)/wsum);
  document.getElementById('score').textContent=score;
  const v=document.getElementById('verdict');v.style.display='inline-block';
  if(score>=75){v.textContent='Strong site';v.style.color=getCss('--accent');v.style.background=getCss('--accent-soft');}
  else if(score>=55){v.textContent='Viable, with caveats';v.style.color=getCss('--warn');v.style.background='#fbf2dd';}
  else{v.textContent='High risk';v.style.color=getCss('--neg');v.style.background='#fbeae9';}
}
const getCss=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------- orchestrate ----------
async function analyze(lat,lng){
  ['terrain','foot','roi'].forEach(loading);
  state.terrain=state.foot=state.roi=null;
  document.getElementById('score').textContent='…';

  // terrain
  getTerrain(lat,lng).then(r=>{state.terrain=r.score;paintBar('terrain',r.score);setFact('terrain',r.fact);recomputeOverall();})
    .catch(()=>{setFact('terrain','Live terrain source unreachable — try again.',true);document.getElementById('v-terrain').textContent='—';});

  // foot traffic + competition -> ROI (need both)
  let footScore=null,compScore=null,compCount=null;
  const fp=getFoot(lat,lng).then(r=>{footScore=r.score;state.foot=r.score;paintBar('foot',r.score);setFact('foot',r.fact);recomputeOverall();})
    .catch(()=>{setFact('foot','Live POI source unreachable — try again.',true);document.getElementById('v-foot').textContent='—';});
  const cp=getCompetition(lat,lng).then(r=>{compScore=r.score;compCount=r.count;})
    .catch(()=>{compScore=null;});

  Promise.allSettled([fp,cp]).then(()=>{
    if(footScore==null){document.getElementById('v-roi').textContent='—';setFact('roi','Needs demand data to compute.',true);return;}
    const comp=compScore==null?70:compScore;
    const roi=round(clamp(0.55*footScore+0.45*comp));
    state.roi=roi;paintBar('roi',roi);
    const compTxt=compCount==null?'competition unknown':`${compCount} existing charger${compCount===1?'':'s'} within 1.5 km`;
    setFact('roi',`Demand proxy ${footScore} + ${compTxt} → ROI index ${roi}.`);
    recomputeOverall();
  });
}

// ---------- point selection ----------
async function setPoint(lat,lng,label){
  setMarker(lat,lng);map.panTo([lat,lng]);
  document.getElementById('coords').textContent=lat.toFixed(5)+', '+lng.toFixed(5);
  document.getElementById('place').textContent=label||'Pinned location';
  if(!label){ // reverse geocode quietly
    jget(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
      .then(j=>{if(j.display_name)document.getElementById('place').textContent=j.display_name.split(',').slice(0,3).join(', ');})
      .catch(()=>{});
  }
  analyze(lat,lng);
}

// ---------- search ----------
async function search(){
  const q=document.getElementById('q').value.trim();if(!q)return;
  const btn=document.getElementById('go');btn.disabled=true;btn.textContent='…';
  try{
    const j=await jget(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`);
    if(j&&j[0]){map.setView([+j[0].lat,+j[0].lon],15);
      setPoint(+j[0].lat,+j[0].lon,j[0].display_name.split(',').slice(0,3).join(', '));}
    else alert('No match found for that search.');
  }catch(e){alert('Geocoding unavailable right now — click the map to pick a point instead.');}
  finally{btn.disabled=false;btn.textContent='Search';}
}
document.getElementById('go').addEventListener('click',search);
document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')search();});

// manual sliders
['legal','grid'].forEach(k=>{
  const r=document.getElementById('r-'+k);
  r.addEventListener('input',()=>{state[k]=+r.value;document.getElementById('v-'+k).textContent=r.value;recomputeOverall();});
});

// initial sample point (ORR / Marathahalli)
setPoint(12.9560,77.7010,'ORR Junction — Marathahalli, Bengaluru');
