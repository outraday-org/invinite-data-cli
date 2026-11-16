---
description: Set up a Data API alert end to end — an optional webhook destination, the alert rule, a test fire, and how to read its events.
argument-hint: <what to watch, e.g. "8-Ks of AAPL to https://hooks.example.com/x">
---

# Alert Setup

Set up the alert described in `$ARGUMENTS` with Invinite Data (MCP `manage_destinations` and `manage_alerts`, or the
`invd` commands below with `--json`). Alert fires and deliveries cost no credits; each management call is metered.

1. Pick the alert `type` from the request: `filing` (new SEC filings, `form_types`), `filing_keyword`, `news` /
   `news_keyword`, `earnings_call` / `earnings_call_keyword`, `earnings_results`, `dividend`, `halt`,
   `fundamental_metric`, `event_countdown`, or a price type (since 7.1): `price` (a level crossed, `operator` +
   `level`), `price_move` (`pct` against a `baseline`), `volume_spike` or `price_reminder` — stocks / ETFs by ticker,
   crypto with `asset_class: "crypto"`. Since 7.3: `script` (an uploaded chartlang script, `invd scripts upload <file>`
   → `script_version_id`) or `indicator` (a built-in `template` from `invd alert-templates list`, or a structured
   `condition`), each on `symbol` + `interval`, evaluated at bar close. In flags, a field both `condition` and `trigger` carry is prefixed
   (`--condition-mode`, `--trigger-mode`). Resolve each company to a ticker or CIK first
   (`invd companies list -q "<name>" --json`). Check what the account allows: `invd alerts list --json` shows the
   quota in `meta.quota`; `news`, `halt` and some `earnings_call` events need a higher plan (a refusal names it).
2. Where the events go:
   - To a webhook endpoint: `invd destinations create --url https://hooks.example.com/invinite-alerts --json`. The
     signing secret (`whsec_…`) is in this answer only — tell the user to store it now;
     `invd destinations rotate-secret <dst-id>` issues a new one. `invd destinations test <dst-id> --json` sends a test delivery.
   - No endpoint: skip the destination; every event is in the pull feed anyway.
3. Create the alert with its condition and trigger, for example:
   `invd alerts create --body '{"type":"filing","condition":{"symbols":["AAPL"],"form_types":["8-K"]},"trigger":{"mode":"every_time"},"destination_ids":["<dst-id>"],"client_reference_id":"aapl-8k"}' --json`.
   `trigger.mode` `once` ends the alert after its first fire; `cooldown_seconds`, `max_fires` and `expires_at` bound
   it. Several alerts at once: `invd alerts batch --body-file alerts.json --json` (upserts by `client_reference_id`).
4. Prove it: `invd alerts test <alert-id> --json` writes a test event (`test: true`) and delivers it to the
   destinations; check `invd destinations deliveries <dst-id> --json` for the delivery status.
5. Reading events: `invd alerts events <alert-id> --json` (one alert), `invd alert-events list --after <event-id> --json`
   (the account's feed, oldest first), or `invd alert-events tail` to follow new events live as JSON lines.
6. Report the destination id, the alert id and status, and how the user reads the events; never print a secret
   again after step 2. Pause with `invd alerts pause <alert-id>`, resume with
   `invd alerts resume <alert-id>`, delete with `invd alerts delete <alert-id>`.
