---
name: earnings-preview
description: Use before a company reports — "when does NVDA report", "what should I watch on Tesla's next call", "preview Apple's earnings" — to give the date and time of the next call, its guidance against the recent trend, and what to watch for.
---

# Earnings preview

1. **The next call**: `list_events company=NVDA status=upcoming limit=1` (or `from=<today>`). Give its date, time and
   `date_status`: an `estimated` or `unconfirmed` date is not confirmed, and a date-only event has no time of day.
   No upcoming call listed: say so, with the last call's date.
2. **The last call's guidance and open questions**: `get_event company=NVDA include=["guidance","qa"]` (the latest
   held call; Q&A needs Pro). Note each guidance item's period, range and basis.
3. **The trend**: `get_financials company=NVDA period=quarterly limit=4` for the last four quarters (and
   `get_metrics company=NVDA kind=growth period=quarterly` for growth rates).
4. **What happened since**: `get_news company=NVDA from=<30 days ago>`, then
   `get_news company=NVDA announcements=true from=<30 days ago>`.

## Write the preview

- The date and time of the next call (with how firm the date is).
- The guidance for the quarter being reported against the last four quarters' trend: is it a step up, in line, or a
  slowdown?
- A "watch for" list of three to five items, each with its source (event id and `[m:ss]`, news item id, or the
  guidance item): the topics analysts pressed on last time, guidance items at risk, new developments.
- Never present an estimate as a fact; say which inputs were missing.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
