# Alerts, destinations and end users

Read this before you read or change the user's alerts. To set one up end to end, load the `alert-setup` skill.

## What they are

- An **alert** (`alt_…`) is a rule: a `type` (a filing, news, an earnings call, a dividend, a trading halt, a keyword,
  a fundamental metric, earnings results, an event countdown, a US macro release, a price level or move, a volume
  spike, a price reminder, a chartlang script or indicator), a `condition` and a `trigger`. When it matches it fires
  an event.
- Every event lands in the account's pull feed (`manage_alerts action=events`), with or without a destination.
- A **destination** (`dst_…`) is a webhook endpoint that receives each event as a signed POST (Standard Webhooks).
  Its signing secret is shown exactly once, on create or `rotate_secret`.
- An **end user** is one of the user's own customers, the `external_user_id` on their alerts, with optional limits.
- Management calls cost 1 credit each (the end-user defaults 0); fires and deliveries are included in the plan. The
  plan bounds the number of alerts (`meta.quota` of `manage_alerts action=list`) and some types (news and news
  keywords, halts, macro, some earnings-call events, short chart intervals); a refusal names the plan.

## Reading

- `manage_alerts action=list` (`status`, `type`, `symbol`, `destination_id`, `external_user_id` filters),
  `action=get id=alt_…`.
- `manage_alerts action=events`: the account's feed, oldest first; `after=evt_…` continues after the last event you
  hold. `id=alt_…` lists one alert's events instead (paged by cursor, no `after`); `event_type` narrows to one kind
  (`alert.fired`, `alert.status_changed`, `destination.disabled`, …). An event whose payload has `delivery_skipped`
  (`fire_cap` for the account's daily cap, `alert_user_fire_cap` for an end user's) was kept in the feed but not
  delivered.
- `manage_destinations action=deliveries id=dst_…`: the delivery log (status, attempts, last HTTP status).
- `manage_alert_users action=list` / `get` shows each end user's limits and usage; `get_defaults` the account
  defaults.

## Changing

- `create`, `update`, `pause`, `resume`, `test` change only the user's own resources. `validate_only=true` on create
  runs every check and writes nothing.
- **Permanent actions** — `manage_alerts action=delete`, `manage_destinations action=delete` and
  `action=rotate_secret`, `manage_alert_users action=delete` (an erasure of the end user's alerts, events and
  deliveries) — run only after the user's yes. Call them WITHOUT `confirm`: a host that supports it asks the user
  with a form, and a decline is a normal answer (nothing is deleted or rotated); otherwise the tool answers with an error
  telling you to ask the user and call again with `confirm=true`. Send `confirm=true` only when the user has already said yes in this
  conversation, never on your own. `pause` and `resume` need no confirmation.
- A secret from create or `rotate_secret` is shown once: hand it to the user immediately and never print it again.
  After a rotation the old secret keeps signing for 24 hours.
- Bulk writes (many alerts or end users at once) and uploading a chartlang script are REST operations, not tools:
  tell the user to use the API or the dashboard for them.


## Typed conditions and edits (13.0)

Each alert type has its own condition and trigger schema. For example, PriceMoveAlertConditionInput requires
symbol, direction, pct and baseline; FilingAlertConditionInput takes SEC form filters and company lists.
CreatePriceMoveAlertRequest and CreateFilingAlertRequest contain complete request examples in the published spec.
The generated Alert response is a union selected by type, so narrowing that field also narrows condition and trigger.

When an update sends condition, also send the stored type. A different type is refused: create a new alert instead.
Settings-only updates may omit type. A trigger-only update is checked against the stored type; rearm and
rearm_distance_pct apply to price, price_move and volume_spike, and cooldown_bars only to script and indicator.
