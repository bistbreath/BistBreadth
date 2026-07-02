"""
BIST Tam Hisse Listesi Guncelleyici
-------------------------------------
uzmanpara.milliyet.com.tr'nin "Tum Hisseler" sayfasini harf harf tarayarak
(A, B, C, ... Z) BIST'te islem goren TUM hisse kodlarini toplar ve
tickers.txt dosyasina yazar.

Bu script gunde bir kez (ayri bir GitHub Actions workflow ile) calisir.
fetch_breadth.py her 30 dakikada bir sadece bu dosyayi okur; kendisi
tarama yapmaz (Yahoo/milliyet'i gereksiz yere yormamak icin).

Fonlari (BYF / borsa yatirim fonlari) otomatik olarak eler, cunku bunlar
hisse senedi degildir.
"""

import os
import re
import time

import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_FILE = os.path.join(BASE_DIR, "tickers.txt")

BASE_URL = "https://uzmanpara.milliyet.com.tr/canli-borsa/"
LETTERS = list("ABCDEFGHIKLMNOPRSTUVXYZ") + ["Q", "W", "J"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}

LINK_RE = re.compile(
    r'hisse-senetleri/([a-z0-9\-]+)/', re.IGNORECASE
)


def fetch_letter(letter):
    url = f"{BASE_URL}?Harf={letter}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"[{letter}] istek hatasi: {e}")
        return set()

    codes = set()
    for slug in LINK_RE.findall(resp.text):
        slug = slug.strip("/").lower()
        if not slug:
            continue
        if "byf" in slug:
            continue
        code = slug.split("-")[-1].upper()
        if 2 <= len(code) <= 6 and code.isalnum():
            codes.add(code)
    return codes


def main():
    all_codes = set()
    for letter in LETTERS:
        codes = fetch_letter(letter)
        print(f"[{letter}] {len(codes)} kod bulundu.")
        all_codes |= codes
        time.sleep(1)

    if len(all_codes) < 200:
        print(f"UYARI: sadece {len(all_codes)} kod bulundu, guncelleme iptal edildi.")
        return

    sorted_codes = sorted(all_codes)
    with open(TICKERS_FILE, "w") as f:
        f.write("\n".join(sorted_codes) + "\n")

    print(f"Toplam {len(sorted_codes)} hisse kodu tickers.txt'ye yazildi.")


if __name__ == "__main__":
    main()
