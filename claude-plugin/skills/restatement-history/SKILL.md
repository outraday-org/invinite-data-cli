---
name: restatement-history
description: Use when the user wants to check a reported number — how revenue, EPS or another figure was first filed, whether it was later restated, reclassified or split-adjusted, what was known on a given date, or where exactly the value comes from.
---

# Restatement history of a number

Name the line(s) to check: the one the user gave, else revenue, net income and diluted EPS. Name the period: a fiscal
year (`period=annual`), or a quarter (`period=quarterly fiscal_quarter=…` — the default stays annual otherwise).

1. **How it is served today and how it was first filed**:
   `get_financials company=AAPL basis=as_reported view=detailed fiscal_year=2023 period=annual` (Pro). Per value read:
   - `value`, and `value_as_reported` with `split_factor` (a stock split after the filing);
   - `original_value`, `original_label`, `original_filing_date`, `original_accession`: how it was first filed;
   - `source.accession` and `source.restated`: the filing it is served from today.
   No `original_*` fields means the value never changed since its first filing.
2. **The first rendering in full**: the same call with `filing=<original_accession>`; the state on a day in between:
   `as_of=<date>`.
3. **Every filing that stated it** (one XBRL concept and period, oldest first, `is_current` on the value in force):
   `call_api path=/v1/financials/vintages query={company: "AAPL", concept:
   "RevenueFromContractWithCustomerExcludingAssessedTax", period_end: "2023-09-30"}` (Pro; the concept exactly as filed,
   from step 1). Add `period_start` for one quarter rather than the year to date, `member` for one segment.
4. **A standardized metric's lineage**: `explain_fact company=AAPL metric=is_total_revenue fiscal_year=2023` (formula
   and source facts); `places=true` locates it in the filing document (Pro, 1 more credit).

## Present it

One table: line | first filed (value, label, date, accession) | today (value, accession) | change and why.

- The reason, from the data: a **restatement** (a later filing states another value), a **reclassification** (the
  line moved or was regrouped), a **stock split** (`split_factor`), or a **label change** only.
- Cite the accessions; say which values were derived by Invinite rather than filed.
- If the account lacks Pro, say so: the detailed view, vintages and fact places need it.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
