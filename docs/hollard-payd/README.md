# Hollard Pay as You Drive (WhatsApp)

| | |
|---|---|
| Campaign | Hollard Pay as You Drive (code `HOLLARDPAYD`, keyword `SAVE`), **draft** |
| Automation | Hollard — Pay as You Drive Welcome, **inactive** |
| WhatsApp number | +27 79 863 7339 (`27798637339`) |
| Entry link / QR destination | https://wa.me/27798637339?text=SAVE |
| QR files | `HOLLARDPAYD-whatsapp-qr.png`, `HOLLARDPAYD-whatsapp-qr.svg` (also downloadable from the campaign's Settings tab) |

Created by `node scripts/setup-hollard-payd.mjs --apply`, which is safe to re-run (it never duplicates or activates anything). Without `--apply` it only runs the checks.

## How it runs

1. Customer sends `SAVE` (any case; the whole message or its first word).
2. **Add Campaign Entry** → Hollard Pay as You Drive. An open entry for the same contact is reused, never duplicated (migration 044 enforces this in the database too).
3. **Ask Question**: the welcome message. Waits up to 24 hours for the reply.
4. **Validate** the reply contains INFO or HELP. Anything else gets: *"Sorry, we didn't catch that. Please reply INFO … or HELP …"*, up to 3 answers in total.
5. **INFO**: records `Customer request` = INFO, then asks three questions, each waiting up to 24 hours: *Which car do you drive?*, *Where do you live?*, *How much do you currently pay for car insurance per month?* (NONE if uninsured). Each answer is saved on the entry (fields `vehicle`, `area`, `current_premium`) and shown in the contact note and the agent notification. Then it assigns the conversation, sends the acknowledgement and the SPOT ON closing.
6. **HELP**: records `Customer request` = HELP, adds a note, assigns, acknowledges, notifies, and sends the closing.

Every message replies to something the customer just sent, so all of them are inside WhatsApp's 24-hour customer-service window and no template is needed. No message mentions a quote, approval or purchase.

Repeated `SAVE`: while the welcome is waiting for a reply, `SAVE` gets the short INFO/HELP prompt, not a second welcome and not a second entry. After the customer has answered, a new `SAVE` reuses the same entry and sends the welcome again so they can choose again.

## Before activating (required)

1. ~~Lead capture flow~~ **Done 2026-10-26:** paused (status `draft`). It took every new contact's first message, so a first-time `SAVE` never reached this automation (or WINICC2027 / Coca-Cola). New contacts without a keyword now get the "SPOTON — Universal Welcome" automation. To undo, activate it again under Flows. The one Lead capture run still in progress (started 2026-10-21, stuck at the email question) was ended the same way the flows cron does it: status `timed_out`, end_reason `ended_manually_flow_paused`, plus a `timeout` event. No message was sent. That contact's messages now go to automations again.
2. ~~FAQ bot flow~~ **Done 2026-10-26:** keywords changed from `faq, question, info` to `faq, question`, so an `INFO` reply reaches the Hollard automation.
3. **Routing**: the INFO/HELP branches use *Assign conversation → round robin*, which today resolves to the account's only member (SPOT ON). If a Hollard enquiry agent or team is added to the account, switch both Assign steps to *specific* and pick them.
4. **Migration 044** (`supabase/migrations/044_campaign_entries_one_open.sql`) must be applied to the database.
5. Activate the **campaign first**, then the automation. The app now refuses to activate an automation whose Add Campaign Entry points at a draft campaign.

## Test after activating

1. Scan the QR code with a phone that has **never messaged** the number (or after step 1 above). WhatsApp should open on +27 79 863 7339 with `SAVE` typed.
2. Send it. Expect the welcome; the campaign's Entries tab shows one In Progress entry.
3. Reply `hello` → INFO/HELP prompt. Reply `INFO` → acknowledgement; the entry's *Customer request* is INFO; the conversation is assigned and a notification arrives.
4. Send `SAVE` again → still one open entry.

## Implementation report (2026-10-26)

**Verified live (read-only):** Meta reports +27 79 863 7339 as phone_number_id `1429294730258072`, CONNECTED, Cloud API, quality GREEN, and its WABA is subscribed to the SPOTON app. It is the account's configured `whatsapp_config`. Inbound messages are arriving (latest 2026-10-26 09:59 UTC) and keyword automations on it ran on 2026-10-21. The wa.me link redirects to `api.whatsapp.com/send/?phone=27798637339&text=SAVE`. The QR rendered in the app decodes to the full link (checked with jsQR and the browser's BarcodeDetector).

**Not verified:** a live SAVE → welcome round trip. Nothing is active, and the two flows above would intercept it today.

**Created in the database** (by the setup script, account resolved from the number): the campaign (draft), its `request` field, and the automation (inactive, 14 steps). Existing campaigns and automations were not modified.

**Code changes**
- `src/lib/campaigns/whatsapp-link.ts`: wa.me link builder (number normalising, first keyword as the prefill).
- `src/components/campaigns/whatsapp-entry-card.tsx` and `settings-tab.tsx`: entry link + QR card with copy / open / PNG / SVG download. Uses the new `qrcode` dependency. `settings.whatsapp_number` is stored on the campaign, normalised and validated in `PATCH /api/campaigns/[id]`.
- `src/lib/campaigns/presets/hollard-payd.ts` and `scripts/setup-hollard-payd.mjs`: campaign + automation spec, and the idempotent setup script.
- `src/lib/automations/validate.ts` and `validate-refs.ts`: activation now rejects unsupported condition subjects, and Add Campaign Entry steps whose campaign is missing or not active, with messages that name the problem. Missing or inactive flow IDs were already reported.
- `src/lib/automations/engine.ts`: a reply wait past its timeout is expired instead of resumed. The expiry cron is not running in production (a wait from 21 Oct that expired on 23 Oct was still pending), so stale waits were capturing customers' later messages.
- `supabase/migrations/044_campaign_entries_one_open.sql`: one open entry per contact per campaign, enforced by a partial unique index. It skips with a notice if existing data has duplicates (none today). **Not applied yet.**

**Tests:** 1006 passing (`npx vitest run`), including new tests for the link and QR content, the preset, the validation rules, and the full engine path: SAVE → entry then welcome; INFO / HELP / other replies; repeated SAVE while waiting; reused entry; expired wait. `npm run typecheck` and `npm run build` are clean.

## Update 2026-10-26: INFO questions

Added the three INFO questions above, live, with the automation kept on (`node scripts/setup-hollard-payd.mjs --apply --update-steps`). The previous steps are in `automation-steps-before-*.json`, kept locally and not committed. The closing message moved from after the INFO/HELP split into the end of each branch: after a question inside a branch, the engine finishes that branch but does not continue past it.

The **Hollard Pay as You Drive — Flow** preset has the same questions. The live copy was not refreshed because it was switched on at 10:57. It has a manual trigger and nothing starts it, so it never runs.

**Live risk:** at 10:57 the **Welcome menu** flow (keyword "Hi", contains) and the **Lead capture** flow (first message) were switched on again. Flows take messages before automations, including before an automation's pending question. So an answer like "Toyota Hilux" starts Welcome menu instead of being saved, and a brand-new customer's SAVE goes to Lead capture.

**Resolved (same day):** Lead capture and Welcome menu are paused again (status `draft`), and neither had a run in progress. Still active: FAQ bot (keywords `faq`, `question`) and the four campaign flows, which have manual triggers and never start on their own. Pausing is reversible under Flows. Don't switch either flow back on while campaigns rely on keywords and questions, unless its trigger is narrowed first, for example Welcome menu matching "Hi" as an exact word instead of contains.
