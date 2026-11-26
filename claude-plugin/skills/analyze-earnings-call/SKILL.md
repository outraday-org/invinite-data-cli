---
name: analyze-earnings-call
description: Use when the user asks about a company's earnings call that already happened — how the quarter went, what management guided, what analysts pushed on, how the tone changed from the previous call — for the latest call or a named fiscal quarter, with timestamped evidence.
---

# Analyze an earnings call

## 1. Find the call

- Latest call: `get_event company=AAPL` (it resolves the latest held call itself).
- A named quarter: `get_event company=AAPL fiscal_year=2026 fiscal_quarter=3`.
- Keep the `event_id` for every later call. If `has_transcript` is false, say there is no transcript yet and stop.

## 2. Read the parts

One `get_event event_id=<…>` call with the parts the question needs (each is billed separately; Q&A, comparison,
stats and KPIs need Pro):

- `press_release` — the reported figures.
- `guidance` — each item with `direction` (`raised`, `lowered`, `maintained`, `withdrawn`, `new`), period and basis.
- `qa` — the analyst questions and the answers; `participants` for names and firms.
- `comparison` — this call against the company's previous call: tone shift, hedging and uncertainty, new and
  dropped topics.
- `stats` — talk time and Q&A length.
- Optional: `kpis` (KPI mentions with their sentence), `price_attribution` (minute price moves next to what was said),
  `documents` (CFO commentary, shareholder letter) when the event `has_documents`.

Take the exact wording only where a claim needs it: `search_transcripts event_id=<…> q="<words>"` (`mode=literal` for
an exact figure or term; 10 credits) before the full transcript (`include=["transcript_turns"]`, 5 credits).
For a check against reported numbers: `get_financials company=AAPL period=quarterly limit=2`.

Adjusted figures and operating KPIs come from the results release itself (Pro, 1 credit each):

- `call_api path=/v1/non-gaap query={event: "<event_id>"}` — adjusted EPS, adjusted EBITDA, free cash flow and the
  other non-GAAP figures as printed, each with the GAAP figure it starts from and the adjustment lines. A row with
  `reconciled: false` does not add up and is shown as printed: say so instead of correcting it.
- `call_api path=/v1/kpi-series query={company: "AAPL", kpi: "<key>"}` — one operating KPI across periods (an airline's
  load factor, a bank's net interest margin); the keys of a sector are in `invinite://catalog/kpis`. `yoy_change` is
  points for a percent KPI, percent otherwise.

## 3. Write the analysis

- **Results vs guidance**: the reported figures against the guidance given on the prior call (one metric's guidance
  across calls: `call_api path=/v1/guidance query={company: "AAPL", metric: "revenue"}`).
- **Guidance changes**: each item raised, lowered, maintained, new or withdrawn, with its period and GAAP / non-GAAP
  basis. Guidance without a number (a statement such as "we expect margins to expand") carries `statement_text` and
  its `qualifier`; quote it, and do not compute a change for it (`change_vs_prior` is null).
- **Adjusted results** (if fetched): the non-GAAP figures with their reconciliation, and the KPI series against the
  same quarter a year earlier.
- **Analyst focus**: the three main themes of the Q&A, who asked (name and firm), and where management did not
  answer directly.
- **Tone change**: what the comparison shows against the previous call.
- **Price moves during the call** (only if fetched): the largest minutes and what was being said. Word it as
  coincidence in time, never as the cause; pre-market bars are sparse.

## 4. Evidence

- Every quote or claim from the call carries the speaker and its `[m:ss]` timestamp (from `start_ms`).
- A passage from a company document carries its title, year and page and is described as the company's statement.
- Separate what was said from your interpretation; cite the event id.
- Flag what is missing (no press release, no guidance extracted, no comparison yet) instead of inferring it.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
