"""
BIST Ceyreklik Mali Tablo Cekici (v3 - brut kar duzeltmesi + ROE/ROIC + net borc)
"""

import json
import os
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

TAX_RATE = 0.25  # ROIC icin varsayilan kurumlar vergisi

# Gelir tablosu (kumulatif -> ceyreklige cevrilecek)
INCOME_CODES = {
    "satislar": "3C",
    "brut_kar": "3D",            # BRUT KAR (ZARAR) - toplam
    "esas_faaliyet_kari": "3H",  # Net Faaliyet Kar/Zarari
    "amortisman": "4B",          # Amortisman Giderleri
    "net_kar": "3L",             # DONEM KARI (ZARARI)
}
BALANCE_CODES = {
    "donen_varliklar": "1A",
    "duran_varliklar": "1AK",
    "nakit": "1AA",
    "finansal_yatirimlar": "1AB",
    "finansal_borclar_kv": "2AA",   # Kisa Vadeli Finansal Borclar
    "finansal_borclar_uv": "2BA",   # Uzun Vadeli Finansal Borclar (ROIC icin)
    "ozkaynaklar": "2N",
}
ALT_INCOME = {
    "satislar": ["3C", "4C"],
    "net_kar": ["3L", "3Z"],
    "brut_kar": ["3D", "3CAB"],
}


def load_tickers():
    with open(TICKERS_FILE) as f:
        return [l.strip() for l in f if l.strip()]


def year_quarters_back(n):
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
    params = {"companyCode": code, "exchange": "TRY", "financialGroup": "XI_29"}
    for i, (y, p) in enumerate(periods4, start=1):
        params[f"year{i}"] = y
        params[f"period{i}"] = p
    try:
        r = requests.get(API, params=params, headers=HEADERS, timeout=25)
        r.raise_for_status()
        return (r.json() or {}).get("value", []) or []
    except Exception as e:
        print(f"  [{code}] {periods4[0]} hata: {e}")
        return []


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


def fetch_all_periods(code, periods):
    result = {}
    for i in range(0, len(periods), 4):
        chunk = periods[i:i + 4]
        while len(chunk) < 4:
            chunk.append(chunk[-1])
        rows = fetch_group(code, chunk)
        for row in rows:
            ic = (row.get("itemCode") or "").strip()
            if not ic:
                continue
            for j, (y, p) in enumerate(chunk, start=1):
                val = to_float(row.get(f"value{j}"))
                if val is None:
                    continue
                result.setdefault((y, p), {})[ic] = val
        time.sleep(0.4)
    return result


def resolve_code(pd, key, code_map, alt_map=None):
    candidates = [code_map[key]]
    if alt_map and key in alt_map:
        candidates = alt_map[key]
    for c in candidates:
        if c in pd and pd[c] is not None:
            return c
    return None


def cumulative_to_quarterly(y, p, code, all_data):
    pd = all_data.get((y, p), {})
    cum = pd.get(code)
    if cum is None:
        return None
    if p == 3:
        return cum
    prev = all_data.get((y, p - 3), {})
    prev_val = prev.get(code)
    if prev_val is None:
        return None
    return cum - prev_val


def build_company(code, want_quarters=10):
    periods = year_quarters_back(want_quarters + 5)
    all_data = fetch_all_periods(code, periods)
    display_periods = year_quarters_back(want_quarters)

    # Once tum ceyrekler icin temel degerleri hesapla (ROE/ROIC TTM icin lazim)
    all_disp = year_quarters_back(want_quarters + 4)
    q_income = {}  # (y,p) -> {net_kar, efk, ...}
    for (y, p) in all_disp:
        pd = all_data.get((y, p), {})

        def iq(key):
            c = resolve_code(pd, key, INCOME_CODES, ALT_INCOME)
            if c is None:
                return None
            return cumulative_to_quarterly(y, p, c, all_data)

        q_income[(y, p)] = {
            "satislar": iq("satislar"),
            "brut_kar": iq("brut_kar"),
            "esas_faaliyet_kari": iq("esas_faaliyet_kari"),
            "amortisman": iq("amortisman"),
            "net_kar": iq("net_kar"),
        }

    def bal_at(y, p, key):
        pd = all_data.get((y, p), {})
        c = resolve_code(pd, key, BALANCE_CODES)
        return pd.get(c) if c else None

    def ttm_sum(y, p, field):
        """Son 4 ceyregin (bu dahil) toplami."""
        total = 0.0
        found = False
        yy, pp = y, p
        for _ in range(4):
            v = q_income.get((yy, pp), {}).get(field)
            if v is not None:
                total += v
                found = True
            pp -= 3
            if pp == 0:
                pp = 12
                yy -= 1
        return total if found else None

    quarters = []
    for (y, p) in display_periods:
        inc = q_income.get((y, p), {})
        sat = inc.get("satislar")
        brut = inc.get("brut_kar")
        efk = inc.get("esas_faaliyet_kari")
        amort = inc.get("amortisman")
        netk = inc.get("net_kar")

        favok = None
        if efk is not None:
            favok = efk + (abs(amort) if amort is not None else 0)

        def margin(x):
            if x is not None and sat not in (None, 0):
                return round(x / sat * 100, 1)
            return None

        ozk = bal_at(y, p, "ozkaynaklar")
        fb_kv = bal_at(y, p, "finansal_borclar_kv")
        fb_uv = bal_at(y, p, "finansal_borclar_uv")

        # ROE (TTM) = son 4 ceyrek net kar / ortalama ozkaynak
        roe = None
        netk_ttm = ttm_sum(y, p, "net_kar")
        # bir yil onceki ozkaynak
        py, pp = y, p
        for _ in range(4):
            pp -= 3
            if pp == 0:
                pp = 12
                py -= 1
        ozk_prev = bal_at(py, pp, "ozkaynaklar")
        if netk_ttm is not None and ozk is not None:
            avg_ozk = (ozk + ozk_prev) / 2 if ozk_prev is not None else ozk
            if avg_ozk and avg_ozk != 0:
                roe = round(netk_ttm / avg_ozk * 100, 1)

        # ROIC (TTM) = NOPAT / yatirilan sermaye
        # NOPAT = son 4 ceyrek net faaliyet kari * (1 - vergi)
        # yatirilan sermaye = kisa+uzun finansal borc + ozkaynak
        roic = None
        efk_ttm = ttm_sum(y, p, "esas_faaliyet_kari")
        if efk_ttm is not None and ozk is not None:
            invested = ozk + (fb_kv or 0) + (fb_uv or 0)
            if invested and invested != 0:
                nopat = efk_ttm * (1 - TAX_RATE)
                roic = round(nopat / invested * 100, 1)

        nakit = bal_at(y, p, "nakit")
        finyat = bal_at(y, p, "finansal_yatirimlar")
        nakit_fy = None
        if nakit is not None or finyat is not None:
            nakit_fy = (nakit or 0) + (finyat or 0)

        # Net Borc = toplam finansal borc - (nakit + finansal yatirim)
        net_borc = None
        toplam_fb = (fb_kv or 0) + (fb_uv or 0)
        if fb_kv is not None or fb_uv is not None or nakit_fy is not None:
            net_borc = toplam_fb - (nakit_fy or 0)

        # Net Borc / FAVOK (TTM FAVOK ile)
        net_borc_favok = None
        favok_ttm = None
        efk_ttm_f = ttm_sum(y, p, "esas_faaliyet_kari")
        amort_ttm_f = ttm_sum(y, p, "amortisman")
        if efk_ttm_f is not None:
            favok_ttm = efk_ttm_f + (abs(amort_ttm_f) if amort_ttm_f is not None else 0)
        if net_borc is not None and favok_ttm not in (None, 0):
            net_borc_favok = round(net_borc / favok_ttm, 2)

        quarters.append({
            "period": f"{y}/{p:02d}",
            "satislar": sat,
            "brut_kar": brut,
            "esas_faaliyet_kari": efk,
            "favok": favok,
            "net_kar": netk,
            "brut_marj": margin(brut),
            "favok_marj": margin(favok),
            "net_marj": margin(netk),
            "roe": roe,
            "roic": roic,
            "donen_varliklar": bal_at(y, p, "donen_varliklar"),
            "duran_varliklar": bal_at(y, p, "duran_varliklar"),
            "nakit_finansal_yatirim": nakit_fy,
            "finansal_borclar_kv": fb_kv,
            "net_borc": net_borc,
            "net_borc_favok": net_borc_favok,
            "ozkaynaklar": ozk,
        })

    return {
        "code": code,
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "quarters": quarters,
    }


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
        f[:-5] for f in os.listdir(OUT_DIR)
        if f.endswith(".json") and f != "_index.json"
    )
    with open(os.path.join(OUT_DIR, "_index.json"), "w", encoding="utf-8") as f:
        json.dump(codes_with_data, f, ensure_ascii=False)

    print(f"Bitti. {ok} hisse. Indeks: {len(codes_with_data)} kod.")


if __name__ == "__main__":
    main()
