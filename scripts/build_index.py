#!/usr/bin/env python3
"""Create a synthetic equal-weight BIST 100 OHLC index from adjusted CSV data."""
from pathlib import Path
import json
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data" / "index.json"
BASE = 1000.0

def main():
    members = pd.read_csv(DATA / "constituents.csv")
    if "ticker" not in members:
        raise ValueError("constituents.csv must contain a 'ticker' column")
    tickers = members["ticker"].dropna().astype(str).str.strip().str.upper().tolist()
    if len(tickers) != 100 or len(set(tickers)) != 100:
        raise ValueError(f"Expected exactly 100 unique BIST 100 tickers; found {len(set(tickers))}")
    p = pd.read_csv(DATA / "prices.csv")
    required = {"date", "ticker", "open", "high", "low", "close"}
    if not required.issubset(p.columns):
        raise ValueError(f"prices.csv missing columns: {sorted(required-set(p.columns))}")
    p["date"] = pd.to_datetime(p["date"]).dt.strftime("%Y-%m-%d")
    p["ticker"] = p["ticker"].astype(str).str.strip().str.upper()
    for c in ["open","high","low","close"]:
        p[c] = pd.to_numeric(p[c], errors="coerce")
    p = p[p.ticker.isin(tickers)]
    if p.duplicated(["date","ticker"]).any():
        raise ValueError("Duplicate date/ticker rows found")
    if p[list(["open","high","low","close"])].isna().any().any():
        raise ValueError("Missing or invalid OHLC values found")
    dates = sorted(p.date.unique())
    if len(dates) < 2:
        raise ValueError("At least two trading dates are required")
    wide = {c:p.pivot(index="date",columns="ticker",values=c).reindex(index=dates,columns=tickers)
            for c in ["open","high","low","close"]}
    for d in dates:
        missing = [t for t in tickers if pd.isna(wide["close"].loc[d,t])]
        if missing:
            raise ValueError(f"{d}: {len(missing)} constituents missing, e.g. {missing[:10]}")
    out=[{"time":dates[0],"open":BASE,"high":BASE,"low":BASE,"close":BASE}]
    prev_idx=BASE
    for i in range(1,len(dates)):
        d, pdte=dates[i],dates[i-1]
        prev=wide["close"].loc[pdte]
        if (prev<=0).any():
            raise ValueError(f"{pdte}: non-positive previous close")
        factors={c:(wide[c].loc[d]/prev).mean() for c in ["open","high","low","close"]}
        candle={"time":d,**{c:prev_idx*float(factors[c]) for c in factors}}
        candle["high"]=max(candle["high"],candle["open"],candle["close"])
        candle["low"]=min(candle["low"],candle["open"],candle["close"])
        out.append(candle)
        prev_idx=candle["close"]
    payload={"name":"BIST 100 Equal Weight","base_value":BASE,
      "method":"daily equal-weight rebalanced synthetic OHLC","constituent_count":100,
      "candles":out}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"Wrote {len(out)} synthetic candles to {OUT}")

if __name__=="__main__": main()
