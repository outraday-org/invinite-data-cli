---
description: Review institutional ownership, position changes, concentration, and insider trading for a company.
argument-hint: <ticker> [period or focus]
---

# Review Ownership

Review ownership activity for `$ARGUMENTS` using Invinite Data (MCP `get_holdings`, `get_insider_trades`, or the `invd` commands below with `--json`).

1. Resolve the company identifier (`invd companies list -q "<name>" --json` when given a name).
2. Fetch institutional holdings (`invd holdings AAPL --period-end 2026-06-30 --json`), quarter-over-quarter position changes (`invd holdings changes AAPL --json`) and insider trades (`invd insider-trades AAPL --filed-at-gte 2026-01-01 --json`) for the requested period.
3. Identify the largest holders, notable new or exited positions (`--type new,sold_out`), and meaningful insider acquisitions or dispositions (`--side buy` / `--side sell`).
4. Distinguish position value from share count and filing date from transaction or quarter-end date.
5. Present concise tables and call out reporting-lag limitations in institutional filings (13F positions are as of the quarter end, filed up to 45 days later).
