# -*- coding: utf-8 -*-
"""
TEFAS fon akisi hesaplayici
  python scripts/tefas_flows.py backfill   -> son 5 yili ceker (uzun surer, bir kez calistir)
  python scripts/tefas_flows.py update     -> son 15 gunu ceker, mevcut veriye ekler (gunluk cron)

Net akis = (pay_sayisi_t - pay_sayisi_t-1) * fiyat_t
Cikti: data/flows.json
"""
import json
import os
import sys
import time
from datetime import date, timedelta

import requests

API_URL = "https://www.tefas.gov.tr/api/DB/BindHistoryInfo"
OUT_PATH = "data/flows.json"
CHUNK_DAYS = 25          # API ~90 gun limitli, guvenli tarafta kaliyoruz
BACKFILL_YEARS = 5
UPDATE_LOOKBACK_DAYS = 15
REQUEST_SLEEP = 2.0      # istekler arasi bekleme (WAF'i kizdirmamak icin)

INCLUDE_SERBEST = False  # serbest fonlar dahil edilsin mi
INCLUDE_YABANCI = False  # yabanci hisse fonlari dahil edilsin mi

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Origin": "https://www.tefas.gov.tr",
    "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}

TR_MAP = str.maketrans("İıŞşĞğÜüÖöÇç", "IISSGGUUOOCC")


def normalize(title):
    return (title or "").translate(TR_MAP).upper()


def classify(title):
    """Fon unvanina gore kategori: 'hisse', 'ppf' veya None."""
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


def fetch_chunk(session, start, end):
    payload = {
        "fontip": "YAT",
        "sfontur": "",
        "fonkod": "",
        "fongrup": "",
        "bastarih": start.strftime("%d.%m.%Y"),
        "bittarih": end.strftime("%d.%m.%Y"),
        "fonturkod": "",
        "fonunvantip": "",
    }
    for attempt in range(4):
        try:
            r = session.post(API_URL, data=payload, timeout=90)
            if r.status_code == 200:
                return r.json().get("data", [])
            print(f"  HTTP {r.status_code}, deneme {attempt + 1}")
        except Exception as e:
            print(f"  hata: {e}, deneme {attempt + 1}")
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"TEFAS istegi basarisiz: {start} - {end}")


def collect(start_date, end_date):
    """Tarih araligindaki tum fon kayitlarini ceker.
    Donen yapi: {fon_kodu: {'cat': str, 'series': {tarih: (fiyat, pay)}}}"""
    session = requests.Session()
    session.headers.update(HEADERS)
    funds = {}
    cur = start_date
    while cur <= end_date:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), end_date)
        print(f"Cekiliyor: {cur} -> {chunk_end}")
        rows = fetch_chunk(session, cur, chunk_end)
        for row in rows:
            code = row.get("FONKODU")
            title = row.get("FONUNVAN")
            cat = classify(title)
            if cat is None:
                continue
            try:
                ts = int(row["TARIH"]) // 1000
                d = date.fromtimestamp(ts).isoformat()
                price = float(row["FIYAT"] or 0)
                shares = float(row["TEDPAYSAYISI"] or 0)
            except (KeyError, TypeError, ValueError):
                continue
            if price <= 0:
                continue
            entry = funds.setdefault(code, {"cat": cat, "series": {}})
            entry["series"][d] = (price, shares)
        time.sleep(REQUEST_SLEEP)
        cur = chunk_end + timedelta(days=1)
    return funds


def compute_daily_flows(funds):
    """Fon bazinda pay degisiminden gunluk net akis; kategori bazinda toplar.
    Donen yapi: {tarih: {'hisse_net':.., 'ppf_net':.., 'hisse_aum':.., 'ppf_aum':..}}"""
    daily = {}
    for code, info in funds.items():
        cat = info["cat"]
        dates = sorted(info["series"].keys())
        prev_shares = None
        for d in dates:
            price, shares = info["series"][d]
            rec = daily.setdefault(d, {"hisse_net": 0.0, "ppf_net": 0.0,
                                       "hisse_aum": 0.0, "ppf_aum": 0.0})
            rec[f"{cat}_aum"] += price * shares
            if prev_shares is not None:
                rec[f"{cat}_net"] += (shares - prev_shares) * price
            prev_shares = shares
    return daily


def load_existing():
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"daily": {}}


def save(daily_map):
    dates = sorted(daily_map.keys())
    cum_h, cum_p = 0.0, 0.0
    out_dates, h_net, p_net, h_cum, p_cum, h_aum, p_aum = [], [], [], [], [], [], []
    for d in dates:
        rec = daily_map[d]
        cum_h += rec["hisse_net"]
        cum_p += rec["ppf_net"]
        out_dates.append(d)
        h_net.append(round(rec["hisse_net"] / 1e6, 2))   # milyon TL
        p_net.append(round(rec["ppf_net"] / 1e6, 2))
        h_cum.append(round(cum_h / 1e9, 3))              # milyar TL
        p_cum.append(round(cum_p / 1e9, 3))
        h_aum.append(round(rec["hisse_aum"] / 1e9, 3))
        p_aum.append(round(rec["ppf_aum"] / 1e9, 3))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    payload = {
        "updated": date.today().isoformat(),
        "unit_net": "milyon TL", "unit_cum": "milyar TL",
        "daily": daily_map,
        "series": {
            "dates": out_dates,
            "hisse": {"net": h_net, "cum": h_cum, "aum": h_aum},
            "ppf": {"net": p_net, "cum": p_cum, "aum": p_aum},
        },
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"Kaydedildi: {OUT_PATH} ({len(out_dates)} gun)")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "update"
    today = date.today()
    if mode == "backfill":
        start = today - timedelta(days=BACKFILL_YEARS * 365)
        funds = collect(start, today)
        daily = compute_daily_flows(funds)
        save(daily)
    else:
        existing = load_existing()
        daily_map = existing.get("daily", {})
        start = today - timedelta(days=UPDATE_LOOKBACK_DAYS)
        funds = collect(start, today)
        new_daily = compute_daily_flows(funds)
        # lookback'in ilk gunu baz gun oldugu icin akisi eksik olabilir; onu atla
        skip = min(new_daily.keys()) if new_daily else None
        for d, rec in new_daily.items():
            if d == skip and d in daily_map:
                continue
            daily_map[d] = rec
        save(daily_map)


if __name__ == "__main__":
    main()
