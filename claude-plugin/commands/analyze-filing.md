---
description: Analyze a company's SEC filing for material changes, risks, management commentary, and evidence.
argument-hint: <ticker> [form type or research question]
---

# Analyze SEC Filing

Analyze the filing requested in `$ARGUMENTS` using Invinite Data.

1. Resolve the company and identify the relevant filing and accession number.
2. Discover valid filing section IDs before requesting sections.
3. Retrieve only the sections needed for the question, normally risk factors, MD&A, business, and financial statements.
4. Separate direct filing evidence from your interpretation.
5. Report the form type, filing date, accession number, and section for every material finding.
6. Flag missing sections or unavailable periods instead of inferring their contents.
