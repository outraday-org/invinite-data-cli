---
name: ownership-review
description: Use when the user asks who owns a company or a fund, which institutions bought or sold it last quarter, which funds hold it, what insiders bought, sold or hold, or what one insider or one investment manager has been doing.
---

# Ownership review

1. **Resolve the symbol** with `search_instruments` (`symbol=` for a ticker, `q=` for a name). A fund has holders but
   no insider trades; for what a fund itself holds, use `get_fund include=["holdings"]`.
2. **Institutions**: `get_holders symbol=AAPL source=13f` for the largest 13F managers (`period_end=` picks a
   quarter), then `get_holders symbol=AAPL changes=true` (Pro) for the biggest adds and cuts quarter over quarter
   (`type=new,sold_out` for new and exited positions).
3. **Funds holding it**: `get_holders symbol=AAPL source=nport`.
4. **Insiders** (stocks only): `get_insider_trades company=AAPL from=<six months ago>` for trades (`side=buy` /
   `sell`; `is_derivative=false` for share trades only), and `call_api path=/v1/insider-holdings
   query={company: "AAPL"}` for what the insiders hold (direct / indirect, options and RSUs).
5. **One insider across issuers**: take the `owner_cik` of a trade row, then `get_insider_trades owner=<cik>` and
   `call_api path=/v1/insider-holdings query={owner: "<cik>"}`.
6. **One manager's portfolio**: find the CIK with `search_instruments scope=filers phase=manager q=<name>`, then
   `get_holders filer=<cik>` (and `changes=true`).

## Present it

- Tables of the largest holders with value and share count, each with its source and date.
- Notable new and exited positions, and the largest adds and cuts.
- Insider buys versus sells by person and role; a sale flagged `is_10b5_1` was pre-scheduled under a trading plan
  and is routine. Fields the SEC dataset has not reached are "not stated", not "no".
- Then three sentences on whether ownership is shifting.

## Rules

- Keep the sources apart and never add them up: a manager's 13F contains its funds' N-PORT positions.
- 13F positions are as of the quarter end and filed up to 45 days later; N-PORT reports about 60 days after their
  quarter end. State both dates (position date and filing date) and the lag.
- Keep value apart from share count, and trades apart from holdings.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
