---
name: invinite-financial-data
description: The guide to the Invinite Data tools. Load it before answering any question with US company or fund data — financial statements, ratios and growth, SEC filings, earnings calls, holders and insider trades, news, US macro series — to pick the right tool, read periods, units and coverage correctly, and keep the credit cost down.
---

# Invinite financial data

You answer research questions with the Invinite Data MCP tools. They read one API, bill the user's Invinite Data
account per operation, and every result ends with a `Next:` line naming the useful follow-up call. This file is the
routing guide; read a file under `references/` when the question goes deep into its area.

## 1. Pin the subject first

- A ticker or name you are not certain of: `search_instruments` with `symbol=` (one exact ticker, active or delisted)
  or `q=` (ticker prefix or name). Use the symbol it returns. Lists (`q=`) show symbols listed today;
  `is_active=all` adds delisted ones. A delisted stock has no company profile.
- Each hit has a `type`: `stock`, `etf`, `closed_end_fund` or `etn`, and the data families served for it
  (`datasets`). A stock goes to `get_company`, `get_financials`, `get_metrics`, `list_events`, `get_insider_trades`.
  An ETF or closed-end fund goes to `get_fund`: a fund has no financial statements or insider trades. An ETN has a
  profile, dividends, splits and holders only. Trust `datasets` over a guess about what a ticker serves.
- An ETF of `structure` `exchange_traded_trust` (GLD, IBIT) files no holdings report: its holdings are refused by
  name.
- A filer without a listing (a 13F manager, a fund trust, a pre-IPO issuer): `search_instruments` `scope=filers`.
- An unknown ticker answers with the three closest matches; a wrong-type subject ("SPY is an ETF: financials exist
  only for companies") names the tool that serves it. Follow that text instead of retrying.

## 2. Pick the tool

| The user wants | Call |
|---|---|
| Statements (income, balance sheet, cash flow), several companies in one snapshot | `get_financials` |
| Ratios, growth, CAGR, segments | `get_metrics` |
| Where one number comes from | `explain_fact` |
| A company's, fund's or any filer's SEC filings, or every filer's newest ones / one filing's text | `list_filings` (no `symbol` = every filer, last 7 days), then `read_filing` |
| Which filings mention a topic | `search_filings` (100 credits: narrow it) |
| Profile, fiscal calendar, dividends, splits, people | `get_company` (`include=`) |
| A fund's profile, holdings, sector / country weights | `get_fund` |
| Who holds a stock or fund, 13F changes, a manager's portfolio | `get_holders` |
| Form 4 insider trades | `get_insider_trades` |
| Earnings-call calendar; one call's transcript, Q&A, guidance | `list_events`, `get_event` |
| What was said on calls / in investor documents | `search_transcripts` |
| Company news, newsroom announcements | `get_news` |
| Credits left, plan | `get_account` (free) |
| Alerts, webhooks, end users | `manage_alerts`, `manage_destinations`, `manage_alert_users` (load `alert-setup`) |
| Anything else (IPOs, market holidays, insider holdings, fact vintages, macro, people) | `search_endpoints`, then `call_api` |

Use the dedicated tool before `call_api`. `search_endpoints` is free and prints each operation's exact path, query
names and accepted values; `call_api` sends GET requests only, with those names (a date window is
`<field>.gte` / `<field>.lte`).

**US macro data** (CPI, PCE, GDP, payrolls, unemployment, jobless claims, Treasury yields): `call_api`
`path=/v1/macro/series` lists the series ids (every plan); then `/v1/macro/inflation`, `/v1/macro/gdp` or
`/v1/macro/labor` with `query={series: "cpi_all_sa"}` for a history, `/v1/macro/yield-curve` for daily curves, and
the `/snapshot` path of each family for the latest values. No company resolution is needed. Keep each value's
reference date, source and unit; a null tenor on the yield curve is no quote, not zero.

## 3. Periods and bases

- Companies report by **fiscal** period: a fiscal Q4 can end in the next calendar year, and fiscal years end in
  different months. Label every number with its fiscal period and period end date; say so when you compare companies
  with different year ends.
- `period` is `annual` (the default, also when you pass `fiscal_quarter`), `quarterly`, `ytd` or `ttm`. For one
  quarter pass `period=quarterly` with `fiscal_year` and `fiscal_quarter`.
- `basis=standardized` (default) gives comparable metric ids (`is_total_revenue`); `basis=as_reported` gives the
  company's own XBRL concepts and labels. Read the resource `invinite://catalog/metrics` before choosing a metric id
  or naming what an id means.
- Point in time: `as_of=YYYY-MM-DD` returns what was known that day; `filing=<accession>` exactly one filing's
  rendering.

## 4. Read the answer

- `response_format=concise` (default) is a table with units and period labels; `detailed` is the JSON with every id
  (fact ids, accessions, lineage). Ask for `detailed` only when you need an id the table does not show.
- Lists page by cursor: while `has_more` is true, pass `next_cursor` as `cursor` with every other argument unchanged.
  Stop paging once the question is answered.
- A text cut at `max_chars` says so; narrow the request or page instead of raising the limit by default.
- A `Coverage: pending` or `partial` line means the store is still filling: few or no rows are then not proof that
  something does not exist. Say the data is incomplete instead of "nothing found".
- An error carries the API's own detail and remedy. A plan refusal names the plan the operation needs: tell the user,
  do not try other tools to get around it.

## 5. Keep the cost down

- Every operation costs the credits its tool description states; most cost 1. `search_filings` costs 100 per call,
  `search_transcripts` 10, transcript / slides / audio parts 5.
- Each `include` part of `get_company`, `get_fund` and `get_event` is its own billed operation: include only the parts
  the question needs.
- Several companies go into ONE call (`company=AAPL,MSFT,GOOGL`), not one call each.
- The catalog resources, `search_endpoints` and `get_account` cost nothing. Before a large pull, check the credits
  left with `get_account` and say so if the pull would not fit.

## 6. Answer

- Cite the ids the tools return: accession numbers (and block ids) for filings, event ids and `[m:ss]` timestamps for
  calls, news item ids with the publisher and link for news.
- Give the period, as-of date and source of every number; never add values from different sources or dates.
- Separate what the data says from your interpretation, and name what is missing.

## 7. Changes to the user's account

Only `manage_alerts`, `manage_destinations` and `manage_alert_users` write, and only the user's own alert resources.
A delete or a secret rotation is permanent: call it without `confirm` (the host asks the user where it can), and
send `confirm=true` only after the user's explicit yes in this conversation; the `alert-setup` skill has the full flow.

## References

- [references/financials.md](references/financials.md): statements, point in time, ratios, growth, CAGR, segments,
  fact lineage, restatements and vintages.
- [references/filings.md](references/filings.md): listing, reading and citing SEC filings, full-text search, filers,
  IPOs and offerings.
- [references/earnings-calls.md](references/earnings-calls.md): the call calendar, the parts of a call, timestamps,
  guidance, transcript search, investor documents.
- [references/ownership.md](references/ownership.md): holders by source, 13F changes, fund holdings and weights,
  insider trades and holdings.
- [references/news.md](references/news.md): news items, announcements, news search and how to attribute them.
- [references/alerts.md](references/alerts.md): what alerts, destinations and end users are, before reading or
  changing them.

Workflow skills of this server, for whole tasks: `financial-research`, `compare-companies`, `analyze-earnings-call`,
`earnings-preview`, `analyze-filing`, `what-changed-since-last-report`, `restatement-history`, `ownership-review`,
`alert-setup`.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
