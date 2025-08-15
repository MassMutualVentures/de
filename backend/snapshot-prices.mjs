// backend/snapshot-prices.mjs
import fs from "fs";
import path from "path";

const repoRoot = process.cwd();
const recoFile = path.join(repoRoot, "investitionsdetails", "data", "recommendations.json");
const outFile  = path.join(repoRoot, "investitionsdetails", "data", "prices.json");

const KEY = process.env.FINNHUB_KEY;
if (!KEY) {
  console.error("❌ FINNHUB_KEY missing (GitHub → Settings → Secrets → Actions).");
  process.exit(1);
}

function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; } }

// --- Finnhub helpers ---
async function fhQuote(sym){
  const u = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`;
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  const px = Number(j.c || 0);
  const t  = j.t ? j.t * 1000 : Date.now();
  return (Number.isFinite(px) && px > 0) ? { price: px, time: t, _src: "quote" } : null;
}
async function fhSearch(q){
  const u = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${KEY}`;
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  const arr = Array.isArray(j.result) ? j.result : [];
  // 优先 .DE / XETRA / FRA，其次第一个
  return arr.find(x => /(\.DE|XETRA|FRA)/i.test((x.displaySymbol||"") + " " + (x.symbol||"")))?.symbol
      || arr[0]?.symbol || null;
}
async function fhLastClose(sym){
  const now = Math.floor(Date.now()/1000);
  const from = now - 14*24*3600;
  const u = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}&resolution=D&from=${from}&to=${now}&token=${KEY}`;
  const r = await fetch(u, { cache:"no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  if (j && j.s === "ok" && Array.isArray(j.c) && j.c.length){
    const px = Number(j.c.at(-1));
    return (Number.isFinite(px) && px > 0) ? { price: px, time: Date.now(), _src: "candle" } : null;
  }
  return null;
}

async function getOnePrice(sym){
  // 1) 直接 quote
  let q = await fhQuote(sym);
  if (q) return q;
  // 2) search → 标准符号 → 再 quote
  const mapped = await fhSearch(sym);
  if (mapped) {
    q = await fhQuote(mapped);
    if (q) return q;
    // 3) 兜底：日线收盘
    const c = await fhLastClose(mapped);
    if (c) return c;
  }
  return { price: 0, time: 0, _src: "none" };
}

// --- main ---
const recos = readJsonSafe(recoFile);
const symbols = [...new Set(recos.map(r => String(r.symbol||"").toUpperCase()).filter(Boolean))];

const out = {};
for (const s of symbols){
  try {
    const q = await getOnePrice(s);
    out[s] = { price: q.price, time: q.time };
    console.log(`${s} -> ${q.price} (${q._src})`);
    // 为了更稳，顺序请求，避免免费层限流；若想提速可用并发 Promise.all
    await new Promise(res => setTimeout(res, 150)); // 小憩 150ms
  } catch (e) {
    out[s] = { price: 0, time: 0 };
    console.warn(`${s} -> 0 (error)`);
  }
}

// 写文件
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`✓ Wrote ${outFile}`);
