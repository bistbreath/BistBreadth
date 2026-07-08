# -*- coding: utf-8 -*-
"""XU100 gunluk OHLCV -> docs/data/xu100.json"""
import json
import os

import yfinance as yf

OUT_PATH = "docs/data/xu100.json"

df = yf.download("XU100.IS", period="5y", interval="1d",
                 auto_adjust=False, progress=False)
if df.empty:
    raise SystemExit("XU100 verisi bos geldi")
if hasattr(df.columns, "levels"):
    df.columns = df.columns.get_level_values(0)

rows = []
for idx, row in df.iterrows():
    try:
        rows.append({
            "t": idx.strftime("%Y-%m-%d"),
            "o": round(float(row["Open"]), 2),
            "h": round(float(row["High"]), 2),
            "l": round(float(row["Low"]), 2),
            "c": round(float(row["Close"]), 2),
            "v": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
        })
    except (ValueError, TypeError):
        continue

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump({"data": rows}, f)
print(f"Kaydedildi: {OUT_PATH} ({len(rows)} gun)")
