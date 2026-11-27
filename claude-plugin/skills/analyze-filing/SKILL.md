---
name: analyze-filing
description: Use when the user wants an SEC filing read and explained — a 10-K, 10-Q, 8-K, S-1 or proxy — its risk factors, MD&A, business description or a specific item, what is new versus the prior year, or evidence from it with exact citations.
---

# Analyze an SEC filing

1. **Find the filing.** Resolve the company (`search_instruments`; `scope=filers` for a filer without a listing),
   then `list_filings symbol=AAPL form=10-K limit=2` for the newest and the prior one (8-K: add `items=2.02` or the
   item the question is about). A filer without a listing (a pre-IPO S-1) takes its CIK or its proposed ticker as
   `symbol`; a filing filed in the last few days with no known filer: `list_filings form=S-1` without `symbol`. Keep
   the accession numbers.
2. **Open its outline.** `read_filing accession=<newest>` returns the documents, the section outline and the
   `version_id`. Read `invinite://catalog/sections` when you need the section ids of a form.
3. **Read only the sections the question needs** (normally risk factors `1A`, MD&A `7`, business `1`, the financial
   statements `8`): `read_filing version_id=<…> section=1A`. A passage cut short names the block to continue from:
   call again with `blocks=<that block>-…`. A section the outline does not have: read by `pages=`.
4. **A topic across filings** (not one known filing): `search_filings q="<words>" symbol=AAPL form=10-K item=1A` —
   100 credits per call, so narrow it.
5. **Write the analysis**: the form, filing date and period; then the material findings, each with its section and
   block id; then what the filing does not say.

## Risk factors and what changed

- Read `section=1A` of the newest and of the prior year's filing.
- Group the risks by theme, one sentence each, and flag which are **new**, **removed** or **materially reworded**
  against the prior year. Cite the block ids of both versions.

## Rules

- Separate what the filing states from your interpretation.
- Cite every finding with form, filing date, accession number, document `version_id` and block id (and the page when
  shown).
- Numbers from the financial statements: prefer `get_financials` (or `read_filing accession=<…> facts=numeric`) over
  reading tables as text, and say which you used.
- Flag a missing section, an unavailable period or a document not yet in the store (give the EDGAR link) instead of
  inferring its content.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
