# News and announcements

Read this when the question is about what a company published or what was reported about it: news items, results
releases, product and partnership announcements.

## Where the news comes from

Every item comes from an SEC filing (an 8-K or 6-K) or the company's own newsroom; there are no wire services and no
third-party articles. The headline is the publisher's; the one-line lede, the summary text and the announcements are
Invinite's wording of the publication.

## Modes of `get_news`

| Mode | Arguments | Plan, credits |
|---|---|---|
| A company's (or a call's) items, newest first | `company` (comma list) and / or `event_id`; `kind`, `topic`, `from` / `to` (published date) | Lite, 1 |
| Search headlines, ledes and summaries | `q` (+ `company`, `from` / `to`) | Standard, 10 |
| One item | `item_id` | Lite, 2 |
| One item's summary text | `item_id` + `text=true` | Lite, 2 |
| Developments read from the items | `announcements=true` (+ `company`, `topic`, `from` / `to`, announced date) | Lite, 2 |

- `kind` of an item: `earnings_results`, `results_date`, `call_announcement`, `event_announcement`, `guidance`,
  `m_and_a`, `material_agreement`, `management_change`, `dividend`, `capital_markets`, `other`.
- Announcement `topic`: `product_launch`, `product_update`, `availability`, `partnership`, `customer_contract`,
  `capacity_expansion`, `regulatory`, `research`. Each announcement names its products, counterparties and the
  effective date as the text states it.
- A correction is a new item that names the item it supersedes: report the newest.

## Attributing what you show

- Every item carries `attribution`: the publisher (the company, or SEC EDGAR for a filing), `source_url`,
  `published_at`, and form + accession for a filing. Whenever you show a headline or summary, name the publisher,
  link `source_url` and give the date.
- Present a summary or announcement as Invinite's summary of what the publisher stated, not as verified fact; the
  item's `attribution.statement` is the sentence to carry with it.
- Report an announcement's `claim_status` as stated: `planned` is a plan, not availability; `announced` is not
  `completed`.
- For the primary text of a filing item, read the filing itself with `read_filing accession=<…>`.
