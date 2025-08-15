// German locale helpers
const fmtEUR = new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2});
const fmtUSD = new Intl.NumberFormat('de-DE',{style:'currency',currency:'USD',maximumFractionDigits:2});
const fmtPct = new Intl.NumberFormat('de-DE',{style:'percent',maximumFractionDigits:2});
const $ = (sel,root=document)=>root.querySelector(sel);
const esc = s => (s??'').toString().replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[c]));
const todayStr = ()=> new Date().toISOString().slice(0,10);
function curFor(symbol){ return /\.de$/i.test(symbol||'') ? 'EUR' : 'USD'; }
function money(v, cur){ return (cur==='EUR'? fmtEUR:fmtUSD).format(v||0); }

function plPct(rec){
  const base = rec.recPrice;
  if(rec.status==='sold'){ if(rec.soldPrice && base) return (rec.soldPrice-base)/base; return NaN; }
  const px = rec._livePrice ?? 0;
  if(!px) return NaN; // avoid -100% when no live price
  if(base) return (px-base)/base;
  return NaN;
}
function plAmt(rec){
  if(rec.status==='sold'){
    if(rec.soldPrice!=null && rec.recPrice!=null) return rec.soldPrice - rec.recPrice;
    return 0;
  }
  const px = rec._livePrice ?? 0;
  if(!px) return 0;
  if(rec.recPrice!=null) return px - rec.recPrice;
  return 0;
}

async function fetchYahoo(symbol){
  try{
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('yahoo http '+res.status);
    const j = await res.json();
    const q = j?.quoteResponse?.result?.[0];
    const px = q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice;
    return (px!=null) ? Number(px) : 0;
  }catch(e){ return 0; }
}
async function fetchStooq(symbol){
  try{
    let s = symbol.trim();
    if(/\.[A-Za-z]{2,4}$/.test(s)) s = s.toLowerCase(); else s = s.toLowerCase()+'.us';
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('stooq http '+res.status);
    const txt = await res.text();
    const lines = txt.trim().split(/\r?\n/);
    if(lines.length<2) return 0;
    const close = Number(lines[1].split(',')[6]);
    return isNaN(close) ? 0 : close;
  }catch(e){ return 0; }
}
async function fetchLivePrice(symbol, source){
  let p = 0;
  if(source==='yahoo') p = await fetchYahoo(symbol);
  else if(source==='stooq') p = await fetchStooq(symbol);
  if(!p){
    if(source!=='yahoo') p = await fetchYahoo(symbol);
    if(!p && source!=='stooq') p = await fetchStooq(symbol);
  }
  return p || 0;
}

// state
let raw = [];
let view = [];
let state = { q:'', status:'all', horizon:'all', plan:'all', sort:'updatedAt_desc', page:1, pageSize:10, priceSource:'yahoo' };

function normalize(rec){
  return {
    id: rec.id,
    symbol: rec.symbol||'',
    name: rec.name||'',
    recPrice: Number(rec.recPrice||0),
    recDate: rec.recDate || todayStr(),
    horizon: rec.horizon || 'Kurzfristig', // German label
    reason: rec.reason || '',
    status: (rec.status==='sold'?'sold':'open'),
    managerConfirmed: !!rec.managerConfirmed,
    soldPrice: (rec.soldPrice!=null? Number(rec.soldPrice):undefined),
    soldDate: rec.soldDate,
    createdAt: rec.createdAt||Date.now(),
    updatedAt: rec.updatedAt||Date.now(),
    currency: rec.currency || curFor(rec.symbol),
    plan: (rec.plan==='paid'?'paid':'free'),
    history: Array.isArray(rec.history)? rec.history : [],
    _livePrice: 0, _liveTime: 0,
  };
}

function urlForData(){
  // subpath-safe: index.html and data/ are siblings inside /investitionsdetails/
  return new URL('./data/recommendations.json?v=' + Date.now(), location.href).href;
}

async function load(){
  let list = [];
  try {
    const res = await fetch(urlForData());
    if(res.ok) list = await res.json();
  } catch(e){}
  // Fallback to inline SAMPLE if provided
  if((!Array.isArray(list) || list.length===0) && document.getElementById('SAMPLE')){
    try{ list = JSON.parse(document.getElementById('SAMPLE').textContent||'[]'); }catch(e){}
  }
  raw = (list||[]).map(normalize);
  await refreshPrices();
  render();
}

function applyFilters(){
  let arr = raw.slice();
  const q = state.q.trim().toLowerCase();
  if(q) arr = arr.filter(r => (r.symbol||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q) || (r.reason||'').toLowerCase().includes(q));
  if(state.status!=='all') arr = arr.filter(r => r.status===state.status);
  if(state.horizon!=='all') arr = arr.filter(r => r.horizon===state.horizon);
  if(state.plan!=='all') arr = arr.filter(r => r.plan===state.plan);
  arr.sort((a,b)=>{
    if(state.sort==='updatedAt_desc') return (b.updatedAt||0)-(a.updatedAt||0);
    if(state.sort==='pl_desc') return ((plPct(b)||-Infinity) - (plPct(a)||-Infinity));
    if(state.sort==='recDate_desc') return (a.recDate<b.recDate)?1:-1;
    if(state.sort==='symbol_asc') return (a.symbol||'').localeCompare(b.symbol||'');
    return 0;
  });
  view = arr;
}

function paginate(list){
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(Math.max(1, state.page), pages);
  const start = (page-1)*state.pageSize;
  return { total, pages, page, items: list.slice(start, start+state.pageSize) };
}

function render(){
  applyFilters();
  const { total, pages, page, items } = paginate(view);
  $('#countTag').textContent = `${total} Einträge`;

  // desktop table
  const tbody = $('#tbody'); tbody.innerHTML = '';
  for(const r of items){
    const pct = plPct(r);
    const amt = plAmt(r);
    const cur = r.currency;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="mono">${esc(r.symbol)}</div>
        <div><span class="muted">${esc(r.name||'—')}</span> <span class="badge ${r.plan==='paid'?'paid':'free'}">${r.plan==='paid'?'Kostenpflichtig':'Kostenlos'}</span></div>
      </td>
      <td>
        <div>${money(r.recPrice, cur)}</div>
        <div class="muted">${esc(r.recDate||'—')} · <span class="pill ${/Kurz/.test(r.horizon)?'short':'long'}">${esc(r.horizon)}</span></div>
      </td>
      <td>
        <div class="mono">${money(r._livePrice||0, cur)}</div>
        <div class="muted">${r._liveTime? new Date(r._liveTime).toLocaleTimeString('de-DE') : ''}</div>
      </td>
      <td>
        <div class="mono ${(pct>=0)?'pl-pos':'pl-neg'}">${money(amt, cur)}</div>
        <div class="muted">${Number.isFinite(pct) ? fmtPct.format(pct) : '—'}</div>
      </td>
      <td>
        <span class="status ${r.status==='sold'?'sold':'open'}">${r.status==='sold'?'Verkauft':'Laufend'}</span>
        ${r.status==='sold'
          ? `<div class="muted">VK: ${money(r.soldPrice||0, cur)} · ${esc(r.soldDate||'—')}</div>`
          : `<div class="muted">Manager bestätigt: ${r.managerConfirmed? '✅ Ja':'— Nein'}</div>`
        }
      </td>
      <td>${esc(r.reason||'—')}</td>
    `;
    tbody.appendChild(tr);
  }

  // mobile cards
  const cards = $('#cards'); cards.innerHTML = '';
  for(const r of items){
    const pct = plPct(r);
    const amt = plAmt(r);
    const cur = r.currency;
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="head">
        <div>
          <div class="mono symbol">${esc(r.symbol)}</div>
          <div class="name">${esc(r.name||'—')}</div>
        </div>
        <div class="badge ${r.plan==='paid'?'paid':'free'}">${r.plan==='paid'?'Kostenpflichtig':'Kostenlos'}</div>
      </div>
      <div class="meta">
        <div class="kv">
          <div class="k">Empfehlung</div>
          <div class="v">${money(r.recPrice, cur)} · ${esc(r.recDate||'—')} <span class="pill ${/Kurz/.test(r.horizon)?'short':'long'}">${esc(r.horizon)}</span></div>
        </div>
        <div class="kv">
          <div class="k">Aktueller Preis</div>
          <div class="v mono small">${money(r._livePrice||0, cur)}</div>
        </div>
        <div class="kv">
          <div class="k">Gewinn/Verlust</div>
          <div class="v mono small ${(pct>=0)?'pl-pos':'pl-neg'}">${money(amt, cur)} · ${Number.isFinite(pct)? fmtPct.format(pct) : '—'}</div>
        </div>
        <div class="kv">
          <div class="k">Status</div>
          <div class="v">
            <span class="status ${r.status==='sold'?'sold':'open'}">${r.status==='sold'?'Verkauft':'Laufend'}</span>
            ${r.status==='sold'
              ? `<div class="muted">VK: ${money(r.soldPrice||0, cur)} · ${esc(r.soldDate||'—')}</div>`
              : `<div class="muted">Manager bestätigt: ${r.managerConfirmed? '✅ Ja':'— Nein'}</div>`
            }
          </div>
        </div>
      </div>
      <div class="reason">${esc(r.reason||'')}</div>
    `;
    cards.appendChild(card);
  }

  // pager
  const pager = $('#pager'); pager.innerHTML = '';
  const addBtn=(txt,p,active=false,disabled=false)=>{
    const b=document.createElement('button'); b.className='page-btn'+(active?' active':''); b.textContent=txt; b.disabled=disabled;
    b.onclick=()=>{ state.page=p; render(); window.scrollTo({top:0,behavior:'smooth'}); };
    pager.appendChild(b);
  };
  addBtn('«',1,false,page===1);
  addBtn('‹',Math.max(1,page-1),false,page===1);
  const pagesToShow = 7;
  const start = Math.max(1, page - Math.floor(pagesToShow/2));
  const end = Math.min(pages, start + pagesToShow - 1);
  for(let p=start; p<=end; p++) addBtn(String(p), p, p===page);
  addBtn('›',Math.min(pages,page+1),false,page===pages);
  addBtn('»',pages,false,page===pages);
}

async function refreshPrices(){
  const source = state.priceSource;
  applyFilters();
  const { items } = paginate(view);
  // fetch only visible
  await Promise.all(items.map(async r=>{
    const px = await fetchLivePrice(r.symbol, source);
    r._livePrice = Number(px)||0;
    r._liveTime = Date.now();
  }));
}

function updateStickyTop(){
  const header = document.querySelector('.topbar');
  if(!header) return;
  const h = header.offsetHeight || 64;
  document.documentElement.style.setProperty('--topbar-h', h + 'px');
  document.documentElement.style.setProperty('--thead-top', (h + 8) + 'px');
}

function bind(){
  $('#q').addEventListener('keydown', e=>{ if(e.key==='Enter'){ state.q = e.target.value; state.page=1; render(); }});
  $('#fStatus').onchange = e=>{ state.status=e.target.value; state.page=1; render(); };
  $('#fHorizon').onchange = e=>{ state.horizon=e.target.value; state.page=1; render(); };
  $('#fPlan').onchange = e=>{ state.plan=e.target.value; state.page=1; render(); };
  $('#sortBy').onchange = e=>{ state.sort=e.target.value; render(); };
  $('#pageSize').onchange = e=>{ state.pageSize=Number(e.target.value); state.page=1; render(); };
  $('#priceSource').onchange = e=>{ state.priceSource=e.target.value; refreshPrices().then(render); };
  $('#btnRefresh').onclick = ()=>{ refreshPrices().then(render); };
  window.addEventListener('resize', updateStickyTop);
  try { new ResizeObserver(updateStickyTop).observe(document.querySelector('.topbar')); } catch(e) {}
  updateStickyTop();
  setInterval(()=>{ refreshPrices().then(render); }, 60000);
}

document.addEventListener('DOMContentLoaded', ()=>{ bind(); load(); });
