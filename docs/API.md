# QueueSense API contract (backend <-> frontend)

Base: same origin, all JSON under `/api`. Times are ISO-8601 UTC strings (`"2026-10-17T07:30:00Z"`); the frontend
displays them in the venue timezone (`venue.timezone`, default Asia/Kolkata). Durations are **seconds**.

Errors (any non-2xx): `{ "error": { "code": "TICKET_NOT_FOUND", "message": "Human text", "hint": "optional" } }`.
Mutating requests may send header `Idempotency-Key: <uuid>`; a repeated key returns the original response.
Auth header for staff/admin/customer: `Authorization: Bearer <token>`. EventSource can't send headers, so streams take `?token=`.

## Shared objects

```jsonc
// Eta
{ "p20": 420, "p50": 600, "p80": 840,            // seconds
  "text": "7–14 min",                             // already formatted with display rules (never "0 min" unless called)
  "confidence": "High" | "Medium" | "Low",
  "reason": "Based on the last 14 customers for Fee payment",
  "rise_reason": "A counter was paused" | null }  // set when estimate rose >= 3 min

// ServiceType
{ "id": "st_ab12", "name": {"en": "Fee payment", "hi": "...", "gu": "..."}, "color": "#1F6FEB",
  "allows_priority": false, "resource_kind": "counter" | "table" | "room",
  "prior_mean_seconds": 180, "prior_cv": 0.4 }

// Venue (public)
{ "slug": "city-canteen", "name": "City Canteen", "template": "canteen", "timezone": "Asia/Kolkata",
  "is_demo": true, "open_now": true,
  "open_hours": [{"weekday": 0, "open": "08:00", "close": "20:00"}],   // weekday 0 = Monday
  "settings": { ...all venue settings, see spec section 4... },
  "service_types": [ServiceType], "party_max": 6, "has_tables": true }

// TicketView (public, by code; never contains phone or other customers' data)
{ "code": "A-042", "venue_slug": "...", "venue_name": "...", "service_type_id": "...", "service_name": {"en":..},
  "party_size": 2, "priority_class": "NORMAL" | "SENIOR" | "EMERGENCY", "source": "walkin" | "prebook" | "staff_added",
  "status": "BOOKED" | "WAITING" | "CALLED" | "IN_SERVICE" | "DONE" | "NO_SHOW" | "CANCELLED" | "EXPIRED",
  "position": 3 | null, "ahead": 2 | null, "eta": Eta | null,
  "resource_label": "Counter 3" | null, "resource_kind": "counter" | null,
  "called_at": iso | null, "call_expires_at": iso | null,     // countdown target when CALLED and venue holds the call
  "slot_start": iso | null, "checkin_open": true,            // for BOOKED
  "reason": "Next in line, waiting 18 min" | null,          // why this ticket got its resource
  "snooze_count": 0, "can_snooze": true, "is_table": false,
  "rating": null, "accurate": null, "created_at": iso,
  "notices": [{"template": "CALLED", "text": "Go to Counter 3", "ts": iso}],   // newest first, max 5
  "join_url": "http://host/v/slug", "share_text": "..." }

// Resource (staff console)
{ "id": "r_1", "kind": "counter", "label": "Counter 1", "capacity": 1, "service_type_ids": ["st_.."],
  "status": "OPEN" | "BUSY" | "HELD" | "PAUSED" | "CLOSED",
  "ticket": { "id": "t_..", "code": "A-041", "status": "CALLED" | "IN_SERVICE", "party_size": 1,
              "priority_class": "NORMAL", "display_name": null, "called_at": iso, "service_start_at": iso | null } | null,
  "held_for_code": "A-050" | null, "held_until": iso | null,
  "status_changed_at": iso, "dwell_seconds": 1320 | null, "dwell_alert": false,   // tables: "Still occupied?"
  "pending_release": false }                                                      // customer tapped "I'm leaving"
```

## Public / customer

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/venues` | | `[{slug, name, template, open_now, queue_length, typical_eta: Eta|null, is_demo}]` |
| GET | `/api/venues/{slug}` | | Venue |
| GET | `/api/venues/{slug}/summary` | | `{slug, name, open_now, queue_length, services: [{service_type_id, name, waiting, open_resources, eta: Eta|null}], updated_at}` |
| GET | `/api/venues/{slug}/qr.svg` | | SVG of the join URL |
| POST | `/api/otp/request` | `{phone}` | `{sent: true, demo_code: "4821" | null}` (demo_code only in demo mode) |
| POST | `/api/otp/verify` | `{phone, code}` | `{token, phone_last4}` (customer token, 12 h) |
| POST | `/api/venues/{slug}/tickets` | customer token; `{service_type_id, party_size, priority_class?: "NORMAL"|"SENIOR", display_name?, lang?}` | TicketView. 409 `ALREADY_HAS_TICKET` with `hint` = existing code |
| GET | `/api/tickets/{code}` | | TicketView |
| POST | `/api/tickets/{code}/cancel` | | TicketView |
| POST | `/api/tickets/{code}/snooze` | | TicketView (let 2 go ahead, max 2) |
| POST | `/api/tickets/{code}/checkin` | | TicketView (BOOKED -> WAITING) |
| POST | `/api/tickets/{code}/leaving` | | TicketView (tables, IN_SERVICE; auto-confirms after 60 s) |
| POST | `/api/tickets/{code}/feedback` | `{rating?: 1-5, accurate?: bool}` | TicketView |
| POST | `/api/tickets/{code}/delete-data` | | `{ok: true}` (removes phone hash/last4/name) |
| GET | `/api/tickets/{code}/ics` | | text/calendar file (bookings) |
| GET | `/api/phone/tickets` | customer token | `[TicketView]` active tickets for this phone |
| GET | `/api/venues/{slug}/slots` | `?service=<id>&party=2&date=YYYY-MM-DD` | `[{start: iso, label: "13:15", status: "green"|"amber"|"red"|"full", reason: "Likely busy"}]` |
| POST | `/api/venues/{slug}/bookings` | customer token; `{service_type_id, party_size, slot_start: iso}` | TicketView (status BOOKED) |
| GET | `/api/venues/{slug}/board` | | `{venue_name, now_serving: [{code, resource_label}], next_up: ["A-043", ...], services: [{name, eta_text}], join_url, updated_at}` |
| GET | `/api/venues/{slug}/stream` | `?ticket=<code>` or `?token=<staff jwt>` | SSE, see below |

## Staff (staff or admin token for that venue)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/login` | `{slug, pin}` | `{token, role: "STAFF"|"ADMIN", name, slug}` |
| GET | `/api/staff/venues/{slug}/console` | | `{venue: Venue, resources: [Resource], up_next: [{ticket_id, code, party_size, service_type_id, priority_class, display_name, source, waited_seconds, reason}], queue_length, flags: [{code, message}], undo: {label, expires_at} | null, staff_name}` |
| POST | `/api/staff/resources/{id}/next` | | `{ok, message, called: code | null}` (ends current implicitly, calls next) |
| POST | `/api/staff/tickets/{id}/arrived` | | `{ok, message}` (CALLED -> IN_SERVICE; "SEATED" for tables) |
| POST | `/api/staff/tickets/{id}/served` | | `{ok, message}` |
| POST | `/api/staff/tickets/{id}/no-show` | | `{ok, message, called}` |
| POST | `/api/staff/tickets/{id}/skip` | | `{ok, message, called}` |
| POST | `/api/staff/resources/{id}/left` | | `{ok, message, called}` (table/room free; confirms self-release) |
| POST | `/api/staff/resources/{id}/pause` | `{reason?}` | `{ok, message}` |
| POST | `/api/staff/resources/{id}/resume` | | `{ok, message}` |
| POST | `/api/staff/venues/{slug}/walkins` | `{service_type_id, party_size, display_name?}` | `{ok, code, ticket: TicketView}` |
| POST | `/api/staff/venues/{slug}/emergency` | `{service_type_id, display_name?}` | `{ok, code}` |
| POST | `/api/staff/undo` | | `{ok, message}` |
| POST | `/api/staff/assignments/{ticket_id}/override` | `{resource_id, reason: "Emergency"|"Regular customer error"|"Other"}` | `{ok, message}` |

Staff requests may send `X-Client-Ts: <iso>` (offline queue); the server clamps it to +/- 2 min of server time.

## Admin (admin token)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/templates` | | `[{id, name, description}]` |
| POST | `/api/admin/venues` | `{template, name, slug}` | `{venue: Venue, staff_pin: "1234", admin_pin: "0000"}` (no auth needed: creating a new venue) |
| GET | `/api/admin/venues/{slug}` | | `{venue: Venue, resources: [Resource], staff_users: [{id, name, role}]}` |
| PATCH | `/api/admin/venues/{slug}` | `{name?, open_hours?}` | Venue |
| PATCH | `/api/admin/venues/{slug}/settings` | partial settings | Venue |
| POST | `/api/admin/venues/{slug}/service-types` | ServiceType without id | ServiceType |
| PATCH / DELETE | `/api/admin/service-types/{id}` | partial | ServiceType / `{ok}` |
| POST | `/api/admin/venues/{slug}/resources` | `{kind, label, capacity, service_type_ids}` | Resource |
| PATCH / DELETE | `/api/admin/resources/{id}` | partial | Resource / `{ok}` |
| POST | `/api/admin/venues/{slug}/staff-users` | `{name, role, pin}` | `{id, name, role}` |
| DELETE | `/api/admin/staff-users/{id}` | | `{ok}` |
| GET | `/api/admin/venues/{slug}/analytics` | `?from=iso&to=iso` | see below |
| POST | `/api/admin/venues/{slug}/whatif` | `{add_resources: 0-3, pause_resources: [id], horizon: 60}` | `{before: {p50_seconds, clear_seconds}, after: {...}, note}` |
| GET | `/api/admin/venues/{slug}/export.csv` | `?kind=tickets|events` | CSV |
| POST | `/api/admin/rebuild-estimator` | `{slug?}` | `{ok, keys}` |

Analytics response:
```jsonc
{ "kpis": { "avg_wait_s", "p90_wait_s", "avg_service_s", "throughput_per_hour", "utilisation" (0-1), "no_show_rate",
            "abandonment_rate", "avg_queue_length", "prebook_share", "tickets" },
  "charts": { "queue_length": [{"t": iso, "v": 4}], "heatmap": {"days": ["Mon",..], "hours": [8..20], "values": [[avg_wait_s|null]]},
              "wait_hist": [{"bin": "0-5", "count": 12}], "pred_vs_actual": [{"p": 600, "a": 540}],
              "service_trend": [{"service": "Fee payment", "points": [{"t": iso, "v": 175}]}],
              "utilisation": [{"label": "Counter 1", "v": 0.82}] },
  "quality": { "mae_s", "mape", "coverage", "sigma_scale", "samples": {"Fee payment": 41}, "sentence": "Estimates are within 3 minutes 78% of the time" },
  "insights": ["Peak is 12:30–14:00 ...", ...] }
```

## Demo / simulator (no auth)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/sim/status` | | `{running, paused, speed, seed, virtual_now: iso, scenarios: [{id, name}], narration: [{ts, venue, text}], venues: [{slug, name, queue_length, eta_text, quality: {mae_s, coverage, n}, pred_vs_actual: [{p, a}], queue_series: [{t, v}], resources: [{label, status}]}]}` |
| POST | `/api/sim/start` | `{seed?, speed?}` | status |
| POST | `/api/sim/pause`, `/resume`, `/stop`, `/reset` | | status |
| POST | `/api/sim/speed` | `{speed: 1|10|60|300}` | status |
| POST | `/api/sim/scenario` | `{id: "lunch_rush"|"counter_closes"|"emergency"|"late_prebookings"|"quiet_afternoon"}` | status |
| POST | `/api/sim/inject` | `{venue_slug, type: "pause_resource"|"add_walkins"|"emergency", resource_id?}` | status |

## Server-Sent Events: `/api/venues/{slug}/stream`

Each message has `event:` and JSON `data:`; a `: heartbeat` comment every 20 s.
- `queue_update`: summary object (always)
- `board_update`: board object (always)
- `ticket_update`: TicketView, only when `?ticket=CODE` given, only for that ticket
- `resource_update`: console object, only with a valid staff `?token=`
Clients: reconnect with backoff 1, 2, 4 ... 15 s; after 2 failures poll the matching GET every 5 s and show "Live updates paused".

## Workplaces, themes and the two websites (v2)

Every venue now has a resolved `theme` in Venue and in `GET /api/venues` items:
```jsonc
{ "preset": "restaurant", "name": "Restaurant", "primary": "#B9472A", "accent": "#E9A23B",
  "bg": "#FBF7F2", "font": "elegant", "emoji": "🍽️" }
```
Fonts (frontend maps id -> Google Font + system fallback; must still look fine offline):
`modern` (Inter), `friendly` (Nunito), `elegant` (Playfair Display headings + Lato body), `clean` (DM Sans), `classic` (Merriweather).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/themes` | | `{presets: [{id, name, primary, accent, bg, font, emoji, description}], fonts: [{id, name, heading, body}]}` |
| GET | `/api/admin/templates` | | now also includes `restaurant`; each `{id, name, description, emoji, default_theme}` |
| POST | `/api/admin/venues` | `{name, template, slug?, theme?: {preset?, primary?, accent?, font?, emoji?}, staff_pin?, admin_pin?}` | `{venue, staff_pin, admin_pin, admin_session: {token, role, name, slug}, links: {customer, operator, staff, board, booking}, base_url}` (links are absolute URLs; slug auto-made from name if missing) |
| PATCH | `/api/admin/venues/{slug}` | `{name?, open_hours?, theme?}` | Venue |

GET `/api/venues` items also include `theme`, `template`, `emoji` and `service_point_count`.
Operator website root: `/op/{slug}` (login with admin PIN if no session). Customer website root: `/v/{slug}`.

## Operator accounts (v3)

Operators have accounts (name, email, password). Customers stay anonymous. Store the operator session in
localStorage key `qs_operator` = `{token, operator: {id, name, email}}`; send `Authorization: Bearer <token>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/operators/signup` | `{name, email, password}` (password >= 8 chars) | `{token, operator: {id, name, email}}`; 409 `EMAIL_TAKEN` |
| POST | `/api/operators/signin` | `{email, password}` | `{token, operator}`; 401 `WRONG_LOGIN`; 429 after 5 failed tries / 10 min |
| GET | `/api/operators/me` | operator token | `{operator, workplaces: [{slug, name, template, theme, emoji, open_now, queue_length, typical_eta, links: {customer, operator, staff, board, booking, guide}, created_at}]}` |
| POST | `/api/operators/workplaces/{slug}/session` | operator token (must own the workplace) | `{token, role: "ADMIN", name, slug}` = admin staff session; store with `auth.setStaff` then go to `/op/{slug}` (no PIN needed for the owner) |
| POST | `/api/admin/venues` | now REQUIRES an operator token; same body as v2 | same response; the workplace is owned by the operator |

Staff still use the workplace staff PIN at `/staff/{slug}`; an admin PIN still works at `/op/{slug}` for co-managers.

## Demo credentials (seeded venues)
Venues: `city-canteen`, `city-hospital`, `city-office`. Staff PIN `1234`, admin PIN `0000` for each.
