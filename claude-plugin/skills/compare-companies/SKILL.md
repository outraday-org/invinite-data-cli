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
     kind=segments` (Standard) when the business mix matters. Use `segment_id=seg_operating_income_business_segment`
     for operating income or `segment_id=seg_total_assets_business_segment` for assets; `metric` still filters the
     standardized metric id. The catalog lists all 12 segment categories.
4. **Present one table**: revenue, revenue growth, operating margin, net margin, free cash flow, net debt (and the
   valuation ratios when asked), one column per company, units and fiscal period in the headers.
5. **Then three to five sentences** on what separates them: the material strengths, weaknesses and the data's limits.

Rules:

- Fiscal years end in different months: label each company's period end and say when the years do not line up.
- Never mix annual and quarterly values without labelling them; use the same `period` for every company.
- A growth value is a fraction (0.12 = 12 %).
- Name the period and as-of date of every number, and any company whose data is missing or still pending.

- Compare each segment row's `currency`, not the catalog's nominal unit. New non-revenue measures (operating income,
  D&A, assets, goodwill, capex) exist only on the business axis; do not equate different filers' segment definitions.
- Assets/goodwill are period-end balances without TTM/YTD. Keep filed annual/quarterly values and their dates;
  do not sum quarters or invent a missing fiscal-Q4 row.
- `detailed=true` (Pro) exposes `member_role`, `reconciles_to_total` and predecessor/successor proof. Keep reconciling
  members apart and do not sum a measure whose reconciliation is false; Standard does not establish reconciliation.
- `follow_links=true` retains originals and adds one-hop proved rename/merge history, marked `via_link=true`.
  Preserve all merge components separately; never collapse equal-period rows into an implicit total. Splits are
  listed in detailed evidence but never followed. Stored per-filing vintage coverage limits how far proof reaches.
- In follow mode, key rows by `source_row_id` plus target dimensions. `source_member` retains the original member;
  the ID is a derived segmented row, not a raw SEC fact. Both identity fields are absent when following is off.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
