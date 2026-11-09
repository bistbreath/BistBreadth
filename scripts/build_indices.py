#!/usr/bin/env python3
"""Build point-in-time equal-weight synthetic OHLC charts for BIST universes.

Historical membership uses dated Borsa Istanbul review snapshots (archived from
BIST annual constituent workbooks). All-shares baskets also admit new tickers
on their first available daily quote after a snapshot. Prices are third-party
Yahoo Finance data, so daily quote coverage is reported per candle.
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
FINANCIAL_PRICE_OUTPUT = ROOT / "docs" / "data" / "financial_prices.json"
FINANCIAL_TICKERS = ["FONET", "YEOTK", "TCKRC", "CVKMD", "MEGMT", "BRSAN", "KBORU"]
MEMBERS_URL = "https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv"
HISTORICAL_MEMBERS_URL = (
    "https://raw.githubusercontent.com/GocmenCo/bist-constituents/master/"
    "data/bist_constituents.csv"
)
BASE_VALUE = 1000.0
PERIOD = "5y"
INDEXES = {
    "XU100": {"name": "BIST 100 Eşit Ağırlık", "short_name": "BIST 100", "color": "#75adf5", "minimum": 50},
    "XU030": {"name": "BIST 30 Eşit Ağırlık", "short_name": "BIST 30", "color": "#42c7a5", "minimum": 20},
    "XTUMY": {"name": "BIST Tüm-100 Eşit Ağırlık", "short_name": "XTUMY", "color": "#d69cff", "minimum": 50},
    "XUTUM": {"name": "BIST Tüm Eşit Ağırlık", "short_name": "Tüm BIST", "color": "#ffb86b", "minimum": 100},
}


def load_current_members() -> tuple[dict[str, set[str]], str]:
    response = requests.get(MEMBERS_URL, timeout=45)
    response.raise_for_status()
    text = response.content.decode("utf-8-sig", errors="replace")
    frame = pd.read_csv(StringIO(text), sep=";", dtype=str)
    required = {"ENDEKS KODU", "BILESEN KODU"}
    if not required.issubset(frame.columns):
        raise ValueError(f"BIST component file columns changed: {list(frame.columns)}")
    frame = frame.iloc[1:].copy()
    frame["index_code"] = frame["ENDEKS KODU"].str.strip().str.upper()
    frame["ticker"] = (
        frame["BILESEN KODU"].str.strip().str.upper()
        .str.replace(r"\.E$", "", regex=True)
    )
    frame = frame[frame["ticker"].str.fullmatch(r"[A-Z0-9]+", na=False)]
    current = {
        code: set(frame.loc[frame.index_code == code, "ticker"])
        for code in INDEXES
    }
    for code, config in INDEXES.items():
        if len(current[code]) < config["minimum"]:
            raise ValueError(f"Current BIST membership missing/too small for {code}: {len(current[code])}")
    return current, datetime.now(timezone.utc).isoformat()


def load_historical_members() -> dict[str, dict[pd.Timestamp, set[str]]]:
    response = requests.get(HISTORICAL_MEMBERS_URL, timeout=60)
    response.raise_for_status()
    frame = pd.read_csv(StringIO(response.content.decode("utf-8-sig")))
    required = {"snapshot_date", "ticker", "index"}
    if not required.issubset(frame.columns):
        raise ValueError(f"Historical membership archive columns changed: {list(frame.columns)}")
    frame["snapshot_date"] = pd.to_datetime(frame["snapshot_date"], errors="coerce").dt.normalize()
    frame["ticker"] = frame["ticker"].astype(str).str.strip().str.upper()
    frame["index"] = frame["index"].fillna("").astype(str).str.strip().str.upper()
    frame = frame[
        frame["snapshot_date"].notna()
        & frame["ticker"].str.fullmatch(r"[A-Z0-9]+", na=False)
    ]
    snapshots: dict[str, dict[pd.Timestamp, set[str]]] = {code: {} for code in INDEXES}
    for date, rows in frame.groupby("snapshot_date", sort=True):
        market = set(rows["ticker"])
        tiers = rows.set_index("ticker")["index"]
        xu100 = set(tiers.index[tiers.isin({"XU030", "XU050", "XU100"})])
        xu030 = set(tiers.index[tiers == "XU030"])
        # Review dates are published before final memberships; preserve broad
        # listing snapshots but skip an index snapshot unless its set is valid.
        if len(xu100) >= INDEXES["XU100"]["minimum"]:
            snapshots["XU100"][date] = xu100
            snapshots["XU030"][date] = xu030
            snapshots["XTUMY"][date] = market - xu100
        snapshots["XUTUM"][date] = market
    if not snapshots["XUTUM"] or not snapshots["XU100"]:
        raise ValueError("Historical BIST membership archive did not contain usable snapshots")
    if not snapshots["XU030"] or not snapshots["XTUMY"]:
        raise ValueError("Historical membership archive is incomplete for XU030/XTUMY")
    return snapshots


def apply_current_members(
    history: dict[str, dict[pd.Timestamp, set[str]]],
    current: dict[str, set[str]],
    fetched_at: str,
) -> tuple[dict[str, dict[pd.Timestamp, set[str]]], pd.Timestamp]:
    fetched_day = pd.Timestamp(fetched_at[:10])
    # BIST reviews take effect at quarter boundaries. The current live component
    # file reflects the review in force during the current quarter.
    month = ((fetched_day.month - 1) // 3) * 3 + 1
    effective_date = pd.Timestamp(year=fetched_day.year, month=month, day=1)
    for code, members in current.items():
        history[code][effective_date] = set(members)
    return history, effective_date


def download_prices(symbols: list[str]) -> dict[str, pd.DataFrame]:
    result: dict[str, pd.DataFrame] = {}
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


def download_financial_prices(symbols: list[str]) -> dict[str, list[dict]]:
    raw = yf.download(
        [f"{symbol}.IS" for symbol in symbols],
        period=PERIOD,
        interval="1d",
        auto_adjust=False,
        actions=False,
        progress=False,
        threads=True,
        group_by="ticker",
        timeout=45,
    )
    result: dict[str, list[dict]] = {}
    for symbol in symbols:
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
        if "close" not in data.columns:
            continue
        close = pd.to_numeric(data["close"], errors="coerce").dropna()
        if close.empty:
            continue
        close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
        close = close[~close.index.duplicated(keep="last")]
        result[symbol] = [
            {"time": date.strftime("%Y-%m-%d"), "close": round(float(value), 6)}
            for date, value in close.items() if float(value) > 0
        ]
    return result


def add_broad_universe_ipo_dates(
    history: dict[pd.Timestamp, set[str]],
    prices: dict[str, pd.DataFrame],
) -> dict[pd.Timestamp, set[str]]:
    """Move newly observed all-share listings to their first available quote date."""
    dates = sorted(history)
    if len(dates) < 2:
        return history
    additions: dict[pd.Timestamp, set[str]] = {}
    for prior_date, review_date in zip(dates, dates[1:]):
        new_tickers = history[review_date] - history[prior_date]
        for ticker in new_tickers:
            ticker_prices = prices.get(ticker)
            if ticker_prices is None or ticker_prices.empty:
                continue
            first_quote = ticker_prices.index.min()
            if prior_date < first_quote <= review_date:
                additions.setdefault(first_quote, set()).add(ticker)
    # The latest quarterly review can be only partially represented in the
    # archive. Existing price series identify current-quarter first quotes.
    last_review = dates[-1]
    for ticker in history[last_review]:
        ticker_prices = prices.get(ticker)
        if ticker_prices is None or ticker_prices.empty:
            continue
        first_quote = ticker_prices.index.min()
        if last_review < first_quote:
            additions.setdefault(first_quote, set()).add(ticker)

    # An IPO date is an additive membership event, not a replacement
    # snapshot. Carry the active basket forward and add the new listings.
    for date, tickers in sorted(additions.items()):
        if date in history:
            history[date].update(tickers)
            continue
        prior_dates = [snapshot_date for snapshot_date in history if snapshot_date < date]
        active = set(history[max(prior_dates)]) if prior_dates else set()
        history[date] = active | tickers
    return dict(sorted(history.items()))


def build_candles(
    history: dict[pd.Timestamp, set[str]],
    prices: dict[str, pd.DataFrame],
    minimum: int,
) -> list[dict]:
    sessions = sorted(set().union(*(set(data.index) for data in prices.values())))
    if not sessions:
        raise ValueError("Yahoo Finance returned no usable daily OHLC")
    review_dates = sorted(history)
    review_pos = 0
    current_members: set[str] = set()
    last_close: dict[str, float] = {}
    candles: list[dict] = []
    index_close: float | None = None
    for date in sessions:
        while review_pos < len(review_dates) and review_dates[review_pos] <= date:
            current_members = set(history[review_dates[review_pos]])
            review_pos += 1
        if not current_members:
            continue
        rows = []
        for ticker in current_members:
            data = prices.get(ticker)
            if data is None or date not in data.index:
                continue
            bar = data.loc[date]
            previous = last_close.get(ticker)
            if previous is None:
                # A newly listed stock has no previous close. Anchor its first
                # day at the open; intraday movement is included from there.
                denominator = float(bar["open"])
                factors = {
                    field: float(bar[field]) / denominator
                    for field in ("open", "high", "low", "close")
                }
            else:
                factors = {
                    field: float(bar[field]) / previous
                    for field in ("open", "high", "low", "close")
                }
            factors["high"] = max(factors["high"], factors["open"], factors["close"])
            factors["low"] = min(factors["low"], factors["open"], factors["close"])
            rows.append(factors)
        # Track every available quote, including symbols outside the current
        # basket. If a ticker joins or rejoins at a review, its return starts
        # from the immediately preceding session rather than a stale old close.
        for ticker, data in prices.items():
            if date in data.index:
                last_close[ticker] = float(data.loc[date, "close"])
        if len(rows) < minimum:
            continue
        factors = pd.DataFrame(rows).mean(axis=0)
        if index_close is None:
            candle = {field: BASE_VALUE for field in ("open", "high", "low", "close")}
            index_close = BASE_VALUE
        else:
            candle = {
                field: round(index_close * float(factors[field]), 6)
                for field in ("open", "high", "low", "close")
            }
            candle["high"] = max(candle["high"], candle["open"], candle["close"])
            candle["low"] = min(candle["low"], candle["open"], candle["close"])
            index_close = candle["close"]
        candles.append({
            "time": date.strftime("%Y-%m-%d"),
            **candle,
            "constituent_count": len(rows),
            "universe_count": len(current_members),
        })
    if len(candles) < 2:
        raise ValueError("Insufficient history/price coverage to build index candles")
    return candles


def main() -> None:
    current, fetched_at = load_current_members()
    history = load_historical_members()
    history, current_review_date = apply_current_members(history, current, fetched_at)

    all_symbols = sorted(set().union(
        *[set(members) for dates in history.values() for members in dates.values()]
    ))
    prices = download_prices(all_symbols)
    # IPO dates refine broad-market membership between review snapshots.
    for code in ("XTUMY", "XUTUM"):
        history[code] = add_broad_universe_ipo_dates(history[code], prices)
    financial_prices = download_financial_prices(FINANCIAL_TICKERS)
    for ticker in FINANCIAL_TICKERS:
        print(f"{ticker}: {len(financial_prices.get(ticker, []))} daily closes")

    payload = {
        "updated_at": fetched_at,
        "price_source": "Yahoo Finance (yfinance), auto-adjusted daily OHLC",
        "membership_source": "Borsa İstanbul review files (historical archive) + live BIST components",
        "method": (
            "Point-in-time membership by historical review snapshot; daily equal-weight "
            "rebalanced synthetic OHLC, base 1000. XTUMY = BIST All Shares less BIST 100."
        ),
        "membership_cadence": "Historical membership archive is quarterly; broad-market IPO entries use first available quote date.",
        "indexes": {},
    }
    for code, config in INDEXES.items():
        candles = build_candles(history[code], prices, config["minimum"])
        payload["indexes"][code] = {
            **config,
            "code": code,
            "constituent_count": len(current[code]),
            "membership_as_of": fetched_at[:10],
            "history_starts": candles[0]["time"],
            "history_start_blockers": [],
            "membership_method": "point-in-time",
            "history_membership_snapshots": len(history[code]),
            "candles": candles,
        }
        print(
            f"{code}: {len(current[code])} current members, "
            f"{len(candles)} candles from {candles[0]['time']}"
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    FINANCIAL_PRICE_OUTPUT.write_text(json.dumps({
        "updated_at": fetched_at,
        "price_source": "Yahoo Finance split-adjusted close; dividends not adjusted",
        "daily_prices": financial_prices,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} and {FINANCIAL_PRICE_OUTPUT}")


if __name__ == "__main__":
    main()
