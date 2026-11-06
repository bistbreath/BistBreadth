#!/usr/bin/env python3
"""Build daily equal-weight synthetic OHLC series for BIST stock universes.

Membership is downloaded from Borsa Istanbul. Adjusted daily OHLC prices come
from Yahoo Finance via yfinance. These are research series, not official BIST
indices or executable portfolio returns.
"""
from __future__ import annotations

from datetime import datetime, timezone
from io import StringIO
import json
from pathlib import Path
import time

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "data" / "indices.json"
MEMBERS_URL = "https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv"
BASE_VALUE = 1000.0
PERIOD = "5y"
INDEXES = {
    "XU100": {"name": "BIST 100 Eşit Ağırlık", "short_name": "BIST 100", "color": "#75adf5", "minimum": 50},
    "XU030": {"name": "BIST 30 Eşit Ağırlık", "short_name": "BIST 30", "color": "#42c7a5", "minimum": 20},
    "XTUMY": {"name": "BIST Tüm-100 Eşit Ağırlık", "short_name": "XTUMY", "color": "#d69cff", "minimum": 50},
    "XUTUM": {"name": "BIST Tüm Eşit Ağırlık", "short_name": "Tüm BIST", "color": "#ffb86b", "minimum": 100},
}


def load_members() -> tuple[pd.DataFrame, str]:
    response = requests.get(MEMBERS_URL, timeout=45)
    response.raise_for_status()
    text = response.content.decode("utf-8-sig", errors="replace")
    frame = pd.read_csv(StringIO(text), sep=";", dtype=str)
    required = {"ENDEKS KODU", "BILESEN KODU"}
    if not required.issubset(frame.columns):
        raise ValueError(f"BIST component file columns changed: {list(frame.columns)}")
    # The first record repeats the bilingual headings in the official export.
    frame = frame.iloc[1:].copy()
    frame["index_code"] = frame["ENDEKS KODU"].str.strip().str.upper()
    frame["ticker"] = (
        frame["BILESEN KODU"].str.strip().str.upper()
        .str.replace(r"\.E$", "", regex=True)
    )
    frame = frame[frame["ticker"].str.fullmatch(r"[A-Z0-9]+", na=False)]
    return frame[["index_code", "ticker"]].drop_duplicates(), datetime.now(timezone.utc).isoformat()


def download_prices(symbols: list[str]) -> dict[str, pd.DataFrame]:
    result: dict[str, pd.DataFrame] = {}
    # Batches reduce Yahoo Finance request bursts, especially for the all-shares universe.
    for start in range(0, len(symbols), 35):
        batch = symbols[start:start + 35]
        raw = yf.download(
            [f"{symbol}.IS" for symbol in batch],
            period=PERIOD,
            interval="1d",
            auto_adjust=True,
            actions=False,
            progress=False,
            threads=True,
            group_by="ticker",
            timeout=45,
        )
        for symbol in batch:
            yahoo_symbol = f"{symbol}.IS"
            if isinstance(raw.columns, pd.MultiIndex):
                if yahoo_symbol in raw.columns.get_level_values(0):
                    data = raw[yahoo_symbol].copy()
                elif yahoo_symbol in raw.columns.get_level_values(-1):
                    data = raw.xs(yahoo_symbol, axis=1, level=-1).copy()
                else:
                    continue
            else:
                data = raw.copy()
            data.columns = [str(column).lower() for column in data.columns]
            if not {"open", "high", "low", "close"}.issubset(data.columns):
                continue
            data = data[["open", "high", "low", "close"]].apply(pd.to_numeric, errors="coerce")
            data = data.dropna(subset=["open", "high", "low", "close"])
            data = data[(data[["open", "high", "low", "close"]] > 0).all(axis=1)]
            if not data.empty:
                data.index = pd.to_datetime(data.index).tz_localize(None).normalize()
                result[symbol] = data[~data.index.duplicated(keep="last")]
        if start + 35 < len(symbols):
            time.sleep(2)
    return result


def make_candles(members: list[str], prices: dict[str, pd.DataFrame]) -> list[dict]:
    missing = [symbol for symbol in members if symbol not in prices]
    if missing:
        raise ValueError(f"Yahoo Finance returned no usable OHLC for {len(missing)} members: {missing[:12]}")

    closes = pd.concat({symbol: prices[symbol]["close"] for symbol in members}, axis=1).sort_index()
    valid_dates = closes.dropna(axis=0, how="any").index
    if len(valid_dates) < 2:
        raise ValueError(f"Only {len(valid_dates)} complete trading dates for this universe")
    closes = closes.loc[valid_dates]
    candles = [{
        "time": valid_dates[0].strftime("%Y-%m-%d"),
        "open": BASE_VALUE, "high": BASE_VALUE, "low": BASE_VALUE, "close": BASE_VALUE,
    }]
    previous_close = closes.iloc[0]
    index_close = BASE_VALUE
    for date in valid_dates[1:]:
        previous = previous_close
        current = {
            symbol: prices[symbol].loc[date, ["open", "high", "low", "close"]]
            for symbol in members
        }
        rows = pd.DataFrame(current).T
        factors = rows.div(previous, axis=0).mean(axis=0)
        candle = {
            "time": date.strftime("%Y-%m-%d"),
            **{field: round(index_close * float(factors[field]), 6)
               for field in ("open", "high", "low", "close")},
        }
        candle["high"] = max(candle["high"], candle["open"], candle["close"])
        candle["low"] = min(candle["low"], candle["open"], candle["close"])
        candles.append(candle)
        index_close = candle["close"]
        previous_close = closes.loc[date]
    return candles


def main() -> None:
    constituents, fetched_at = load_members()
    symbols = sorted(set().union(*[
        set(constituents.loc[constituents.index_code == code, "ticker"])
        for code in INDEXES
    ]))
    prices = download_prices(symbols)
    payload = {
        "updated_at": fetched_at,
        "price_source": "Yahoo Finance (yfinance), auto-adjusted daily OHLC",
        "membership_source": MEMBERS_URL,
        "method": "Daily equal-weight rebalanced synthetic OHLC, base 1000",
        "indexes": {},
    }
    for code, config in INDEXES.items():
        members = sorted(set(constituents.loc[constituents.index_code == code, "ticker"]))
        if len(members) < config["minimum"]:
            raise ValueError(f"{code}: expected at least {config['minimum']} constituents, got {len(members)}")
        candles = make_candles(members, prices)
        payload["indexes"][code] = {
            **config,
            "code": code,
            "constituent_count": len(members),
            "membership_as_of": fetched_at[:10],
            "history_starts": candles[0]["time"],
            "candles": candles,
        }
        print(f"{code}: {len(members)} constituents, {len(candles)} candles")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
