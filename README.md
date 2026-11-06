# BIST Equal-Weight Charts

GitHub Pages interface for daily equal-weight synthetic charts of:
- BIST 100 (XU100)
- BIST 30 (XU030)
- BIST Tüm-100 (XTUMY)
- BIST Tüm / all shares (XUTUM)

## Data pipeline

The GitHub Actions workflow downloads the current constituent lists from Borsa İstanbul's public components CSV and daily adjusted OHLC prices through Yahoo Finance using yfinance. It recalculates the four series with a 1,000 starting value and daily equal weighting, then commits the output to `docs/data/indices.json`. The workflow runs on weekdays after the BIST session and can also be started manually from Actions → Refresh BIST equal-weight charts → Run workflow.

To run it locally with Python 3.10+:

```bash
pip install -r requirements.txt
python scripts/build_indices.py
python -m http.server 8000
```

Open `http://localhost:8000/docs/`.

## Calculation and limitations

For each session, each constituent's OHLC is divided by its previous close; the arithmetic mean of those ratios is applied to the synthetic series' previous close. Weights reset to equal at each daily close. Prices are adjusted by the data provider.

The component snapshot is current membership. The builder replays that current list across available price history, up to five years. It does not reconstruct historical membership changes, so the chart is not survivorship-bias-free and must not be treated as official index performance. Newer listings shorten the common history available for a basket. The synthetic high and low are averages of individual price extremes; those extremes may not have occurred at the same time.

Borsa İstanbul provides the constituent source. Yahoo Finance/yfinance is a third-party price source; availability, delay, and redistribution rights depend on its terms. The site is for research, not investment advice, and is not affiliated with Borsa İstanbul.

## Site files

- `docs/`: GitHub Pages site
- `scripts/build_indices.py`: constituent download, price retrieval, and chart calculations
- `.github/workflows/refresh-index-data.yml`: scheduled data refresh
