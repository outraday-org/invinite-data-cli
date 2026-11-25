---
name: what-changed-since-last-report
description: Use when the user asks what is new at a company recently — "what happened at Amazon since its last 10-Q", "any material news", "catch me up on this company" — covering its 8-Ks and news since its last periodic report, in date order with sources.
---

# What changed since the last report

1. **The last periodic report**: `list_filings symbol=AMZN form=10-K,10-Q limit=1`. Its filing date starts the
   window.
2. **Material events since**: `list_filings symbol=AMZN form=8-K filed_from=<that date>`. Read the material ones with
   `read_filing accession=<…>`: item 1.01 (a material agreement), 2.01 (an acquisition or disposal), 2.02 (results),
   5.02 (officers and directors), 8.01 (other events); for results also the press-release exhibit.
3. **News and announcements since**: `get_news company=AMZN from=<that date>` and, for product, partnership and
   contract developments, `get_news company=AMZN announcements=true from=<that date>`.
4. **Other filings that matter** when the question asks: Form 4 insider trades (`get_insider_trades company=AMZN
   from=<that date>`), a new registration or proxy (`list_filings symbol=AMZN filed_from=<that date>` without `form`
   shows every form, counted in `meta.form_facet`).

## Write the update

- A short bullet list in date order, oldest first, each bullet with its date and source: the accession number for a
  filing, the news item id with publisher and link for news.
- One line per event on why it matters; group many routine filings into one line.
- Name the window ("since the 10-Q filed on …") and what was not covered.
- News summaries and announcements are Invinite's summaries of what the company published: present them as such.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
