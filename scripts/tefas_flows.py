# -*- coding: utf-8 -*-
"""
TEFAS fon akisi hesaplayici (pytefas / yeni 2026 API)
  python scripts/tefas_flows.py backfill   -> son 5 yili ceker (~10-15 dk, bir kez)
  python scripts/tefas_flows.py update     -> son 15 gunu ceker, mevcut veriye ekler (gunluk)

Net akis (AUM yontemi):
  akis(t) = AUM(t) - AUM(t-1) * (fiyat(t) / fiyat(t-1))
  Bu, deger artisini (getiriyi) ayiklar; geriye net para giris/cikisi kalir.
Cikti: docs/data/flows.json
"""
import json
import os
import sys
from datetime import date, timedelta

import pandas as pd
from pytefas import Crawler

OUT_PATH = "docs/data/flows.json"
CHUNK_DAYS = 28          # yeni API tek istekte ~1 ay veriyor
BACKFILL_YEARS = 5
UPDATE_LOOKBACK_DAYS = 15

INCLUDE_SERBEST = False
INCLUDE_YABANCI = False

TR_MAP = str.maketrans("İıŞşĞğÜüÖöÇç", "IISSGGUUOOCC")


def normalize(title):
    return (title or "").translate(TR_MAP).upper()


def classify(title):
    """Fon unvanina gore: 'hisse', 'ppf' veya None."""
    t = normalize(title)
    is_serbest = "SERBEST" in t
    if "PARA PIYASASI" in t:
        if is_serbest and not INCLUDE_SERBEST:
            return None
        return "ppf"
    if "HISSE SENEDI" in t:
        if is_serbest and not INCLUDE_SERBEST:
            return None
        if "YABANCI" in t and not INCLUDE_YABANCI:
            return None
        return "hisse"
    return None


def fetch_range(crawler, start, end):
    """Tarih araligindaki tum YAT fonlarini ceker -> DataFrame.
    Kolonlar: date, fund_code, fund_name, price, portfolio_size."""
    df = crawler.fetch(start=start.isoformat(), end=end.isoformat(),
                       columns="info", kind="YAT")
    if df is None or len(df) == 0:
        return pd.DataFrame()
    keep = ["date", "fund_code", "fund_name", "price", "portfolio_size"]
    df = df[[c for c in keep if c in df.columns]].copy()
    df["date"] = pd.to_datetime(df["date"]).dt.date.astype(str)
    return df


def collect(start_date, end_date):
    crawler = Crawler()
    frames = []
    cur = start_date
    while cur <= end_date:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), end_date)
        print(f"Cekiliyor: {cur} -> {chunk_end}")
        try:
            df = fetch_range(crawler, cur, chunk_end)
            if len(df):
                frames.append(df)
        except Exception as e:
            print(f"  uyari: {cur}-{chunk_end} atlandi ({e})")
        cur = chunk_end + timedelta(days=1)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True).drop_duplicates(
        subset=["date", "fund_code"])


def compute_flows(df):
    """Fon bazinda AUM yontemiyle gunluk net akis; kategori bazinda toplar.
    Donen: {tarih: {hisse_net, ppf_net, hisse_aum, ppf_aum}} (deger: TL)."""
    df = df.copy()
    df["cat"] = df["fund_name"].map(classify)
    df = df[df["cat"].notna()]
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    df["portfolio_size"] = pd.to_numeric(df["portfolio_size"], errors="coerce")
    df = df.dropna(subset=["price", "portfolio_size"])
    df = df[df["price"] > 0]

    daily = {}
    for code, g in df.groupby("fund_code"):
        g = g.sort_values("date")
        cat = g["cat"].iloc[0]
        prev_price = None
        prev_aum = None
        for _, row in g.iterrows():
            d = row["date"]
            price = row["price"]
            aum = row["portfolio_size"]
            rec = daily.setdefault(d, {"hisse_net": 0.0, "ppf_net": 0.0,
                                       "hisse_aum": 0.0, "ppf_aum": 0.0})
            rec[f"{cat}_aum"] += aum
            if prev_price is not None and prev_price > 0:
                expected = prev_aum * (price / prev_price)  # getiriden gelen kisim
                rec[f"{cat}_net"] += (aum - expected)       # net para akisi
            prev_price = price
            prev_aum = aum
    return daily


def load_existing():
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("daily", {})
    return {}


def save(daily_map):
    dates = sorted(daily_map.keys())
    cum_h, cum_p = 0.0, 0.0
    out = {"dates": [], "hisse": {"net": [], "cum": [], "aum": []},
           "ppf": {"net": [], "cum": [], "aum": []}}
    for d in dates:
        rec = daily_map[d]
        cum_h += rec["hisse_net"]
        cum_p += rec["ppf_net"]
        out["dates"].append(d)
        out["hisse"]["net"].append(round(rec["hisse_net"] / 1e6, 2))   # milyon TL
        out["ppf"]["net"].append(round(rec["ppf_net"] / 1e6, 2))
        out["hisse"]["cum"].append(round(cum_h / 1e9, 3))              # milyar TL
        out["ppf"]["cum"].append(round(cum_p / 1e9, 3))
        out["hisse"]["aum"].append(round(rec["hisse_aum"] / 1e9, 3))
        out["ppf"]["aum"].append(round(rec["ppf_aum"] / 1e9, 3))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    payload = {"updated": date.today().isoformat(),
               "unit_net": "milyon TL", "unit_cum": "milyar TL",
               "daily": daily_map, "series": out}
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"Kaydedildi: {OUT_PATH} ({len(dates)} gun)")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "update"
    today = date.today()
    if mode == "backfill":
        start = today - timedelta(days=BACKFILL_YEARS * 365)
        df = collect(start, today)
        if df.empty:
            raise SystemExit("Veri bos geldi")
        save(compute_flows(df))
    else:
        daily_map = load_existing()
        start = today - timedelta(days=UPDATE_LOOKBACK_DAYS)
        df = collect(start, today)
        if df.empty:
            print("Yeni veri yok, cikiliyor")
            return
        new_daily = compute_flows(df)
        skip = min(new_daily.keys()) if new_daily else None  # baz gun eksik akisli
        for d, rec in new_daily.items():
            if d == skip and d in daily_map:
                continue
            daily_map[d] = rec
        save(daily_map)


if __name__ == "__main__":
    main()
