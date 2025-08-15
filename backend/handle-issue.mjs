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
  fs.writeFile
