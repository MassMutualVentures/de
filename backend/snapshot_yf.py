# backend/snapshot_yf.py
import os, json, time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

REPO_ROOT = os.getcwd()
RECO_PATH  = os.path.join(REPO_ROOT, "investitionsdetails", "data", "recommendations.json")
OUT_PATH   = os.path.join(REPO_ROOT, "investitionsdetails", "data", "prices.json")

def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def ts_ms(dtlike) -> int:
    """pandas/DatetimeIndex → epoch milliseconds"""
    if isinstance(dtlike, pd.Timestamp):
        return int(dtlike.tz_localize(timezone.utc, nonexistent='NaT', ambiguous='NaT').timestamp() * 1000) \
               if dtlike.tzinfo is None else int(dtlike.timestamp() * 1000)
    return int(time.time() * 1000)

def get_last_1m_close(symbol: str):
    """
    优先：1天1分钟线的最后一根收盘价（最接近实时）
    """
    try:
        df = yf.download(symbol, period="1d", interval="1m", progress=False, auto_adjust=False, threads=False)
        if df is not None and not df.empty and "Close" in df:
            s = df["Close"].dropna()
            if not s.empty:
                return float(s.iloc[-1]), ts_ms(s.index[-1])
    except Exception:
        pass
    return None

def get_fast_info(symbol: str):
    """次选：fast_info.last_price（有时能拿到实时或者接近实时）"""
    try:
        t = yf.Ticker(symbol)
        fi = getattr(t, "fast_info", None)
        if fi and fi.get("last_price"):
            return float(fi["last_price"]), int(time.time() * 1000)
    except Exception:
        pass
    return None

def get_last_daily_close(symbol: str):
    """兜底：最近一个日线收盘价"""
    try:
        df = yf.download(symbol, period="5d", interval="1d", progress=False, auto_adjust=False, threads=False)
        if df is not None and not df.empty and "Close" in df:
            s = df["Close"].dropna()
            if not s.empty:
                return float(s.iloc[-1]), ts_ms(s.index[-1])
    except Exception:
        pass
    return None

def get_price(symbol: str):
    """
    获取一个 symbol 的价格：1m 收盘 → fast_info → 日线收盘 → 0
    """
    return (get_last_1m_close(symbol)
            or get_fast_info(symbol)
            or get_last_daily_close(symbol)
            or (0.0, 0))

def main():
    recos = read_json(RECO_PATH)
    symbols = sorted({str(r.get("symbol", "")).upper() for r in recos if r.get("symbol")})
    out = {}

    for sym in symbols:
        price, tms = get_price(sym)
        out[sym] = {"price": round(price, 6), "time": int(tms)}
        print(f"{sym:10s} -> {price} @ {tms}")
        time.sleep(0.2)   # 轻微限速，避免请求太频繁

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"✓ wrote {OUT_PATH}")

if __name__ == "__main__":
    main()
