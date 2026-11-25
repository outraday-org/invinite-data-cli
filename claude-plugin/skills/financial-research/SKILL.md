---
name: financial-research
description: Use for an open or multi-part research question about one or more US companies or funds — "research NVDA", "is this a healthy business", "how has Apple changed over five years", "what drives this fund" — that needs several kinds of data (statements, metrics, filings, calls, ownership, news) combined into one analysis.
---

# Financial research

You turn a broad question into a set of focused reads with the Invinite Data tools, run them, and write one analysis.
Load the `invinite-financial-data` skill first if it is not loaded: it says which tool serves what.

If the question is really one of these, follow that skill instead: `compare-companies`, `analyze-earnings-call`,
`earnings-preview`, `analyze-filing`, `what-changed-since-last-report`, `restatement-history`, `ownership-review`.

## 1. Decompose

Write down the independent data needs before calling anything:

- **Subjects**: resolve each name or uncertain ticker with `search_instruments`; note which are stocks and which are
  funds (a fund has holdings and weights, no statements).
- **Fundamentals**: statements (`get_financials`), ratios / growth / CAGR / segments (`get_metrics`); read
  `invinite://catalog/metrics` before choosing metric ids.
- **Filings**: the latest 10-K / 10-Q sections that matter (risk factors, MD&A) with `list_filings` + `read_filing`;
  a topic across filings with `search_filings` (100 credits: only when the question needs it).
- **Earnings calls**: the latest call's results, guidance and Q&A (`get_event company=… include=[…]`).
- **Ownership**: holders and insider trades (`get_holders`, `get_insider_trades`).
- **Context**: dividends and splits (`get_company include=[…]`), news and announcements (`get_news`), US macro series
  (`call_api path=/v1/macro/series` first).

Keep only the needs the question asks for. Each one becomes a read.

## 2. Fetch

- Put several companies into one call (`company=AAPL,MSFT`), never one call each.
- Run independent reads in parallel when your host allows it; if it lets you delegate to sub-agents, give each one
  focused read with the exact tool and arguments.
- Include only the `include` parts you need (each is billed). Page only while the question still needs rows.
- Before a large pull, check the credits left with `get_account` and tell the user if it will not fit.

## 3. Synthesize

1. Lead with the answer in two or three sentences.
2. Put comparisons in tables: one row per company or period, units and fiscal periods in the headers.
3. Point out trends, outliers and divergences, and explain what the numbers mean, not only what they are.
4. Cite every number's source: period and as-of date, accession for filings, event id and `[m:ss]` for calls,
   publisher and link for news.
5. Name the gaps: a read that failed, a plan the account lacks, coverage still pending.

Suggested shape (adapt it to the question):

```
## Summary
## Key metrics
## Analysis
## Caveats and gaps
```

Do not pad the answer with data you fetched but the question did not need.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
