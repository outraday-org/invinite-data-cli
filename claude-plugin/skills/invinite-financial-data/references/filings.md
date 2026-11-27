# SEC filings and documents

Read this when the question needs a filing: finding it, reading a section, quoting it with a citation, or finding
which filings discuss a topic.

## Find the filing: `list_filings`

- `symbol`: a stock's ticker or CIK (comma list allowed), an ETF's or listed fund's ticker (it lists the fund's own
  filings), the CIK of any other SEC filer (a pre-IPO issuer, a 13F manager, a Form 4 owner) or the proposed ticker of
  an open IPO registration (`meta.resolved` names the values read that way). An ETN has no filings of its own.
- Without `symbol`: the newest filings of every filer, listed or not, in a filed window of at most 7 days (the last 7
  days by default; `filed_from` / `filed_to` move it). Use it for "what was filed today" or every new S-1 / 8-K of the
  week (`form`, `items`); a filer without an instrument has `symbol: null`.
- `form` (`10-K,10-Q`), `items` for 8-K items (`2.02` results, `5.02` officers, `1.01` agreements, `8.01` other),
  `filed_from` / `filed_to` (YYYY-MM-DD, inclusive). Newest first, Lite, 1 credit.
- Each row: accession, form, filing date, period of report, 8-K items, EDGAR index URL and `filer` (`cik`, `name`,
  `role`: the filer the row is listed under). `meta.form_facet` counts the forms of a symbol-scoped list.
- The resource `invinite://catalog/forms` describes every form the API serves.
- An earnings call (`get_event`) names its two filings itself: `results_filing` (the earnings 8-K or 6-K) and
  `periodic_report` (the 10-Q or 10-K of that fiscal period, null until filed).

## Read it: `read_filing`

1. `read_filing accession=<…>` without a selector returns the filing, its documents and the section outline of the
   primary document, plus its `version_id` (2 operations).
2. Then one of: `section=` (an item such as `1A` or `7`, a section id, or a title fragment such as "risk factors"),
   `pages=1-3`, or `blocks=b120-b160`. It returns the passage as text with a block id after each paragraph (3
   operations with the lookup; pass `version_id=` instead of `accession` to skip it).
3. A passage cut short ends with the block to continue from: call again with `blocks=<that block>-…`.

- Read `invinite://catalog/sections` for the section ids of each form before asking for a section by id. A section
  the outline does not have answers with the outline's items: pick one or read by page.
- `document=<file name>` picks another document of the filing than the primary one, such as the press-release exhibit
  of an 8-K; the first call lists the documents with their file names.
- `facts=numeric` returns the filing's XBRL facts (`tag=us-gaap:Revenues` narrows them), `facts=text` its text blocks
  (the notes). `figure=<block id>` with `version_id` returns a figure's image and caption.
- A filing whose documents are not in the store yet says so: give the user the EDGAR URL instead.

Cite every finding with the form, filing date, accession number, the document `version_id` and the block id (and the
page when shown): block ids belong to one document version, so an exhibit's blocks need its own `version_id`. Separate
what the filing states from your reading of it, and say when a section is missing instead of inferring its content.

## Which filings discuss a topic: `search_filings`

- One call across filing documents returns cited passages (accession, form, date, document version and block),
  never a prose answer. Do not list and read filings one by one to find a topic.
- It costs **100 credits per call** (Standard). Always narrow it: `symbol` (comma list of up to 50), `form`, `item`
  (`1A` = risk factors), `filed_from` / `filed_to`.
- `mode=lexical` (default) ranks words; `mode=literal` matches an exact string (`FY2027`, `10b5-1`, a product name).
- To read one known filing use `read_filing`, never `search_filings`.

## Filers, registrations, offerings

- Any SEC filer by name, including 13F managers, fund trusts and pre-IPO issuers without a listing:
  `search_instruments scope=filers q=<name>` (`phase=pre_ipo`, `manager`, …). Any filer's CIK (and an open
  registration's proposed ticker) works as `symbol=` in `list_filings` and `search_filings`.
- A company's filer record (former names and tickers, successors): `get_company include=["filer"]`.
- IPOs from registration to listing: `call_api path=/v1/ipos` (`stage`, `is_spac`, `listing_date.gte`, `company`). An
  announcement over a year old without a registration or a listing reads `dormant`: leave it out of upcoming IPOs.
- Form D private offerings: `call_api path=/v1/offerings query={company: "<ticker or cik>"}`.
- The SEC comment letters and replies linked to a filing: `call_api path=/v1/filings/<accession>/review-chain`
  (`max_depth=1` for direct links; check `completeness` before saying a chain is complete).
