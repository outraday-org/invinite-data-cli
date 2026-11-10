---
description: Compare the financial performance, valuation, growth, and risks of two or more companies.
argument-hint: <tickers or company names> [focus]
---

# Compare Companies

Compare the companies in `$ARGUMENTS` using Invinite Data (MCP `search_companies`, `get_company`, `get_financials`, `get_metrics`, or the `invd` commands below with `--json`; the MCP server also offers the `compare_companies` prompt).

1. Resolve ambiguous company names with `search_companies` or `invd companies list -q "<name>" --json`.
2. Fetch the metric definitions before reading financial metrics: `invd catalog metrics --json`.
3. Fetch, for all companies in one call each: company details (`invd companies get AAPL --json`), the latest annual standardized snapshot (`invd financials AAPL MSFT --fiscal-year 2025 --json`), profitability and valuation ratios (`invd metrics ratios AAPL MSFT -p annual --category profitability,valuation --json`) and five-year CAGR (`invd metrics cagr AAPL MSFT -p annual --horizon 5 --json`) where available.
4. Run independent reads in parallel when the active Claude surface supports it.
5. Present a compact comparison table followed by the most material strengths, weaknesses, and data limitations.
6. Cite the reporting periods used; do not mix annual and quarterly values without labeling them, and note when companies' fiscal years end in different months.
