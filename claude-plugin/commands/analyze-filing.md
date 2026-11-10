---
description: Analyze a company's SEC filing for material changes, risks, management commentary, and evidence.
argument-hint: <ticker> [form type or research question]
---

# Analyze SEC Filing

Analyze the filing requested in `$ARGUMENTS` using Invinite Data (MCP `list_filings`, `read_filing`, `search_filings`, or the `invd` commands below with `--json`; the MCP server also offers the `summarise_10k_risk_factors` prompt).

1. Resolve the company (`invd companies list -q "<name>"`, or `invd filers list -q "<name>"` for an unlisted filer) and find the filing and its accession: `invd filings AAPL --form 10-K --limit 1 --json`.
2. Open the filing's documents for the `version_id` of the primary document: `invd filings get 0000320193-26-000026 --expand documents --json`.
3. Discover valid section ids (`invd catalog sections --form 10-K --json`), then list the version's sections: `invd documents sections <version_id> --json`.
4. Read only the sections the question needs (normally risk factors, MD&A, business, financial statements): `invd documents get <version_id> --blocks <blocks> --json`. For a topic across filings use `invd search filings "<keywords>" --company AAPL --form 10-K --json` (100 credits a page).
5. Separate direct filing evidence from your interpretation.
6. Report the form type, filing date, accession number, section and `version_id` + `block_id` (with the printed page label when present) for every material finding.
7. Flag missing sections, unavailable periods or a `pending` / `partial` coverage note instead of inferring their contents.
