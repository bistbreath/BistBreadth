"""
BIST Momentum Breadth + Advance/Decline Line
--------------------------------------------
Her islem gunu icin hesaplar:
  - up30 : son 1 ayda  (21 islem gunu)  >= %30 yukselen hisse sayisi
  - up50 : son 3 ayda  (63 islem gunu)  >= %50 yukselen hisse sayisi
  - up70 : son 6 ayda  (126 islem gunu) >= %70 yukselen hisse sayisi
  - p30/p50/p70 : ayni metriklerin, o gun gecerli veriye sahip hisse
    sayisina bolunmus yuzdesi (yeni halka arzlar paydayi degistirir)
  - adv / dec : gun ici yukselen / dusen hisse sayisi (onceki kapanisa gore)
  - ad : kumulatif Advance/Decline Line (adv - dec toplami)

Kullanim:
  python scripts/momentum_breadth.py backfill   # son ~252 islem gununu bastan kurar
  python scripts/momentum_breadth.py update     # sadece yeni gunleri ekler (varsayilan)

Cikti: docs/data/momentum.json (kolon bazli, flows.json ile ayni stil)

Notlar:
  - auto_adjust=True: bedelli/bedelsiz ve temettu duzeltmesi yapilir. Bu olmazsa
    sermaye artirimlari sahte dusus olarak A/D'yi ve momentum sayaclarini bozar.
  - A/D Line'in mutlak seviyesi keyfidir (backfill gununde 0'dan baslar);
    onemli olan sekli ve XU100 ile diverjansidir. update modu son degerden
    zincirleyerek devam eder, boylece seri kirilmadan uzar.
  - Islem gunu penceresi: 1 ay ~ 21, 3 ay ~ 63, 6 ay ~ 126.
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

LOOKBACKS = {
    "30": (21, 0.30),
    "50": (63, 0.50),
    "70": (126, 0.70),
}
BACKFILL_DAYS = 252          # ciktida tutulacak islem gunu (~1 yil)
CHUNK_SIZE = 50
SLEEP_BETWEEN_CHUNKS = 1.5

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_FILE = os.path.join(BASE_DIR, "tickers.txt")
DATA_FILE = os.path.join(BASE_DIR, "docs", "data", "momentum.json")


def load_tickers():
    with open(TICKERS_FILE) as f:
        codes = [line.strip() for line in f if line.strip()]
    return [c + ".IS" for c in codes]


def chunk(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def download_closes(tickers, calendar_days):
    start = (datetime.now() - timedelta(days=calendar_days)).strftime("%Y-%m-%d")
    frames = []
    for i, batch in enumerate(chunk(tickers, CHUNK_SIZE), 1):
        for attempt in range(3):
            try:
                data = yf.download(
                    tickers=batch, start=start, interval="1d",
                    group_by="ticker", threads=True, progress=False,
                    auto_adjust=True,
                )
                break
            except Exception as e:
                print(f"[batch {i}] deneme {attempt + 1} hata: {e}")
                time.sleep(5)
        else:
            continue

        if len(batch) == 1:
            closes = data[["Close"]].rename(columns={"Close": batch[0]})
        else:
            closes = pd.concat(
                {t: data[t]["Close"] for t in batch
                 if t in data.columns.get_level_values(0)},
                axis=1,
            )
        frames.append(closes)
        time.sleep(SLEEP_BETWEEN_CHUNKS)

    closes = pd.concat(frames, axis=1)
    closes = closes.loc[:, ~closes.columns.duplicated()]
    return closes.dropna(how="all")


def compute_frame(closes):
    """Gun bazli tum metrikler (ad haric — o cagirana gore zincirlenir)."""
    df = pd.DataFrame(index=closes.index)
    for key, (window, threshold) in LOOKBACKS.items():
        ret = closes / closes.shift(window) - 1
        df["up" + key] = (ret >= threshold).sum(axis=1)
        valid = ret.notna().sum(axis=1)
        df["p" + key] = (df["up" + key] / valid.where(valid > 0) * 100).round(2)
    prev = closes.shift(1)
    df["adv"] = ((closes > prev) & prev.notna()).sum(axis=1)
    df["dec"] = ((closes < prev) & prev.notna()).sum(axis=1)
    df["net"] = df["adv"] - df["dec"]
    return df


def to_json(dates, df, ad):
    payload = {
        "updated": datetime.now().isoformat(timespec="seconds"),
        "dates": [d.strftime("%Y-%m-%d") for d in dates],
        "ad": [int(v) for v in ad],
    }
    for col in ("up30", "up50", "up70", "adv", "dec"):
        payload[col] = [int(v) for v in df[col]]
    for col in ("p30", "p50", "p70"):
        payload[col] = [None if pd.isna(v) else float(v) for v in df[col]]
    return payload


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "update"
    existing = None
    if mode != "backfill" and os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            existing = json.load(f)
    if existing is None:
        mode = "backfill"

    tickers = load_tickers()
    # backfill: 252 cikti + 126 lookback islem gunu icin ~600 takvim gunu gerekir
    calendar_days = 620 if mode == "backfill" else 240
    print(f"mode={mode} · {len(tickers)} hisse indiriliyor ({calendar_days} takvim gunu)...")
    closes = download_closes(tickers, calendar_days)
    print(f"Fiyat matrisi: {closes.shape[0]} gun x {closes.shape[1]} hisse")

    df = compute_frame(closes)

    if mode == "backfill":
        out = df.tail(BACKFILL_DAYS).copy()
        ad = out["net"].cumsum()
        payload = to_json(out.index, out, ad)
    else:
        last_date = pd.Timestamp(existing["dates"][-1])
        new = df[df.index > last_date].copy()
        if new.empty:
            print("Yeni gun yok, cikiliyor.")
            return
        ad_new = existing["ad"][-1] + new["net"].cumsum()
        payload = existing
        payload["updated"] = datetime.now().isoformat(timespec="seconds")
        payload["dates"] += [d.strftime("%Y-%m-%d") for d in new.index]
        payload["ad"] += [int(v) for v in ad_new]
        for col in ("up30", "up50", "up70", "adv", "dec"):
            payload[col] += [int(v) for v in new[col]]
        for col in ("p30", "p50", "p70"):
            payload[col] += [None if pd.isna(v) else float(v) for v in new[col]]
        print(f"{len(new)} yeni gun eklendi: {payload['dates'][-1]}")

    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"Yazildi: {DATA_FILE} · toplam {len(payload['dates'])} gun")


if __name__ == "__main__":
    main()
