// investitionsdetails/assets/app.js
// Snapshot-only 版：只从 data/prices.json 读取价格快照
// 兼容你已删除“价格源”下拉的页面结构；所有 DOM 访问都有空值保护

// ---- helpers ----
const fmtEUR = new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2});
const fmtUSD = new Intl.NumberFormat('de-DE',{style:'currency',currency:'USD',maximumFractionDigits:2});
const fmtPct = new Intl.NumberFormat('de-DE',{style:'percent',maximumFractionDigits:2});
const $ = (sel,root=document)=>root.querySelector(sel);

// 修正了原先对引号的转义键（原来把 \" 当成键）；现在对 " 进行转义即可
const esc = s => (s??'').toString().replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const todayStr = ()=> new Date().toISOString().slice(0,10);
function curFor(symbol){ return /\.de$/i.test(symbol||'') ? 'EUR' : 'USD'; }
function money(v, cur){ return (cur==='EUR'? fmtEUR:fmtUSD).format(v||0); }

// ---- P/L helpers ----
function plPct(rec){
  const base = rec.recPrice;
  if(rec.status==='sold'){
    if(rec.soldPrice && base) return (rec.soldPrice-base)/base;
    return NaN;
  }
  const px = rec._livePrice ?? 0;
  if(!px || !base) return NaN;
  return (px-base)/base;
}
function plAmt(rec){
  if(rec.status==='sold'){
    if(rec.soldPrice!=null && rec.recPrice!=null) return rec.soldPrice - rec.recPrice;
    return 0;
  }
  const px = rec._livePrice ?? 0;
  if(!px || rec.recPrice==null) return 0;
  return px - rec.recPrice;
}

// ---- state ----
let raw=[], view=[];
let state = {
  q:'', plan:'all', status:'all', horizon:'all',
  sort:'recDate_desc', page:1, pageSize:10,
  priceSource:'snapshot' // 固定为 snapshot
};

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

// ---- load & filter ----
async function load(){
  let list=[];
  try {
    const res = await fetch(dataUrl(), {cache:'no-store'});
    if(res.ok) list = await res.json();
  } catch(e){}
  if(!Array.isArray(list) || list.length===0){
    try { list = JSON.parse(document.getElementById('SAMPLE')?.textContent||'[]'); } catch(e){ list=[]; }
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
  if(state.plan!=='all')    arr = arr.filter(r=> r.plan===state.plan);
  if(state.status!=='all')  arr = arr.filter(r=> r.status===state.status);
  if(state.horizon!=='all') arr = arr.filter(r=> r.horizon===state.horizon);

  arr.sort((a,b)=>{
    const dnum = d => d ? Number(String(d).replaceAll('-','')) : 0; // 2025-08-15 → 20250815
    if(state.sort==='recDate_desc')   return dnum(b.recDate) - dnum(a.recDate);
    if(state.sort==='updatedAt_desc') return (b.updatedAt||0)-(a.updatedAt||0);
    if(state.sort==='pl_desc')        return ((plPct(b)||-Infinity) - (plPct(a)||-Infinity));
    if(state.sort==='symbol_asc')     return (a.symbol||'').localeCompare(b.symbol||'');
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

// ---- render ----
function render(){
  applyFilters();
  const { total, pages, page, items } = paginate(view);

  const countTag = document.getElementById('countTag');
  if (countTag) countTag.textContent = `${total} Einträge`;

  // desktop table
  const tbody = document.getElementById('tbody');
  if (tbody){
    tbody.innerHTML='';
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
          <div class="muted">${r._liveTime? new Date(r._liveTime).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}) : ''}</div>
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
          <span class="reason-text">${esc(r.reason || '—')}</span>
          ${(r.reason||'').length>200 ? '<button class="reason-toggle" type="button">Mehr</button>' : ''}
        </td>`;
      tbody.appendChild(tr);

      // 展开/收起（桌面）
      const cell = tr.querySelector('.reason-cell');
      const btn  = cell?.querySelector('.reason-toggle');
      if (btn) {
        btn.addEventListener('click', ()=>{
          const expanded = cell.classList.toggle('expanded');
          btn.textContent = expanded ? 'Weniger' : 'Mehr';
        });
      }
    }
  }

  // mobile cards
  const cards = document.getElementById('cards');
  if (cards){
    cards.innerHTML='';
    for(const r of items){
      const pct = plPct(r), amt = plAmt(r), cur = r.currency;
      const card = document.createElement('article');
      card.className = 'card';

      const shortReason = (r.reason||'').length>120 ? `${esc(r.reason.slice(0,120))}…` : esc(r.reason||'');
      const showMore    = (r.reason||'').length>120;

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
        <div class="reason ${showMore?'':''}">
          <span class="reason-text">${shortReason}</span>
          ${ showMore ? '<button class="reason-toggle" type="button">Mehr</button>' : '' }
        </div>`;
      cards.appendChild(card);

      // 展开/收起（移动）
      const rbox = card.querySelector('.reason');
      const rbtn = rbox?.querySelector('.reason-toggle');
      if (rbtn){
        rbtn.addEventListener('click', ()=>{
          const expanded = rbox.classList.toggle('expanded');
          const span = rbox.querySelector('.reason-text');
          if (expanded) { span.textContent = r.reason || '—'; rbtn.textContent = 'Weniger'; }
          else { span.textContent = (r.reason||'').length>120 ? r.reason.slice(0,120)+'…' : (r.reason||'—'); rbtn.textContent = 'Mehr'; }
        });
      }
    }
  }

  // pager
  const pager = document.getElementById('pager');
  if (pager){
    pager.innerHTML='';
    const addBtn=(txt,p,active=false,disabled=false)=>{
      const b=document.createElement('button');
      b.className='page-btn'+(active?' active':'');
      b.textContent=txt; b.disabled=disabled;
      b.onclick=()=>{ state.page=p; render(); window.scrollTo({top:0,behavior:'smooth'}); };
      pager.appendChild(b);
    };
    const pagesToShow=7;
    addBtn('«',1,false,page===1);
    addBtn('‹',Math.max(1,page-1),false,page===1);
    const start=Math.max(1, page-Math.floor(pagesToShow/2));
    const end=Math.min(pages, start+pagesToShow-1);
    for(let p=start;p<=end;p++) addBtn(String(p),p,p===page);
    addBtn('›',Math.min(pages,page+1),false,page===pages);
    addBtn('»',pages,false,page===pages);
  }
}

// ---- prices: Snapshot only ----
async function refreshPrices(){
  applyFilters();
  const { items } = paginate(view);

  // 只读快照
  let map = {};
  try{
    const url = new URL('./data/prices.json?v='+Date.now(), location.href).href;
    const res = await fetch(url, { cache:'no-store' });
    if (res.ok) map = await res.json();
  }catch{}

  for (const r of items){
    const q = map[(r.symbol||'').toUpperCase()];
    if (q && Number.isFinite(q.price) && q.price > 0){
      r._livePrice = q.price;
      r._liveTime  = q.time || Date.now();
    }else{
      r._livePrice = 0;
      r._liveTime  = 0; // 没拿到价就不显示时间
    }
  }
  render();
}

// ---- UI binding ----
function bind(){
  const q = document.getElementById('q');
  if (q) q.addEventListener('keydown', e=>{ if(e.key==='Enter'){ state.q=e.target.value; state.page=1; render(); }});

  const fPlan = document.getElementById('fPlan');
  if (fPlan) fPlan.onchange = e=>{ state.plan=e.target.value; state.page=1; render(); };

  const fStatus = document.getElementById('fStatus');
  if (fStatus) fStatus.onchange = e=>{ state.status=e.target.value; state.page=1; render(); };

  const fHorizon = document.getElementById('fHorizon');
  if (fHorizon) fHorizon.onchange = e=>{ state.horizon=e.target.value; state.page=1; render(); };

  const sortBy = document.getElementById('sortBy');
  if (sortBy){ sortBy.onchange = e=>{ state.sort=e.target.value; render(); }; sortBy.value = state.sort; }

  const pageSize = document.getElementById('pageSize');
  if (pageSize) pageSize.onchange = e=>{ state.pageSize=Number(e.target.value)||10; state.page=1; render(); };

  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) btnRefresh.onclick = ()=>{ refreshPrices().then(render); };

  // 每 60 秒读取一次快照
  setInterval(()=>{ refreshPrices().then(render); }, 60000);
}

document.addEventListener('DOMContentLoaded', ()=>{ bind(); load(); });
