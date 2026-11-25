---
name: compare-companies
description: Use when the user wants two or more companies side by side — "compare AAPL, MSFT and GOOGL", "who has better margins", "which is growing faster", peer or competitor comparisons on growth, profitability, cash flow, balance sheet or valuation.
---

# Compare companies

1. **Resolve** every name or uncertain ticker with `search_instruments`. Only stocks have statements: if one of them
   is a fund, say so and compare it separately (`get_fund`).
2. **Read the metric catalog** (`invinite://catalog/metrics`) before choosing metric ids.
3. **Fetch, all companies in one call each** (run them in parallel when your host allows):
   - the snapshot: `get_financials company=AAPL,MSFT,GOOGL fiscal_year=2025` (or `limit=1` for each company's latest
     annual period);
   - margins and returns: `get_metrics company=AAPL,MSFT,GOOGL kind=ratios category=profitability,valuation`;
   - growth: `get_metrics company=AAPL,MSFT,GOOGL kind=growth`, and `kind=cagr horizon=5` for the longer trend;
   - optional: `get_company company=AAPL` (one company per call) for sector and description, `get_metrics
     kind=segments` (Standard) when the business mix matters.
4. **Present one table**: revenue, revenue growth, operating margin, net margin, free cash flow, net debt (and the
   valuation ratios when asked), one column per company, units and fiscal period in the headers.
5. **Then three to five sentences** on what separates them: the material strengths, weaknesses and the data's limits.

Rules:

- Fiscal years end in different months: label each company's period end and say when the years do not line up.
- Never mix annual and quarterly values without labelling them; use the same `period` for every company.
- A growth value is a fraction (0.12 = 12 %).
- Name the period and as-of date of every number, and any company whose data is missing or still pending.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
