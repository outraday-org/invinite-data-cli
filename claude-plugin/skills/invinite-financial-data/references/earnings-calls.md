# Earnings calls and investor documents

Read this when the question is about a company's calls: when the next one is, what was reported, guided or asked,
how the tone changed, or where something was said.

## The calendar: `list_events`

- Without `company` it lists the window today + 14 days (at most 92): "calls in the next two weeks" is one call with
  no arguments. `status=live` lists the calls in progress now.
- With `company` (comma list allowed): the company's calls; `from` / `to` (scheduled date), `fiscal_year` /
  `fiscal_quarter`, `sort=-scheduled_at` for the newest first, `status` `upcoming`, `live` or `ended`.
- `type` defaults to `earnings_call`; `all` adds investor days, conferences and AGMs
  (`invinite://catalog/event-types`). Every plan, 1 credit.
- Each event says `date_status` (`estimated`, `unconfirmed`, `confirmed`, `postponed`, `cancelled`): never present an
  estimated date as confirmed. A date-only event has no time of day: give its date only. `session` is `bmo` (before
  the open), `amc` (after the close) or `intraday`.
- `has_transcript` false means there is no transcript yet: say so instead of summarising the call.

## One call: `get_event`

- `company` alone = its latest held call; `company` + `fiscal_year` + `fiscal_quarter` = that quarter's call; or
  `event_id`. No `list_events` call is needed first. The event itself is on every plan (1 credit).
- The event names its filings: `results_filing` (the earnings 8-K / 6-K) and `periodic_report` (the 10-Q / 10-K,
  null until filed). Read one with `read_filing accession=<…>`.
- `include` adds parts; each is a separate billed operation at its own plan, so take only what the question needs:

| Part | What it is | Plan, credits |
|---|---|---|
| `press_release` | the results release | Lite, 1 |
| `guidance` | guidance items extracted from the call | Lite, 1 |
| `participants` | executives and analysts on the call | Lite, 1 |
| `news` | the call's news items | Lite, 1 |
| `qa` | each analyst question with the answer | Pro, 1 |
| `comparison` | this call vs the company's previous call: similarity, new and dropped topics, hedging and uncertainty changes | Pro, 1 |
| `stats` | talk time, Q&A length | Pro, 1 |
| `kpis` | KPI mentions with their source sentence | Pro, 1 |
| `transcript` | the plain text | Pro, 5 |
| `transcript_turns` | speaker turns with `start_ms` | Pro, 5 |
| `slides`, `audio` | the deck, the recording | Pro, 5 |
| `documents` | investor documents of the call | Pro, 1 |
| `prosody`, `price_attribution`, `transcript_versions` | voice features, minute price moves next to what was said, published versions | Pro, 1 |

Read from the cheapest to the most detailed: press release, guidance, Q&A and comparison usually answer; take the
transcript only when a claim needs the exact wording.

## Reading the parts

- Every `*_ms` field is milliseconds from the call's start: cite it as `[m:ss]` with the speaker. `qa_start_ms` is
  where the Q&A begins.
- Guidance items carry `direction` versus the prior call's guidance (`raised`, `lowered`, `maintained`, `withdrawn`,
  `new`), the period and the `basis` (`gaap`, `non_gaap`). Items may be machine-extracted and not yet reviewed:
  `call_api path=/v1/guidance query={company: "NVDA", review: "approved"}` keeps reviewed items only, and
  `query={company: "NVDA", metric: "revenue"}` gives one metric's guidance across calls. Guidance without a number
  keeps its statement (`statement_text`, `qualifier`: `directional`, `withdrawn`, `reaffirmed`, `range_unspecified`;
  `change_vs_prior` null); `qualitative: true` lists only those. `source_url` links the results release an item was
  read from (null for an item from the call only).
- Reported non-GAAP figures (Pro): `call_api path=/v1/non-gaap query={company: "NVDA", metric: "eps_adjusted_diluted"}`
  — each figure as printed in the results release with the GAAP figure it starts from, the adjustment lines and
  `reconciled` (the arithmetic check; `false` = served as printed although it does not add up). `source` names the
  release and the table cell.
- KPI time series (Pro): `call_api path=/v1/kpi-series query={company: "DAL", kpi: "load_factor"}` — one value per
  KPI, period and segment from the release tables first, then the release text, then the call (`origin`), with
  `xbrl_check` against the 10-Q / 10-K. A series exists where the company's sector catalog names the KPI:
  `invinite://catalog/kpis` (or `GET /v1/catalog/kpis?sector=airlines`).
- `price_attribution` lines up minute returns with what was being said: present it as temporal coincidence, never as
  the cause of a move. Pre-market bars are sparse.
- Investor documents (CFO commentary, shareholder letters, decks, annual reports) are company-published: quote them
  with title, year and page, as the company's statement, not as verified fact.
- A company's investor documents beyond one call (annual reports, investor-day decks):
  `call_api path=/v1/investor-documents query={company: "NVDA", kind: "presentation"}` (Pro); kinds in
  `invinite://catalog/document-kinds`.
- Two versions of a transcript: `call_api path=/v1/events/<event_id>/transcript-diff query={from: <version>, to: <version>}`
  (Pro, 5 credits).
- The people on a company's calls: `get_company include=["people"]`; one person or all analysts:
  `call_api path=/v1/people query={company: "NVDA", role: "analyst"}`. Call operators are left out of `/v1/people`
  unless `include_operators: true` (or `role: "operator"`); `/v1/participants?event=` still lists them as a call's
  speakers.

## Where something was said: `search_transcripts`

- One call searches every transcript (`scope=transcripts`, default) or investor document and slide
  (`scope=documents`, `kind=` from `invinite://catalog/document-kinds`). Each hit names its call (`event_id`, date),
  the speaker and the offsets, so no `list_events` call is needed first; omit dates to search every call.
- Narrow with `company`, `event_id`, `type` (`transcript`, `prepared`, `qa`, `presentation`), `from` / `to` (call
  date).
  `mode=literal` matches an exact figure, term or quote.
- Pro, 10 credits per call. A `Coverage: pending` note means no hits is not proof the topic was never mentioned.
