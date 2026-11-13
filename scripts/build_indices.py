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
RS_RATING_OUTPUT = ROOT / "docs" / "data" / "rs_ratings.json"
MEMBERS_URL = "https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv"
HISTORICAL_MEMBERS_URL = (
    "https://raw.githubusercontent.com/GocmenCo/bist-constituents/master/"
    "data/bist_constituents.csv"
)
BASE_VALUE = 1000.0
PERIOD = "5y"
SECTOR_INDEXES = [
    ("XBANK", "Bankacılık"), ("XSGRT", "Sigorta"), ("XGMYO", "Gayrimenkul Yatırım Ortaklığı"),
    ("XHOLD", "Holding ve Yatırım"), ("XBLSM", "Bilişim"), ("XGIDA", "Gıda ve İçecek"),
    ("XULAS", "Ulaştırma"), ("XTRZM", "Turizm"), ("XELKT", "Elektrik"),
    ("XMADN", "Madencilik"), ("XKMYA", "Kimya, Petrol ve Plastik"),
    ("XTEKS", "Tekstil ve Deri"), ("XILTM", "İletişim"),
    ("XUSIN", "Sınai"), ("XUHIZ", "Hizmetler"), ("XUMAL", "Mali"),
]
INDEXES = {
    "XU100": {"name": "BIST 100 Eşit Ağırlık", "short_name": "BIST 100", "color": "#75adf5", "minimum": 50},
    "XU030": {"name": "BIST 30 Eşit Ağırlık", "short_name": "BIST 30", "color": "#42c7a5", "minimum": 20},
    "XTUMY": {"name": "BIST Tüm-100 Eşit Ağırlık", "short_name": "XTUMY", "color": "#d69cff", "minimum": 50},
    "XUTUM": {"name": "BIST Tüm Eşit Ağırlık", "short_name": "Tüm BIST", "color": "#ffb86b", "minimum": 100},
}


def load_current_members() -> tuple[dict[str, set[str]], str, dict[str, str]]:
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
    sectors: dict[str, str] = {}
    for index_code, label in SECTOR_INDEXES:
        for ticker in frame.loc[frame.index_code == index_code, "ticker"]:
            sectors.setdefault(ticker, label)
    return current, datetime.now(timezone.utc).isoformat(), sectors


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


def build_rs_ratings(
    prices: dict[str, pd.DataFrame],
    universe: set[str],
    sectors: dict[str, str],
    updated_at: str,
) -> dict:
    """Rank current XUTUM shares and sectors by 1/3/6-month relative strength vs XU100."""
    benchmark = prices.get("XU100")
    if benchmark is None or benchmark.empty or "close" not in benchmark:
        raise ValueError("Yahoo Finance returned no XU100 benchmark prices")
    benchmark_close = pd.to_numeric(benchmark["close"], errors="coerce").dropna()
    if benchmark_close.empty:
        raise ValueError("XU100 benchmark has no usable closing prices")
    as_of = benchmark_close.index.max()
    periods = {"1m": 1, "3m": 3, "6m": 6}
    period_values: dict[str, dict[str, float]] = {period: {} for period in periods}
    sector_values: dict[str, dict[str, float]] = {period: {} for period in periods}

    for period, months in periods.items():
        cutoff = as_of - pd.DateOffset(months=months)
        benchmark_start = benchmark_close.loc[benchmark_close.index <= cutoff]
        benchmark_end = benchmark_close.loc[benchmark_close.index <= as_of]
        if benchmark_start.empty or benchmark_end.empty:
            continue
        b_start_date, b_start = benchmark_start.index[-1], float(benchmark_start.iloc[-1])
        b_end_date, b_end = benchmark_end.index[-1], float(benchmark_end.iloc[-1])
        if (cutoff - b_start_date).days > 10 or (as_of - b_end_date).days > 7 or b_start <= 0:
            continue
        benchmark_return = b_end / b_start
        for ticker in universe:
            data = prices.get(ticker)
            if data is None or data.empty or "close" not in data:
                continue
            close = pd.to_numeric(data["close"], errors="coerce").dropna()
            start = close.loc[close.index <= cutoff]
            end = close.loc[close.index <= as_of]
            if start.empty or end.empty or (cutoff - start.index[-1]).days > 10 or (as_of - end.index[-1]).days > 7:
                continue
            start_value, end_value = float(start.iloc[-1]), float(end.iloc[-1])
            value = (end_value / start_value / benchmark_return - 1) * 100 if start_value > 0 else None
            if value is not None:
                period_values[period][ticker] = value

        grouped: dict[str, list[float]] = {}
        for ticker, relative_return in period_values[period].items():
            sector = sectors.get(ticker)
            if sector and sector != "—":
                grouped.setdefault(sector, []).append(relative_return)
        sector_values[period] = {
            sector: sum(values) / len(values)
            for sector, values in grouped.items() if values
        }

    ratings: dict[str, dict[str, int | None]] = {ticker: {} for ticker in universe}
    for period in periods:
        values = period_values[period]
        count = len(values)
        if count == 1:
            ratings[next(iter(values))][period] = 50
        elif count > 1:
            ranks = pd.Series(values).rank(method="average", ascending=True)
            for ticker, rank in ranks.items():
                ratings[ticker][period] = int(round((float(rank) - 1) / (count - 1) * 100))
        for ticker in universe:
            ratings[ticker].setdefault(period, None)

    sector_names = sorted({sectors.get(ticker) for ticker in universe if sectors.get(ticker) and sectors.get(ticker) != "—"})
    sector_ratings: dict[str, dict[str, int | None]] = {sector: {} for sector in sector_names}
    for period in periods:
        values = sector_values[period]
        count = len(values)
        if count == 1:
            sector_ratings[next(iter(values))][period] = 50
        elif count > 1:
            ranks = pd.Series(values).rank(method="average", ascending=True)
            for sector, rank in ranks.items():
                sector_ratings[sector][period] = int(round((float(rank) - 1) / (count - 1) * 100))
        for sector in sector_names:
            sector_ratings[sector].setdefault(period, None)

    rows = [
        {"ticker": ticker, "sector": sectors.get(ticker, "—"), "ratings": ratings[ticker]}
        for ticker in sorted(universe)
    ]
    sector_rows = [
        {"sector": sector, "ratings": sector_ratings[sector]}
        for sector in sector_names
    ]
    return {
        "updated_at": updated_at,
        "as_of": as_of.strftime("%Y-%m-%d"),
        "benchmark": "XU100",
        "universe": "XUTUM",
        "method": "Hisse ve sektör RS değerleri XU100'e göre göreli performans üzerinden hesaplanır. Sektör getirisi, sınıflandırılmış güncel XUTUM hisselerinin eşit ağırlıklı ortalamasıdır.",
        "rows": rows,
        "sector_rows": sector_rows,
    }


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


def build_follow_through(
    history: dict[pd.Timestamp, set[str]],
    prices: dict[str, pd.DataFrame],
    minimum_coverage: int,
    threshold_pct: float = 4.0,
) -> dict | None:
    """Track the next session's close for constituents up at least 4% yesterday."""
    benchmark = prices.get("XU100")
    if benchmark is None or benchmark.empty:
        return None
    sessions = sorted(benchmark.index)
    if len(sessions) < 3:
        return None
    reference_date, mover_date, follow_date = sessions[-3:]
    active_members: set[str] = set()
    for snapshot_date in sorted(history):
        if snapshot_date > mover_date:
            break
        active_members = set(history[snapshot_date])
    if not active_members:
        return None

    following = below = awaiting = 0
    candidates = priced_members = 0
    for ticker in active_members:
        ticker_prices = prices.get(ticker)
        if ticker_prices is None or reference_date not in ticker_prices.index or mover_date not in ticker_prices.index:
            continue
        priced_members += 1
        prior_close = float(ticker_prices.loc[reference_date, "close"])
        mover_close = float(ticker_prices.loc[mover_date, "close"])
        if prior_close <= 0 or mover_close < prior_close * (1 + threshold_pct / 100):
            continue
        candidates += 1
        if follow_date not in ticker_prices.index:
            awaiting += 1
        elif float(ticker_prices.loc[follow_date, "close"]) >= mover_close:
            following += 1
        else:
            below += 1

    resolved = following + below
    sufficient_coverage = priced_members >= minimum_coverage
    status = (
        "insufficient_coverage" if not sufficient_coverage
        else "no_movers" if candidates == 0
        else "ready"
    )
    return {
        "reference_date": reference_date.strftime("%Y-%m-%d"),
        "mover_date": mover_date.strftime("%Y-%m-%d"),
        "follow_through_date": follow_date.strftime("%Y-%m-%d"),
        "threshold_pct": threshold_pct,
        "status": status,
        "member_count": len(active_members),
        "priced_member_count": priced_members,
        "candidate_count": candidates,
        "following_through_count": following,
        "below_count": below,
        "awaiting_count": awaiting,
        "rate_percent": round(following / resolved * 100, 4) if resolved and sufficient_coverage else None,
        "rate_denominator": resolved,
    }


def main() -> None:
    current, fetched_at, sectors = load_current_members()
    history = load_historical_members()
    history, current_review_date = apply_current_members(history, current, fetched_at)

    all_symbols = sorted(set().union(
        *[set(members) for dates in history.values() for members in dates.values()]
    ) | {"XU100"})
    prices = download_prices(all_symbols)
    # IPO dates refine broad-market membership between review snapshots.
    for code in ("XTUMY", "XUTUM"):
        history[code] = add_broad_universe_ipo_dates(history[code], prices)
    rs_ratings = build_rs_ratings(prices, current["XUTUM"], sectors, fetched_at)
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
        follow_through = build_follow_through(history[code], prices, config["minimum"])
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
            "follow_through": follow_through,
        }
        print(
            f"{code}: {len(current[code])} current members, "
            f"{len(candles)} candles from {candles[0]['time']}"
        )

    # Keep published index/RS files when Yahoo returns an older benchmark close.
    write_indexes = True
    if OUTPUT.exists():
        published = json.loads(OUTPUT.read_text(encoding="utf-8"))
        for code in INDEXES:
            published_candles = published.get("indexes", {}).get(code, {}).get("candles", [])
            new_candles = payload["indexes"][code]["candles"]
            published_latest = published_candles[-1]["time"] if published_candles else ""
            new_latest = new_candles[-1]["time"] if new_candles else ""
            if published_latest and new_latest < published_latest:
                print(
                    f"Keeping published {code} chart: latest provider candle {new_latest} "
                    f"is older than published {published_latest}"
                )
                write_indexes = False
                break

    if write_indexes and OUTPUT.exists():
        published = json.loads(OUTPUT.read_text(encoding="utf-8"))
        compared_keys = ("indexes", "price_source", "membership_source", "method", "membership_cadence")
        if all(published.get(key) == payload.get(key) for key in compared_keys):
            print("Keeping published index data: prices and memberships are unchanged")
            write_indexes = False

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if write_indexes:
        OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    if RS_RATING_OUTPUT.exists():
        published_rs = json.loads(RS_RATING_OUTPUT.read_text(encoding="utf-8"))
        if published_rs.get("as_of", "") > rs_ratings.get("as_of", ""):
            sector_as_of = rs_ratings.get("as_of", "")
            print(
                f"Keeping published stock RS ratings as of {published_rs['as_of']}; "
                f"sector ratings use provider data as of {sector_as_of}"
            )
            rs_ratings["rows"] = published_rs.get("rows", [])
            rs_ratings["as_of"] = published_rs["as_of"]
            rs_ratings["sector_as_of"] = sector_as_of
        else:
            rs_ratings["sector_as_of"] = rs_ratings.get("as_of", "")
    else:
        rs_ratings["sector_as_of"] = rs_ratings.get("as_of", "")
    write_rs = True
    if RS_RATING_OUTPUT.exists():
        published_rs = json.loads(RS_RATING_OUTPUT.read_text(encoding="utf-8"))
        published_values = {key: value for key, value in published_rs.items() if key != "updated_at"}
        calculated_values = {key: value for key, value in rs_ratings.items() if key != "updated_at"}
        if published_values == calculated_values:
            rs_ratings["updated_at"] = published_rs.get("updated_at", rs_ratings["updated_at"])
            print("Keeping published RS ratings: scores and dates are unchanged")
            write_rs = False
    if write_rs:
        RS_RATING_OUTPUT.write_text(json.dumps(rs_ratings, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {RS_RATING_OUTPUT}" + (f", {OUTPUT}" if write_indexes else ""))


if __name__ == "__main__":
    main()
