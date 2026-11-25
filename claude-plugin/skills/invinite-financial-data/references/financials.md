# Financial statements, metrics and lineage

Read this when the question is about a company's reported numbers: statements, margins, growth, segments, where a
number comes from, or how it changed since it was first filed. Companies only: a fund has no statements.

## Statements: `get_financials`

- `company`: one ticker or CIK, or a comma list of up to 50. A list plus one `fiscal_year` (and `fiscal_quarter`) is a
  cross-company snapshot: one call for the whole comparison.
- `statement`: `income-statement`, `balance-sheet`, `cash-flow`, or `all` (default).
- `period`: `annual` (default), `quarterly`, `ytd` or `ttm`. The default stays `annual` when you pass
  `fiscal_quarter`: for one quarter send `period=quarterly fiscal_year=2025 fiscal_quarter=3`.
- Range: `fiscal_year_from` / `fiscal_year_to`; otherwise `limit` periods (default 4), newest first.
- `basis=standardized` (default): values keyed by metric ids that mean the same for every company
  (`is_total_revenue`, `is_net_income`). Read `invinite://catalog/metrics` before choosing or explaining an id.
- `basis=as_reported`: the company's own XBRL concepts and line labels, as filed. `reported_only=true` drops the
  values Invinite derived (a Q4 computed from the year, for example).
- `view=summary` (default, Lite) is the table; `view=detailed` (Pro) adds per value its `fact_id`, formula and
  accession; `view=presentation` (Pro) is the statement tree as the company presents it.
- Point in time: `as_of=YYYY-MM-DD` returns the newest rendering filed on or before that day (what an investor could
  have known); `filing=<accession>` returns exactly that filing's rendering.
- A row whose `source.is_preliminary` is true comes from a preliminary source (the earnings release before the 10-Q or
  10-K): say so when you quote it.
- Only some metrics: the tool has no metric filter. Use `call_api` `path=/v1/financials/standardized`
  `query={company: "AAPL", period: "annual", metrics: "is_total_revenue,is_net_income"}` (as-reported:
  `/v1/financials/as-reported` with XBRL concepts in `metrics`, and `display_sign: "cash_flow_direction"` to show cash
  outflows negative).

State the unit the table gives for each value. Per-share values follow later stock splits (the detailed as-reported view
also shows the value as filed and the `split_factor`). Never mix annual and quarterly values in one column without
labelling them.

## Derived metrics: `get_metrics`

- `kind=ratios` (Lite): `category` any of `profitability`, `liquidity`, `leverage`, `efficiency` (turnover and days
  ratios), `valuation`.
- `kind=growth` (Lite): `growth_basis` `yoy` (default) or `qoq`. Growth is a fraction: 0.12 means 12 %.
- `kind=cagr` (Lite): `horizon` 3, 5 or 10 years.
- `kind=segments` (Standard): revenue and other metrics by business or geographic segment; `metric` (a metric id),
  `axis` (an XBRL axis such as `srt:StatementGeographicalAxis`); `detailed=true` (Pro) adds lineage per value.
- `company` takes a comma list here too; `period`, `fiscal_year_from` / `fiscal_year_to` as for statements.

A ratio or growth value is computed by Invinite from the standardized facts; name it as such, and cite the
underlying statement values when a conclusion rests on one number.

## Where a number comes from: `explain_fact`

- Pass `fact_id` (from `get_financials view=detailed`, shape `{cik}|{metric_id}|{period}|{fiscal_year}|{fiscal_quarter}`)
  or `company` + `metric` + `period` + `fiscal_year` (+ `fiscal_quarter`, default 4).
- It returns the formula, the reported XBRL facts it is built from and their filings (Lite, 1 credit).
- `places=true` also locates the value in the filing document (block id, page, HTML tag; Pro, 1 more credit). Then
  `read_filing version_id=<…> blocks=<block>` shows the passage around it.

## How a number changed since it was first filed

- `get_financials basis=as_reported view=detailed` with the period: per value read `value`, `value_as_reported` and
  `split_factor` (a stock split after filing), and `original_value`, `original_label`, `original_filing_date`,
  `original_accession` (how it was first filed). No `original_*` fields means the value never changed.
- `filing=<original_accession>` shows the full first rendering; `as_of=<a date>` the state on any day in between.
- Every value one company ever filed for one XBRL concept and period, one row per filing (oldest first, `is_current`
  on the value in force): `call_api` `path=/v1/financials/vintages`
  `query={company: "AAPL", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", period_end: "2024-09-28"}`
  (Pro; name the concept exactly as the company files it, from `basis=as_reported`). Add `period_start` to pick one
  duration (a quarter, not the year to date ending the same day) and `member` for one segment's value.
- A filing's raw XBRL facts: `read_filing accession=<…> facts=numeric` (`tag=` narrows to concepts).

Name the reason of each change when the data shows it: a restatement (a later filing states another value), a
reclassification (the line moved), a stock split (`split_factor`), or a wording-only label change.
