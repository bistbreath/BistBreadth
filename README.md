# BIST Equal-Weight Charts

GitHub Pages interface for daily equal-weight synthetic charts of:

- BIST 100 (XU100)
- BIST 30 (XU030)
- BIST Tüm-100 (XTUMY)
- BIST Tüm / all shares (XUTUM)

## Data pipeline

GitHub Actions downloads the live constituent list from Borsa İstanbul, historical membership review snapshots, and adjusted daily OHLC prices through Yahoo Finance using yfinance. It recalculates the four series with a 1,000 starting value and daily equal weighting, then commits the outputs to `docs/data/indices.json`, `docs/data/financial_prices.json`, and `docs/data/rs_ratings.json`. The workflow runs on weekdays after the BIST session and can also be started manually from Actions → Refresh BIST equal-weight charts → Run workflow.

To run it locally with Python 3.10+:

```bash
pip install -r requirements.txt
python scripts/build_indices.py
python -m http.server 8000
```

Open `http://localhost:8000/docs/`.

## Calculation and limitations

For each session, each constituent's OHLC is divided by its previous close; the arithmetic mean of those ratios is applied to the synthetic series' previous close. Weights reset to equal at each daily close. Prices are adjusted by the data provider.

The historical baskets use dated quarterly BIST membership snapshots rather than replaying today's constituents over the full history. Current live membership replaces the snapshot for the current quarter. XTUMY is calculated as BIST All Shares less BIST 100, consistent with the published index definition. New shares in the broad-market baskets are admitted on their first available Yahoo Finance quote after their preceding review date.

Membership records are quarterly, not daily. IPO admission dates use the first quote available from the price provider as a proxy, and prices may be missing on individual sessions. The chart therefore shows each candle's available quote count beside the point-in-time universe size. Historical coverage does not guarantee complete records for every listing/delisting or every BIST membership change, so these synthetic series are not official BIST index performance. Synthetic highs and lows average individual price extremes that may not have occurred at the same time.

Borsa İstanbul provides the live component list and index methodology. The historical membership snapshots are archived from BIST review workbooks at [GocmenCo/bist-constituents](https://github.com/GocmenCo/bist-constituents). Yahoo Finance/yfinance is a third-party price source; availability, delay, and redistribution rights depend on its terms. The site is for research, not investment advice, and is not affiliated with Borsa İstanbul.

## Site files

- `docs/`: GitHub Pages site
- `scripts/build_indices.py`: membership download, price retrieval, and chart calculations
- `.github/workflows/refresh-index-data.yml`: scheduled data refresh
