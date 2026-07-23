# Notification email field maps

Per-portal parsing guidance for the `email` connector. Templates drift — when a
message matches the sender but not the field map, quarantine it and log a
`parsing_error` warning rather than guessing. Keep this file updated as
templates change; record template revisions in the table at the bottom.

## MERX (`*@merx.com`)

| Field | Where to find it |
| --- | --- |
| Notification type | Subject prefix — "New Opportunity", "Amendment", "Reminder" |
| Title | Subject after the prefix; repeated as the first bold line / link text in the body |
| Solicitation number | Body line labelled "Solicitation Number" / "Reference" |
| Buyer | Body line labelled "Organization" / "Buyer" |
| Publication date | Body line "Published" (may be absent) |
| Closing date | Body line "Closing Date" (may be absent in category digests) |
| Working category | The saved-search / working-category name in the body footer |
| Source URL | The primary "View Opportunity" link — strip tracking query params to canonicalize |

Notes: category-digest emails contain multiple opportunities — parse each row as a
separate record. Amendment notices carry the same solicitation number; route to
tender-monitor.

## SaskTenders (`*@sasktenders.ca`, GEM senders)

| Field | Where |
| --- | --- |
| Competition number | Subject and body ("Competition #") |
| Title | Subject / first body heading |
| Issuing organization | Body "Organization" |
| Closing | Body "Closing Date" with time and CST/CSK timezone — preserve offset |
| Status | Body "Status" when present |
| Source URL | "View Competition" link |

Notes: notices may redirect to GEM, Bonfire, or SAP Ariba — capture the external
link as a `role: submission` source block. Login may be required for documents:
set `documents.login_required: true`.

## bids&tenders (`*@bidsandtenders.ca` and buyer-branded senders)

| Field | Where |
| --- | --- |
| Title | Subject / body heading |
| Buying organization | Sender display name and body header |
| Bid type | Body "Bid Type" (RFP/RFT/RFQ/EOI…) |
| Status | Body "Status" |
| Closing date | Body "Closing Date" |
| Document fee | Body fee note when present |
| Source URL | "View Bid" / "Bid Details" link |

Notes: buyer-branded sender domains vary; match on the bidsandtenders link
domain in the body, not only the sender. Registration may be required for
documents and submission.

## CanadaBuys (`*@canadabuys.canada.ca`) — email fallback

| Field | Where |
| --- | --- |
| Notice id | Link slug / body "Solicitation number" |
| Title | Subject / body heading |
| Organization | Body "Contracting entity" |
| Closing | Body "Closing date" with timezone |
| Source URL | Notice link |

Feed connector is primary for CanadaBuys; email records must dedupe against
feed-discovered tenders by notice id before creating anything.

## Template revision log

| Date | Portal | Change | Parser version |
| --- | --- | --- | --- |
| 2026-07-21 | all | Initial field maps | */1.0 |
