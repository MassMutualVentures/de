// backend/handle-issue.mjs  —— FIX: snapshot() 去除 history，避免循环引用；兼容 "WKN (optional)"
import fs from 'fs';
import path from 'path';

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) { console.error('GITHUB_EVENT_PATH fehlt'); process.exit(1); }
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const issue = event.issue;
if (!issue) { console.error('Issue fehlt'); process.exit(1); }

const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));
const body = issue.body || '';
const repoRoot = process.cwd();
const dataFile = path.join(repoRoot, 'investitionsdetails', 'data', 'recommendations.json');

// ---------- utils ----------
function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; } }
function writeJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function uid(){ return 'id_' + Math.random().toString(36).slice(2, 10); }
function detectCurrency(symbol){ return /\.[dD][eE]$/.test(symbol || '') ? 'EUR' : 'USD'; }
function toNum(v){ if (v==null || v==='') return undefined; const n=Number((v||'').toString().replace(',','.')); return isNaN(n) ? undefined : n; }
function planFrom(v){ return /kostenpflichtig|paid/i.test(v||'') ? 'paid' : 'free'; }
function pick(obj, keys){ const r={}; for (const k of keys){ if (obj[k] !== undefined && obj[k] !== '') r[k]=obj[k]; } return r; }
function parseIssueFormMarkdown(md){
  const re = /###\s+([^\n]+)\n([\s\S]*?)(?=\n###\s+|$)/g;
  const map = {}; let m;
  while ((m = re.exec(md))) map[m[1].trim()] = (m[2]||'').trim();
  return map;
}
// 关键：拍快照时**去掉 history**，并做一次 JSON 深拷贝，杜绝循环
function snapshot(obj){
  if (!obj) return null;
  const { history, ...rest } = obj;
  return JSON.parse(JSON.stringify(rest));
}
// 兼容 "WKN" 与 "WKN (optional)" 两种标题
function getWKN(form){ return (form['WKN'] || form['WKN (optional)'] || '').replace(/\s/g,''); }

function diff(before, after){
  const keys = new Set([...(before?Object.keys(before):[]), ...(after?Object.keys(after):[])]);
  const d=[]; for (const k of keys){ const b=before?.[k]; const a=after?.[k]; if (JSON.stringify(b)!==JSON.stringify(a)) d.push({field:k,from:b,to:a}); }
  return d;
}

const db = readJsonSafe(dataFile);
const form = parseIssueFormMarkdown(body);

function save(newDb, msg){
  newDb.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  writeJson(dataFile, newDb);
  fs.writeFileSync(path.join(repoRoot,'backend','.result.md'), msg, 'utf8');
}

// ---------- handlers ----------
if (labels.includes('reco-new')) {
  const rec = {
    id: uid(),
    symbol: form['Symbol'] || '',
    name: form['Name'] || '',
    wkn: getWKN(form) || '',
    recPrice: toNum(form['Empfehlungspreis']) ?? 0,
    recDate: form['Empfehlungsdatum'] || new Date().toISOString().slice(0,10),
    horizon: form['Zielhorizont'] || 'Kurzfristig',
    reason: form['Begründung (kundenseitig sichtbar)'] || form['Begründung'] || '',
    status: (form['Status']||'open').toLowerCase()==='sold' ? 'sold' : 'open',
    managerConfirmed: /^(true|ja|yes)$/i.test(form['Manager bestätigt Verkauf']||''),
    soldPrice: toNum(form['Verkaufspreis (optional)']),
    soldDate: form['Verkaufsdatum (optional)'] || undefined,
    plan: planFrom(form['Typ']||''),
    currency: detectCurrency(form['Symbol']||''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  const afterSnap = snapshot(rec);
  rec.history.push({ t: Date.now(), type:'create', before:null, after: afterSnap });
  db.push(rec);
  save(db, `✅ Neu: **${rec.symbol}** (ID ${rec.id}, ${rec.plan==='paid'?'Kostenpflichtig':'Kostenlos'})`);
}
else if (labels.includes('reco-edit')) {
  const id = form['Datensatz-ID'] || form['ID'] || '';
  const r = db.find(x=>x.id===id);
  if(!r){ save(db, `❌ Nicht gefunden: ID ${id}`); process.exit(0); }

  const before = snapshot(r);
  const patch = {
    symbol: form['Symbol'] || undefined,
    name: form['Name'] || undefined,
    wkn: (form['WKN']!==undefined || form['WKN (optional)']!==undefined) ? getWKN(form) : undefined,
    recPrice: toNum(form['Empfehlungspreis']),
    recDate: form['Empfehlungsdatum'] || undefined,
    horizon: form['Zielhorizont'] || undefined,
    reason: (form['Begründung (optional)'] ?? form['Begründung']) || undefined,
    status: (form['Status'] ? ((form['Status'].toLowerCase()==='sold')?'sold':'open') : undefined),
    managerConfirmed: (form['Manager bestätigt Verkauf'] ? /^(true|ja|yes)$/i.test(form['Manager bestätigt Verkauf']) : undefined),
    soldPrice: toNum(form['Verkaufspreis']),
    soldDate: form['Verkaufsdatum'] || undefined,
    plan: (form['Typ'] ? planFrom(form['Typ']) : undefined)
  };
  Object.assign(r, pick(patch, Object.keys(patch)));
  if(!r.currency) r.currency = detectCurrency(r.symbol);
  r.updatedAt = Date.now();
  r.history = r.history || [];
  const after = snapshot(r);
  r.history.push({ t: Date.now(), type:'update', before, after });
  save(db, `📝 Geändert: **${r.symbol}** (ID ${r.id})\n\nÄnderungen:\n${diff(before,r).map(d=>`- ${d.field}: ${d.from} → ${d.to}`).join('\n')}`);
}
else if (labels.includes('reco-import')) {
  let arr = []; try { arr = JSON.parse(form['JSON-Array'] || form['payload'] || '[]'); } catch { arr=[]; }
  const mode = (form['Modus'] || form['mode'] || 'merge').toLowerCase();
  const normalized = arr.map(x => ({
    id: x.id || uid(),
    symbol: x.symbol || '',
    name: x.name || '',
    wkn: (x.wkn || '').toString(),
    recPrice: Number(x.recPrice || 0),
    recDate: x.recDate || new Date().toISOString().slice(0,10),
    horizon: x.horizon || 'Kurzfristig',
    reason: x.reason || '',
    status: (x.status === 'sold' ? 'sold' : 'open'),
    managerConfirmed: !!x.managerConfirmed,
    soldPrice: (x.soldPrice != null ? Number(x.soldPrice) : undefined),
    soldDate: x.soldDate,
    plan: (x.plan === 'paid' ? 'paid' : 'free'),
    currency: x.currency || detectCurrency(x.symbol),
    createdAt: x.createdAt || Date.now(),
    updatedAt: Date.now(),
    history: [] // 导入时不保留 history，避免循环
  }));

  if (mode === 'replace') {
    save(normalized, `♻️ Ersetzt: ${normalized.length} Einträge`);
  } else {
    const map = new Map(db.map(x=>[x.id,x]));
    for (const n of normalized) {
      if (map.has(n.id)) map.set(n.id, { ...map.get(n.id), ...n, updatedAt: Date.now() });
      else map.set(n.id, n);
    }
    const merged = Array.from(map.values());
    save(merged, `➕ Importiert/zusammengeführt: ${normalized.length} Einträge, Gesamt ${merged.length}`);
  }
}
else {
  fs.writeFileSync(path.join(repoRoot,'backend','.result.md'), 'ℹ️ Kein reco-* Label, ignoriert.', 'utf8');
}
