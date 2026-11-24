---
description: Review institutional ownership, position changes, concentration, insider trading and insider holdings for a company or a fund, or one insider's activity across issuers.
argument-hint: <ticker> [period or focus]
---

# Review Ownership

Review ownership activity for `$ARGUMENTS` using Invinite Data (MCP `get_holders`, `get_insider_trades`, or the `invd` commands below with `--json`).

1. Resolve the symbol (`invd instruments list -q "<name>" --json` when given a name); `invd instruments get AAPL --json` says whether it is a stock or a fund (a fund has no insider trades).
2. Fetch institutional holders (`invd holders AAPL --source 13f --period-end 2026-06-30 --json`), the funds holding it (`invd holders AAPL --source nport --json`), quarter-over-quarter position changes (`invd holders changes AAPL --json`) and, for a stock, insider trades (`invd insider-trades AAPL --filed-at-gte 2026-01-01 --json`) for the requested period, plus the insiders' stated positions (`invd insider-trades holdings AAPL --json`, Forms 3/4/5, `as_of` = the reported date). Keep the sources apart: a manager's 13F contains its funds' N-PORT positions, so never add them up.
3. To follow one insider, take the `owner_cik` of a trade row and read that person's activity across every issuer: `invd insider-trades list --owner 0001214156 --json` (trades) and `invd insider-trades holdings --owner 0001214156 --json` (positions). One of company / `--owner` is required.
4. Identify the largest holders, notable new or exited positions (`--type new,sold_out`), and meaningful insider acquisitions or dispositions (`--side buy` / `--side sell`).
5. Distinguish position value from share count and filing date from transaction or quarter-end date.
6. Present concise tables and call out reporting-lag limitations in institutional filings (13F positions are as of the quarter end, filed up to 45 days later).
