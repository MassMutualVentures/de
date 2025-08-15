// backend/handle-issue.mjs
// - 清洗 Issue Forms 文本：去除 ```text ... ``` 代码围栏、去掉 "No response"
// - snapshot() 去掉 history，避免循环引用
// - 兼容 "WKN (optional)" 字段
// - 防重复：同一个 Issue（issue.number）多次触发时只更新，不新增

import fs from 'fs';
import path from 'path';

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) { console.error('GITHUB_EVENT_PATH fehlt'); process.exit(1); }
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const issue = event.issue;
if (!issue) { console.error('Issue fehlt'); process.exit(1); }

const issueNo = issue.number;
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

// 去掉 ```text / ``` 围栏 & 清除 "No response"
function stripCodeFences(val){
  if (!val) return '';
  const trimmed = String(val).trim();
  if (/^no response$/i.test(trimmed)) return '';
  // 完整围栏 ```lang ... ```
  const m = trimmed.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  if (m) return m[1].trim();
  // 宽松：去掉起始 ```lang 与末尾 ```
  return trimmed.replace(/^```[a-z]*\s*/i,'').replace(/```$/,'').trim();
}
function parseIssueFormMarkdown(md){
  const re = /###\s+([^\n]+)\n([\s\S]*?)(?=\n###\s+|$)/g;
  const map = {}; let m;
  while ((m = re.exec(md))) {
    const key = m[1].trim();
    const raw = (m[2] || '').trim();
    map[key] = stripCodeFences(raw);
  }
  return map;
}

// 拍快照时去掉 history，避免循环引用
function snapshot(obj){
  if (!obj) return null;
  const { history, ...rest } = obj;
  return JSON.parse(JSON.stringify(rest));
}

// 兼容 "WKN" 与 "WKN (optional)"
function getWKN(form){ return (form['WKN'] || form['WKN (optional)'] || '').replace(/\s/g,''); }

// 统一拿“推荐理由”
function getReason(form){
  return (
    form['Begründung (kundenseitig sichtbar)'] ??
    form['Begründung'] ??
    form['reason'] ??
    ''
  );
}

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
  // 防重复：同一个 Issue 再次触发则更新同一条
  let r = db.find(x => x._sourceIssue === issueNo);
  if (!r) {
    r = {
      id: uid(),
      _sourceIssue: issueNo, // 记住来源 Issue
      symbol: '',
      name: '',
      wkn: '',
      recPrice: 0,
      recDate: new Date().toISOString().slice(0,10),
      horizon: 'Kurzfristig',
      reason: '',
      status: 'open',
      managerConfirmed: false,
      soldPrice: undefined,
      soldDate: undefined,
      plan: 'free',
      currency: 'EUR',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: []
    };
    db.push(r);
  }

  const before = snapshot(r);

  // 用表单值覆盖
  r.symbol = form['Symbol'] || r.symbol || '';
  r.name = form['Name'] || r.name || '';
  r.wkn = getWKN(form) || r.wkn || '';
  r.recPrice = toNum(form['Empfehlungspreis']) ?? r.recPrice ?? 0;
  r.recDate = form['Empfehlungsdatum'] || r.recDate || new Date().toISOString().slice(0,10);
  r.horizon = form['Zielhorizont'] || r.horizon || 'Kurzfristig';
  r.reason = getReason(form) || r.reason || '';
  r.status = (form['Status']||r.status||'open').toLowerCase()==='sold' ? 'sold' : 'open';
  r.managerConfirmed = (form['Manager bestätigt Verkauf'] ? /^(true|ja|yes)$/i.test(form['Manager bestätigt Verkauf']) : r.managerConfirmed);
  r.soldPrice = toNum(form['Verkaufspreis (optional)']) ?? r.soldPrice;
  r.soldDate  = (form['Verkaufsdatum (optional)'] || r.soldDate);
  r.plan = planFrom(form['Typ']||r.plan);
  r.currency = r.currency || detectCurrency(r.symbol);
  r.updatedAt = Date.now();

  const after = snapshot(r);
  r.history.push({ t: Date.now(), type: before?.id ? 'update' : 'create', before, after });

  const isCreate = !before?.id;
  save(db, (isCreate
    ? `✅ Neu: **${r.symbol}** (ID ${r.id}, ${r.plan==='paid'?'Kostenpflichtig':'Kostenlos'})`
    : `♻️ Aktualisiert (Duplikat verhindert): **${r.symbol}** (ID ${r.id})`));
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
    recPrice: t
