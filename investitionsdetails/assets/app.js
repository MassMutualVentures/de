// ---- helpers ----
const fmtEUR = new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2});
const fmtUSD = new Intl.NumberFormat('de-DE',{style:'currency',currency:'USD',maximumFractionDigits:2});
const fmtPct = new Intl.NumberFormat('de-DE',{style:'percent',maximumFractionDigits:2});
const $ = (sel,root=document)=>root.querySelector(sel);
const esc = s => (s??'').toString().replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[c]));
const todayStr = ()=> new Date().toISOString().slice(0,10);
function curFor(symbol){ return /\.de$/i.test(symbol||'') ? 'EUR' : 'USD'; }
function money(v, cur){ return (cur==='EUR'? fmtEUR:fmtUSD).format(v||0); }
function getFinnhubKey(){ return (window.FINNHUB_KEY && String(window.FINNHUB_KEY).trim()) || localStorage.getItem('FINNHUB_KEY') || ''; }

// === Robust price fetchers ===

// Yahoo 批量（可选用代理）
async function fetchYahooBatch(symbols, useProxy = false) {
  if (!symbols.length) return {};
  const base = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';
  const url = base + encodeURIComponent(symbols.join(','));
  const finalUrl = useProxy ? 'https://cors.isomorphic-git.org/' + url : url;

  const res = await fetch(finalUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status);
  const data = await res.json();

  const out = {};
  const arr = (data && data.quoteResponse && data.quoteResponse.result) || [];
  for (const q of arr) {
    const sym = (q.symbol || '').toUpperCase();
    const price = Number(q.regularMarketPrice ?? q.bid ?? q.ask ?? 0);
    if (sym && Number.isFinite(price) && price > 0) {
      out[sym] = {
        price,
        currency: q.currency || null,
        time: q.regularMarketTime ? q.regularMarketTime * 1000 : Date.now()
      };
    }
  }
  return out;
}

// Finnhub（逐个请求，当前页一般≤10只，速率OK）
async function fetchFinnhubBatch(symbols){
  const key = getFinnhubKey();
  if(!key) throw new Error('NO_FINNHUB_KEY');
  const out = {};
  await Promise.all(symbols.map(async sym=>{
    try{
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`;
      const res = await fetch(url, {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const j = await res.json();
      const price = Number(j.c || 0);                 // c = current price
      if(Number.isFinite(price) && price > 0){
        out[sym.toUpperCase()] = { price, currency:null, time:(j.t? j.t*1000 : Date.now()) }; // t = unix time
      }
    }catch(e){}
  }));
  return out;
}

// Stooq CSV 兜底（逐个取，稳定但慢）
async function fetchStooqBatch(symbols) {
  const out = {};
  for (const s of symbols) {
    const u = `https://stooq.com/q/l/?s=${s.toLowerCase()}&f=sd2t2ohlcv&h&e=csv`;
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) continue;
      const txt = (await r.text()).trim().split('\n');
      if (txt.length >= 2) {
        const cols = txt[1].split(',');
        const close = Number(cols[6] || '0'); // Close 列
        if (Number.isFinite(close) && close > 0) {
          out[s.toUpperCase()] = { price: close, currency: null, time: Date.now() };
        }
      }
    } catch {}
  }
  return out;
}

// 读取 GitHub Actions 生成的快照
async function fetchSnapshotMap(){
  try{
    const url = new URL('./data/prices.json?v='+Date.now(), location.href).href;
    const res = await fetch(url,{cache:'no-store'});
    if(!res.ok) return {};
    return await res.json();
  }catch{ return {}; }
}

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

// ---- state ----
let raw=[], view=[];
let state = { q:'', plan:'all', status:'all', horizon:'all', sort:'updatedAt_desc', page:1, pageSize:10, priceSource:'yahoo' };

function normalize(r){
  return {
    id: r.id, symbol: r.symbol||'', name: r.name||'',
    wkn: (r.wkn || '').toString().trim(),
    recPrice: Number(r.recPrice||0),
    recDate: r.recDate || todayStr(),
    horizon: r.horizon || 'Kurzfristig',
    reason: r.reason || '',
    status: (r.status==='sold'?'sold':'open'),
    managerConfirmed: !!r.managerConfirmed,
    soldPrice: (r.soldPrice!=null? Number(r.soldPrice):undefined),
    soldDate: r.soldDate,
    currency: r.currency || curFor(r.symbol),
    plan: (r.plan==='paid'?'paid':'free'),
    createdAt: r.createdAt||Date.now(),
    updatedAt: r.updatedAt||Date.now(),
    _livePrice: 0, _liveTime: 0,
  };
}

function dataUrl(){ return new URL('./data/recommendations.json?v='+Date.now(), location.href).href; }

async function load(){
  let list=[];
  try { const res = await fetch(dataUrl()); if(res.ok) list = await res.json(); } catch(e){}
  if(!Array.isArray(list) || list.length===0){
    try { list = JSON.parse(document.getElementById('SAMPLE').textContent||'[]'); } catch(e){ list=[]; }
  }
  raw = list.map(normalize);
  await refreshPrices();
  render();
}

function applyFilters(){
  let arr = raw.slice();
  const q = state.q.trim().toLowerCase();
  if(q) arr = arr.filter(r=>{
    const s=(r.symbol||'').toLowerCase();
    const n=(r.name||'').toLowerCase();
    const rs=(r.reason||'').toLowerCase();
    const w=(r.wkn||'').toLowerCase();
    return s.includes(q) || n.includes(q) || rs.includes(q) || w.includes(q);
  });
  if(state.plan!=='all') arr = arr.filter(r=> r.plan===state.plan);
  if(state.status!=='all') arr = arr.filter(r=> r.status===state.status);
  if(state.horizon!=='all') arr = arr.filter(r=> r.horizon===state.horizon);
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
  document.getElementById('countTag').textContent = `${total} Einträge`;

  // desktop table
  const tbody = document.getElementById('tbody'); tbody.innerHTML='';
  for(const r of items){
    const pct = plPct(r), amt = plAmt(r), cur = r.currency;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="mono">${esc(r.symbol)}</div>
        <div class="muted">WKN: <span class="mono">${esc(r.wkn||'—')}</span></div>
        <div><span class="muted">${esc(r.name||'—')}</span><span class="badge ${r.plan==='paid'?'paid':'free'}">${r.plan==='paid'?'Kostenpflichtig':'Kostenlos'}</span></div>
      </td>
      <td>
        <div>${money(r.recPrice, cur)}</div>
        <div class="muted">${esc(r.recDate)} · <span class="pill ${/Kurz/.test(r.horizon)?'short':'long'}">${esc(r.horizon)}</span></div>
      </td>
      <td>
        <div class="mono">${money(r._livePrice||0, cur)}</div>
        <div class="muted">${r._liveTime? new Date(r._liveTime).toLocaleTimeString('de-DE') : ''}</div>
      </td>
      <td>
        <div class="mono ${(pct>=0)?'pl-pos':'pl-neg'}">${money(amt, cur)}</div>
        <div class="muted">${Number.isFinite(pct)? fmtPct.format(pct) : '—'}</div>
      </td>
      <td>
        <span class="status ${r.status==='sold'?'sold':'open'}">${r.status==='sold'?'Verkauft':'Laufend'}</span>
        ${r.status==='sold'
          ? `<div class="muted">VK: ${money(r.soldPrice||0, cur)} · ${esc(r.soldDate||'—')}</div>`
          : `<div class="muted">Manager bestätigt: ${r.managerConfirmed? '✅ Ja':'— Nein'}</div>`
        }
      </td>
      <td class="reason-cell">
        <span class="reason-text">${esc(r.reason||'—')}</span>
        ${ (r.reason||'').length>200 ? '<span class="more">Mehr</span>' : ''}
      </td>`;
    tbody.appendChild(tr);
    const more = tr.querySelector('.reason-cell .more');
    if(more){
      more.addEventListener('click', ()=>{
        const span = tr.querySelector('.reason-cell .reason-text');
        span.style.display = 'inline'; span.style.webkitLineClamp = 'unset'; span.style.webkitBoxOrient = 'unset'; span.style.overflow = 'visible';
        more.remove();
      });
    }
  }

  // mobile cards
  const cards = document.getElementById('cards'); cards.innerHTML='';
  for(const r of items){
    const pct = plPct(r), amt = plAmt(r), cur = r.currency;
    const card = document.createElement('article');
    card.className = 'card';
    const shortReason = (r.reason||'').length>120 ? `${esc(r.reason.slice(0,120))}…` : esc(r.reason||'');
    const showMore = (r.reason||'').length>120;
    card.innerHTML = `
      <div class="head">
        <div>
          <div class="mono symbol">${esc(r.symbol)}</div>
          <div class="name">${esc(r.name||'—')}</div>
          <div class="wkn muted">WKN: <span class="mono">${esc(r.wkn||'—')}</span></div>
        </div>
        <div class="badge ${r.plan==='paid'?'paid':'free'}">${r.plan==='paid'?'Kostenpflichtig':'Kostenlos'}</div>
      </div>
      <div class="meta">
        <div class="kv"><div class="k">Empfehlung</div><div class="v">${money(r.recPrice, cur)} · ${esc(r.recDate)} <span class="pill ${/Kurz/.test(r.horizon)?'short':'long'}">${esc(r.horizon)}</span></div></div>
        <div class="kv"><div class="k">Aktuell</div><div class="v mono">${money(r._livePrice||0, cur)}</div></div>
        <div class="kv"><div class="k">Gewinn/Verlust</div><div class="v mono ${(pct>=0)?'pl-pos':'pl-neg'}">${money(amt, cur)} · ${Number.isFinite(pct)? fmtPct.format(pct) : '—'}</div></div>
        <div class="kv"><div class="k">Status</div><div class="v">
          <span class="status ${r.status==='sold'?'sold':'open'}">${r.status==='sold'?'Verkauft':'Laufend'}</span>
          ${r.status==='sold'
            ? `<div class="muted">VK: ${money(r.soldPrice||0, cur)} · ${esc(r.soldDate||'—')}</div>`
            : `<div class="muted">Manager bestätigt: ${r.managerConfirmed? '✅ Ja':'— Nein'}</div>`
          }
        </div></div>
      </div>
      <div class="reason">${shortReason}${showMore?'<span class="more" role="button" tabindex="0">Mehr</span>':''}</div>`;
    cards.appendChild(card);
    if(showMore){
      const btn = card.querySelector('.more');
      btn.addEventListener('click', ()=>{ btn.previousSibling.textContent = r.reason; btn.remove(); });
      btn.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); btn.click(); } });
    }
  }

  // pager
  const pager = document.getElementById('pager'); pager.innerHTML='';
  const addBtn=(txt,p,active=false,disabled=false)=>{
    const b=document.createElement('button'); b.className='page-btn'+(active?' active':''); b.textContent=txt; b.disabled=disabled;
    b.onclick=()=>{ state.page=p; render(); window.scrollTo({top:0,behavior:'smooth'}); };
    pager.appendChild(b);
  };
  const pagesToShow=7;
  addBtn('«',1,false,page===1);
  addBtn('‹',Math.max(1,page-1),false,page===1);
  const start=Math.max(1, page-Math.floor(pagesToShow/2)); const end=Math.min(pages, start+pagesToShow-1);
  for(let p=start;p<=end;p++) addBtn(String(p),p,p===page);
  addBtn('›',Math.min(pages,page+1),false,page===pages);
  addBtn('»',pages,false,page===pages);
}

// 批量抓价：支持 Yahoo / Finnhub / Stooq / Snapshot
// 只有拿到有效价格才写 _liveTime；失败则保持 0 且不显示时间
async function refreshPrices(){
  applyFilters();
  const { items } = paginate(view);
  const syms = Array.from(new Set(items.map(r => (r.symbol||'').toUpperCase()).filter(Boolean)));
  if (!syms.length) return;

  let map = {}, used = 'none';

  if (state.priceSource === 'snapshot') {
    map = await fetchSnapshotMap(); used = Object.keys(map).length ? 'snapshot':'none';
  } else if (state.priceSource === 'finnhub') {
    try { map = await fetchFinnhubBatch(syms); if(Object.keys(map).length) used='finnhub'; } catch(e){ used='none'; }
    if (used==='none') { try { map = await fetchYahooBatch(syms,false); if(Object.keys(map).length) used='yahoo'; } catch{} }
    if (used==='none') { try { map = await fetchYahooBatch(syms,true ); if(Object.keys(map).length) used='yahoo-proxy'; } catch{} }
    if (used==='none') { try { map = await fetchStooqBatch(syms);      if(Object.keys(map).length) used='stooq'; } catch{} }
  } else if (state.priceSource === 'stooq') {
    try { map = await fetchStooqBatch(syms);      if(Object.keys(map).length) used='stooq'; } catch{}
    if (used==='none') { try { map = await fetchYahooBatch(syms,false); if(Object.keys(map).length) used='yahoo'; } catch{} }
    if (used==='none') { try { map = await fetchYahooBatch(syms,true ); if(Object.keys(map).length) used='yahoo-proxy'; } catch{} }
  } else { // 默认 Yahoo
    try { map = await fetchYahooBatch(syms,false); if(Object.keys(map).length) used='yahoo'; } catch{}
    if (used==='none') { try { map = await fetchYahooBatch(syms,true ); if(Object.keys(map).length) used='yahoo-proxy'; } catch{} }
    if (used==='none') { try { map = await fetchFinnhubBatch(syms);     if(Object.keys(map).length) used='finnhub'; } catch{} }
    if (used==='none') { try { map = await fetchStooqBatch(syms);       if(Object.keys(map).length) used='stooq'; } catch{} }
  }

  for (const r of items){
    const q = map[(r.symbol||'').toUpperCase()];
    if (q && Number.isFinite(q.price) && q.price > 0) {
      r._livePrice = q.price;
      r._liveTime  = q.time || Date.now();
    } else {
      r._livePrice = 0;
      r._liveTime  = 0; // 没拿到价就不显示时间
    }
  }
  render();
}

function bind(){
  document.getElementById('q').addEventListener('keydown', e=>{ if(e.key==='Enter'){ state.q=e.target.value; state.page=1; render(); }});
  document.getElementById('fPlan').onchange = e=>{ state.plan=e.target.value; state.page=1; render(); };
  document.getElementById('fStatus').onchange = e=>{ state.status=e.target.value; state.page=1; render(); };
  document.getElementById('fHorizon').onchange = e=>{ state.horizon=e.target.value; state.page=1; render(); };
  document.getElementById('sortBy').onchange = e=>{ state.sort=e.target.value; render(); };
  document.getElementById('pageSize').onchange = e=>{ state.pageSize=Number(e.target.value); state.page=1; render(); };
  document.getElementById('priceSource').onchange = e=>{ state.priceSource=e.target.value; refreshPrices().then(render); };
  document.getElementById('btnRefresh').onclick = ()=>{ refreshPrices().then(render); };
  setInterval(()=>{ refreshPrices().then(render); }, 60000);
}
document.addEventListener('DOMContentLoaded', ()=>{ bind(); load(); });
