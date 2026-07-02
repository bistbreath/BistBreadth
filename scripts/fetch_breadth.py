"""
BIST Market Breadth Tracker
----------------------------
Her calistirildiginda (GitHub Actions ile 30 dakikada bir tetiklenir):
  - tickers.txt icindeki hisseleri Yahoo Finance'ten (yfinance) ceker
  - her hisse icin:
      * onceki kapanisa gore yuzde degisim
      * gunun acilisina gore yuzde degisim (senin "sabah vs gun sonu" hipotezin icin)
  - pozitif / negatif sayilarini, %4 uzeri / %4 alti sayilarini hesaplar
  - docs/data.json dosyasina yeni bir kayit ekler (zaman serisi olarak birikir)

Not: Yahoo Finance verisi BIST icin ortalama 15 dk gecikmelidir. Bu breadth
takibi icin sorun degil (trade tetikleyici degil, genel piyasa nabzi olcumu).
"""

import json
import os
import time
from datetime import datetime

import pytz
import yfinance as yf

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_FILE = os.path.join(BASE_DIR, "tickers.txt")
DATA_FILE = os.path.join(BASE_DIR, "docs", "data.json")
ISTANBUL_TZ = pytz.timezone("Europe/Istanbul")
CHUNK_SIZE = 20          # Yahoo'yu asiri yuklememek icin parca parca cek
SLEEP_BETWEEN_CHUNKS = 2  # saniye


def load_tickers():
    with open(TICKERS_FILE) as f:
        codes = [line.strip() for line in f if line.strip()]
    return [c + ".IS" for c in codes], codes


def chunk(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def fetch_daily_reference(tickers):
    """Onceki kapanis ve gunun acilisini dondurur: {ticker: (prev_close, today_open)}"""
    result = {}
    for batch in chunk(tickers, CHUNK_SIZE):
        try:
            data = yf.download(
                tickers=batch, period="5d", interval="1d",
                group_by="ticker", threads=True, progress=False,
                auto_adjust=False,
            )
        except Exception as e:
            print(f"[daily] batch hata: {e}")
            continue

        for t in batch:
            try:
                if len(batch) == 1:
                    df = data
                else:
                    df = data[t]
                df = df.dropna(subset=["Close"])
                if len(df) < 2:
                    continue
                prev_close = float(df["Close"].iloc[-2])
                today_open = float(df["Open"].iloc[-1])
                result[t] = (prev_close, today_open)
            except Exception:
                continue
        time.sleep(SLEEP_BETWEEN_CHUNKS)
    return result


def fetch_current_prices(tickers):
    """Guncel (en son islem gorenm) fiyati dondurur: {ticker: price}"""
    result = {}
    for batch in chunk(tickers, CHUNK_SIZE):
        try:
            data = yf.download(
                tickers=batch, period="1d", interval="5m",
                group_by="ticker", threads=True, progress=False,
            )
        except Exception as e:
            print(f"[intraday] batch hata: {e}")
            continue

        for t in batch:
            try:
                if len(batch) == 1:
                    df = data
                else:
                    df = data[t]
                df = df.dropna(subset=["Close"])
                if len(df) == 0:
                    continue
                result[t] = float(df["Close"].iloc[-1])
            except Exception:
                continue
        time.sleep(SLEEP_BETWEEN_CHUNKS)
    return result


def compute_breadth(codes, tickers_map, daily_ref, current):
    positive = negative = up4 = down4 = 0
    positive_vs_open = negative_vs_open = 0
    matched = 0
    rows = []

    for code, ticker in zip(codes, tickers_map):
        if ticker not in daily_ref or ticker not in current:
            continue
        prev_close, today_open = daily_ref[ticker]
        price = current[ticker]
        if not prev_close or not today_open:
            continue

        matched += 1
        pct_vs_prev = (price - prev_close) / prev_close * 100
        pct_vs_open = (price - today_open) / today_open * 100

        if pct_vs_prev > 0:
            positive += 1
        elif pct_vs_prev < 0:
            negative += 1
        if pct_vs_prev >= 4:
            up4 += 1
        if pct_vs_prev <= -4:
            down4 += 1

        if pct_vs_open > 0:
            positive_vs_open += 1
        elif pct_vs_open < 0:
            negative_vs_open += 1

        rows.append({
            "code": code,
            "pct_vs_prev_close": round(pct_vs_prev, 2),
            "pct_vs_open": round(pct_vs_open, 2),
        })

    return {
        "timestamp": datetime.now(ISTANBUL_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "total_tracked": matched,
        "positive": positive,
        "negative": negative,
        "up_4pct": up4,
        "down_4pct": down4,
        "positive_vs_open": positive_vs_open,
        "negative_vs_open": negative_vs_open,
        "details": rows,
    }


def append_record(record):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            try:
                history = json.load(f)
            except json.JSONDecodeError:
                history = []
    else:
        history = []

    history.append(record)
    # cok fazla buyumesin diye son 2000 kaydi tut (~ birkac ay 30dk periyotla)
    history = history[-2000:]

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def main():
    tickers, codes = load_tickers()
    print(f"{len(tickers)} hisse yuklendi.")

    daily_ref = fetch_daily_reference(tickers)
    print(f"Gunluk referans alinan hisse sayisi: {len(daily_ref)}")

    current = fetch_current_prices(tickers)
    print(f"Guncel fiyat alinan hisse sayisi: {len(current)}")

    record = compute_breadth(codes, tickers, daily_ref, current)
    append_record(record)

    print(json.dumps({k: v for k, v in record.items() if k != "details"},
                      ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
