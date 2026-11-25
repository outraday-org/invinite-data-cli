# Ownership: holders, fund holdings, insiders

Read this when the question is who owns a stock or a fund, how institutions moved, what a fund holds, or what
insiders bought, sold or hold.

## Who holds an instrument: `get_holders`

- `symbol` is ONE stock, ETF, closed-end fund or ETN (or a company CIK, or a fund key such as `S000024908`).
- Three sources, each with its own date, never merged:
  - `source=13f`: 13F managers. Positions are as of the quarter end (`period_end` picks the quarter) and are filed up
    to 45 days later. Keep the quarter end and the filing date apart.
  - `source=nport`: funds' N-PORT reports (listed funds holding it, as a % of their net assets); each fund's latest
    report, about 60 days after its quarter end.
  - `source=issuer_file`: ETFs whose own daily or monthly holdings file holds it.
- Without `source`: an overview, each source's top rows with its state, as-of date and total (`meta.sections`), no
  paging. The sources overlap (a manager's 13F contains its funds' N-PORT positions; an ETF's issuer file repeats its
  N-PORT report): never add them up. Pick one `source` for a full, paged list.
- Keep value and share count apart; `instruments=all` (13F) adds options and principal amounts to shares.
- `changes=true` (Pro): quarter-over-quarter 13F changes in the symbol, `type` any of `new`, `added`, `reduced`,
  `sold_out`, `unchanged` (without `type`: every change but `unchanged`); `prior_period_end` picks the quarter to
  compare with.
- One manager's 13F portfolio: `filer=<CIK>` without `symbol` (`changes=true` for its changes). Find the CIK with
  `search_instruments scope=filers phase=manager q=<name>`.
- One 13F-HR or NPORT-P filing's lines as filed: `accession=<…>`.
- Lite, 1 credit per call (changes: Pro).

## What a fund holds: `get_fund`

- `fund`: an ETF or closed-end fund ticker, or its fund key. `include` any of `profile` (default), `holdings`,
  `weights`, `dividends`, `splits`, `coverage`; each part is billed separately.
- Holdings come from the freshest composition: the issuer's daily or monthly holdings file, else the fund's latest
  N-PORT report. The answer names its source and `as_of`: state both with the numbers. `as_of=YYYY-MM-DD` reads the
  composition stored on or before that day.
- `weights` gives sector, country and asset-class weights of the same composition (`dimension=sector` for one).
- A stated reason replaces rows: a single-asset trust has no holdings list; an issuer file more than 5 trading days
  old is stale; no composition yet means coverage is pending. Repeat the reason, do not call the fund empty.
- An ETF of `structure` `exchange_traded_trust` (GLD, IBIT, USO) files no holdings report: holdings and weights are
  refused by name.
- Who holds the fund itself: `get_holders symbol=SPY`.

## Insider trades: `get_insider_trades`

- `company` (comma list allowed), or `owner` = an insider's own CIK (the `owner_cik` of a trade row) for that
  person's trades across every issuer. One of the two is required. Standard, 1 credit.
- `side=buy|sell`, `from` / `to` (filing date), `traded_from` / `traded_to` (`transaction_date`), `is_derivative`
  (`false` = shares only: use it for a buy / sell total; `true` = options and RSUs).
- Rows carry the person, role, shares, price and filing time; where the SEC Form 3/4/5 dataset has reached them also
  the trade date, the derivative terms, direct / indirect ownership, footnotes and `is_10b5_1` (a sale under a Rule
  10b5-1 plan is pre-scheduled and routine). Those fields are null on rows the dataset has not reached: say "not
  stated", not "no".
- `id=<…>` returns one transaction.
- Funds have no insider trades.

## Insider holdings (positions, not trades)

`call_api path=/v1/insider-holdings query={company: "AAPL"}` (or `owner: "<cik>"`): the holdings stated on Forms 3,
4 and 5 without a transaction, direct or indirect, with derivative terms (options, RSUs); `as_of` is the reported
date. Standard, 1 credit.

## Presenting ownership

Name every holder with its source and date, separate institutions, funds and insiders, and call out the reporting
lag of 13F and N-PORT data. Summarise insider activity as buys versus sells by person and role, not as one net number
across derivative and non-derivative rows.
