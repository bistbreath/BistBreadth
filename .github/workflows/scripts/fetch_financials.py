"""
BIST Ceyreklik Mali Tablo Cekici
"""

import json
import os
import re
import time
from datetime import datetime

import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_FILE = os.path.join(BASE_DIR, "tickers.txt")
OUT_DIR = os.path.join(BASE_DIR, "docs", "financials")

API = ("https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/"
       "Data.aspx/MaliTablo")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://www.isyatirim.com.tr/",
}

PATTERNS = {
    "satislar": [
        "hasılat", "satis gelirleri", "satış gelirleri", "faiz, kar payı ve benzeri gelirler",
        "esas faaliyet gelirleri",
    ],
    "brut_kar": [
        "brüt kar", "brüt kâr", "brüt esas faaliyet kar",
    ],
    "esas_faaliyet_kari": [
        "esas faaliyet kar", "faaliyet kârı", "faaliyet karı",
    ],
    "favok": [
        "favök", "favok", "faiz amortisman vergi öncesi kar",
    ],
    "net_kar": [
        "dönem net kar", "dönem net kâr", "net dönem kar", "net dönem kâr",
        "ana ortaklık payları", "net kar", "net kâr",
    ],
    "donen_varliklar": ["dönen varlıklar"],
    "duran_varliklar": ["duran varlıklar"],
    "nakit": [
        "nakit ve nakit benzerleri",
    ],
    "finansal_yatirimlar": [
        "finansal yatırımlar",
    ],
    "finansal_borclar_kv": [
        "kısa vadeli borçlanmalar", "finansal borçlar",
    ],
    "ozkaynaklar": [
        "özkaynaklar", "ana ortaklığa ait özkaynaklar", "toplam özkaynaklar",
    ],
}


def load_tickers():
    with open(TICKERS_FILE) as f:
        return [l.strip() for l in f if l.strip()]


def quarters_back(n):
    now = datetime.now()
    y, m = now.year, now.month
    if m <= 3:
        y, p = y - 1, 9
    elif m <= 5:
        y, p = y - 1, 12
    elif m <= 8:
        y, p = y, 3
    elif m <= 11:
        y, p = y, 6
    else:
        y, p = y, 9
    out = []
    for _ in range(n):
        out.append((y, p))
        p -= 3
        if p == 0:
            p = 12
            y -= 1
    return out


def fetch_group(code, periods4):
    params = {
        "companyCode": code,
        "exchange": "TRY",
        "financialGroup": "XI_29",
    }
    for i, (y, p) in enumerate(periods4, start=1):
        params[f"year{i}"] = y
        params[f"period{i}"] = p
    try:
        r = requests.get(API, params=params, headers=HEADERS, timeout=25)
        r.raise_for_status()
        data = r.json()
        return data.get("value", []) or []
    except Exception as e:
        print(f"  [{code}] {periods4[0]} hata: {e}")
        return []


def match_key(desc):
    d = desc.strip().lower()
    for key, pats in PATTERNS.items():
        for pat in pats:
            if pat in d:
                return key
    return None


def to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(".", "").replace(",", ".")
    if s in ("", "-", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def build_company(code, want_quarters=10):
    periods = quarters_back(want_quarters)
    period_map = {}
    for i in range(0, len(periods), 4):
        chunk = periods[i:i + 4]
        while len(chunk) < 4:
            chunk.append(chunk[-1])
        rows = fetch_group(code, chunk)
        for row in rows:
            desc = row.get("itemDescTr") or row.get("itemDescEng") or ""
            key = match_key(desc)
            if not key:
                continue
            for j, (y, p) in enumerate(chunk, start=1):
                val = to_float(row.get(f"value{j}"))
                if val is None:
                    continue
                pm = period_map.setdefault((y, p), {})
                pm.setdefault(key, val)
        time.sleep(0.4)

    quarters = []
    for (y, p) in periods:
        vals = period_map.get((y, p), {})
        sat = vals.get("satislar")
        brut = vals.get("brut_kar")
        favok = vals.get("favok")
        netk = vals.get("net_kar")

        def margin(x):
            if x is not None and sat not in (None, 0):
                return round(x / sat * 100, 1)
            return None

        quarters.append({
            "period": f"{y}/{p:02d}",
            "satislar": sat,
            "brut_kar": brut,
            "esas_faaliyet_kari": vals.get("esas_faaliyet_kari"),
            "favok": favok,
            "net_kar": netk,
            "brut_marj": margin(brut),
            "favok_marj": margin(favok),
            "net_marj": margin(netk),
            "donen_varliklar": vals.get("donen_varliklar"),
            "duran_varliklar": vals.get("duran_varliklar"),
            "nakit_finansal_yatirim": _sum_opt(vals.get("nakit"), vals.get("finansal_yatirimlar")),
            "finansal_borclar_kv": vals.get("finansal_borclar_kv"),
            "ozkaynaklar": vals.get("ozkaynaklar"),
        })

    return {
        "code": code,
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "quarters": quarters,
    }


def _sum_opt(a, b):
    if a is None and b is None:
        return None
    return (a or 0) + (b or 0)


def main():
    tickers = load_tickers()
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"{len(tickers)} hisse icin mali tablo cekilecek.")

    ok = 0
    for i, code in enumerate(tickers, start=1):
        try:
            company = build_company(code, want_quarters=10)
            has_data = any(q["satislar"] is not None for q in company["quarters"])
            if has_data:
                with open(os.path.join(OUT_DIR, f"{code}.json"), "w",
                          encoding="utf-8") as f:
                    json.dump(company, f, ensure_ascii=False)
                ok += 1
        except Exception as e:
            print(f"[{code}] genel hata: {e}")
        if i % 25 == 0:
            print(f"  ... {i}/{len(tickers)} islendi ({ok} basarili)")
        time.sleep(0.3)

    codes_with_data = sorted(
        f[:-5] for f in os.listdir(OUT_DIR) if f.endswith(".json") and f != "_index.json"
    )
    with open(os.path.join(OUT_DIR, "_index.json"), "w", encoding="utf-8") as f:
        json.dump(codes_with_data, f, ensure_ascii=False)

    print(f"Bitti. {ok} hisse icin veri kaydedildi. Indeks: {len(codes_with_data)} kod.")


if __name__ == "__main__":
    main()
