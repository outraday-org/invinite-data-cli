---
description: Compare the financial performance, valuation, growth, and risks of two or more companies.
argument-hint: <tickers or company names> [focus]
---

# Compare Companies

Compare the companies in `$ARGUMENTS` using Invinite Data.

1. Resolve ambiguous company names with `company_search` or the equivalent `invd` command.
2. Fetch available metric definitions before requesting financial metrics.
3. Fetch company details, the latest annual standardized snapshot, profitability and valuation ratios, and five-year CAGR where available.
4. Run independent reads in parallel when the active Claude surface supports it.
5. Present a compact comparison table followed by the most material strengths, weaknesses, and data limitations.
6. Cite the reporting periods used; do not mix annual and quarterly values without labeling them.
