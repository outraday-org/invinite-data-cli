---
name: alert-setup
description: Use when the user wants to be notified about a company, a price, a macro release or a chart signal — create, test, change, pause or delete an Invinite alert, connect a webhook (or a Claude routine) for it, read what fired, or set per-customer alert limits.
---

# Alert setup

Set up the alert the user described with `manage_destinations`, `manage_alerts` and, for the user's own customers,
`manage_alert_users`. Each management call costs 1 credit (the end-user defaults 0); fires and deliveries cost nothing.

## 1. Decide what to watch

Pick the alert `type` from the request:

| The user says | `type` | `condition`, for example |
|---|---|---|
| a new filing (8-K, 10-K, Form 4 …) | `filing` | `{symbols: ["AAPL"], form_types: ["8-K"]}` |
| a word in filings / news / call transcripts | `filing_keyword`, `news_keyword`, `earnings_call_keyword` | `{keywords: ["recall"], symbols: ["F"]}` |
| any news of a company | `news` | `{symbols: ["NVDA"]}` |
| an earnings call event, results, a dividend, a trading halt | `earnings_call`, `earnings_results`, `dividend`, `halt` | `{symbols: ["TSLA"], statuses: ["halted"]}` (halt) |
| a fundamental metric crossing a value | `fundamental_metric` | see `search_endpoints q="createAlert"` |
| days before an event | `event_countdown` | see `search_endpoints q="createAlert"` |
| a price level crossed | `price` | `{symbol: "AAPL", operator: "crosses_above", level: 250}` |
| a % move | `price_move` | `{symbol: "NVDA", direction: "down", pct: 5, baseline: "prior_close"}` |
| unusual volume | `volume_spike` | `{symbol: "TSLA", mode: "relative", interval: "1h", multiple: 3, lookback_bars: 20}` |
| a scheduled price note | `price_reminder` | `{symbol: "bitcoin", asset_class: "crypto", frequency: "daily", time_of_day_minutes: 540, timezone: "America/New_York"}` |
| a CPI / payrolls / yield release or threshold | `macro` | see "Macro rules" below |
| a chart signal (RSI, MACD, moving averages) or the user's own chartlang script | `indicator`, `script` | see "Chart alerts" below |

- Resolve a company to its ticker first (`search_instruments`); crypto goes by its slug with `asset_class: "crypto"`.
- `search_endpoints q="createAlert"` prints every field of every condition; use it for any type not shown above.
- Check the room left: `manage_alerts action=list` shows the quota in `meta.quota`. Free has no alerts; `news` and
  `news_keyword` need Standard, `halt` and `macro` Lite, some earnings-call events Pro. A refusal names the plan: tell the user.
- Before promising anything, `manage_alerts action=create validate_only=true` with the full rule runs every check and
  writes nothing.

## 2. Decide where the events go

- **No endpoint**: skip the destination. Every event is in the pull feed (`manage_alerts action=events`).
- **A webhook**: `manage_destinations action=create url=https://…` (list the existing ones first only when the user
  says they already have one). The answer holds the signing secret (`whsec_…`)
  exactly once: give it to the user now, tell them to store it, and never print it again. `kind=batch_webhook` sends
  many fires per request; `digest_seconds` holds events and sends them as one batch; `max_events_per_minute` throttles.
- **A Claude routine**: `preset=claude_routine` with `headers={Authorization: "Bearer …"}`.
- Prove it: `manage_destinations action=test id=dst_…`, then `action=deliveries` for the status.

## 3. Create the alert

`manage_alerts action=create` with `type`, `condition`, `trigger`, `destination_ids` (if any) and a
`client_reference_id` of your own (a repeated create with the same id returns the same alert, so a retry is safe).

- `trigger`: `mode` `once` (ends after the first fire) or `every_time`; bound it with `cooldown_seconds`,
  `max_fires`, `expires_at`, `activate_at`, `active_window`. Price alerts re-arm by `rearm` `auto` or `cross_back`
  (+ `rearm_distance_pct`).
- `metadata`: the user's own key / values, echoed in every event.
- Then `manage_alerts action=test id=alt_…` writes a test event (`test: true`) and delivers it.

## 4. Report

Give the destination id, the alert id and status, how the user reads the events (the feed with
`action=events after=evt_…`, or the webhook), and how to pause (`action=pause`), resume and delete it.

## Changing or removing

- `update` takes `version` to refuse a stale write; `pause` / `resume` are reversible and need no confirmation.
- **Deleting an alert, a destination or an end user, and rotating a destination's secret are permanent.** Call the
  action WITHOUT `confirm`: a host that supports it shows the user a confirmation form, and a decline comes back as a
  normal answer (nothing deleted or rotated) — accept it. Otherwise the tool answers with an error telling you to ask the user and call again
  with `confirm=true`: ask, and send `confirm=true` only after the user's explicit yes. Never send `confirm=true` because
  the task seemed to imply it.
- A rotated secret is shown once; the old one keeps signing for 24 hours.

## Macro rules

Find the series and its fields with `call_api path=/v1/macro/series`. A ten-year Treasury yield above 4 %:
`type: "macro"`, `condition: {macro_events: ["macro.released", "macro.revised"], macro_families: ["yield_curve"],
macro_threshold: {series_id: "treasury_par_y10", field: "value", operator: "gt", value: 4}}`. A CPI release only:
`macro_events: ["macro.released"], macro_series_ids: ["cpi_all_sa"]`; a payroll revision: `macro.revised` with
`payrolls_sa`. The event's id survives webhook retries; the source release has its own `source_event_id` inside
`reason.details`.

## Chart alerts

- Both types run at each bar close of `interval` on ONE instrument (`symbol`, `asset_class`; `commodity` for
  `XAUUSD` / `XAGUSD`). The shortest interval depends on the plan: Lite 1h, Standard 5m, Pro 1m; `1w` and `1mo` work
  too.
- `indicator`: a built-in template (`call_api path=/v1/alert-templates` lists them: RSI, MACD signal, price vs SMA,
  EMA cross) as `condition.template: {key: "rsi-cross", inputs: {level: 30, direction: "below"}}`, or a structured
  condition (`lhs`, `comparator`, `rhs`, optional `filters`).
- `script`: the user's own chartlang script, by `condition.script_version_id` (`scv_…`). Uploading and compiling a
  script is a REST call (`POST /v1/scripts`), not a tool: send the user there or to the dashboard. Read their scripts
  and versions with `call_api path=/v1/scripts` and `path=/v1/scripts/<id>/versions`; a version with compile errors
  cannot be used. An alert keeps the version it was created with. While hosted scripts are switched off, these
  routes answer 503 `unavailable`: say so rather than retrying.
- Chains: a script's external series inputs are bound in `condition.series_inputs`, keyed by the input's key:
  `{kind: "ohlc", field: "hl2"}`, `{kind: "builtin_indicator", indicator_id: "rsi", series_key: "rsi", params:
  {length: 14}}` or `{kind: "script_output", node_key: "n1", slot_id: "<plot slot id>"}` with the producer in
  `condition.nodes` (`[{node_key: "n1", script_version_id: "scv_…"}]`, at most 4). The slot ids are the producer
  version's `manifest.plots[].slotId` (`call_api path=/v1/scripts/<id>/versions`); a version's `alert_ids` are what
  `condition.alert_ids` may name.
- Pre-close: `condition.evaluation: {kind: "pre_close", offset_minutes: 15}` evaluates the forming bar 15 minutes
  before the US close and delivers only then (crypto and commodities also need `exchange`, e.g. `"NYSE"`).

## End users (the user's own customers)

When the user builds alerts for its customers, each customer is an `external_user_id` on the alert and an end user of
the account.

- Limits per end user: `max_active_alerts` (active + paused + scheduled), `max_script_alerts` (script and indicator
  alerts among them), `max_fires_per_day` (UTC day). The effective limit is the user's own value, else the account
  default (`manage_alert_users action=set_defaults`), else none; the plan quota stays the ceiling.
- `manage_alert_users action=set external_user_id=… max_active_alerts=50` sets one; `null` clears a value.
- A create beyond a limit is refused (`alert_user_limit_reached`); for a paused user (`alert_user_paused`). A lowered
  limit keeps existing alerts and refuses new ones. Use `validate_only=true` with the `external_user_id` before
  promising a customer an alert.
- Beyond `max_fires_per_day` the fire stays in the feed but is not delivered that day (one
  `alert_user.fire_cap_reached` event); deliveries resume at 00:00 UTC.
- `pause` stops every alert of the end user and refuses creates until `resume`, which re-arms exactly what was paused.
- `delete` erases the end user (its alerts, events and deliveries, permanently; `deleting` while it runs) and follows
  the confirmation rule above. A feed cursor naming an erased event is refused: restart from the last event you hold.
- Many end users at once is a REST batch call, not a tool.

Without a connected Invinite Data MCP server, load the `invinite-data-cli` skill: it maps every tool named here to an `invd` command.
