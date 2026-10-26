# Campaign cleanup, 2026-10-26

Every campaign automation now ends with the standard SPOT ON closing:

> Thanks for entering! 🎉
> Want to stay up to date with more competitions, news and opportunities?
> Join the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r

`backup-before.json` holds every campaign, automation and automation step as they were before these changes. It is kept locally and not committed, because it contains live database IDs.

## Live changes

| Campaign | What changed |
|---|---|
| **Hollard Pay as You Drive** | Campaign **activated**. The automation had been switched on while the campaign was a draft, so the 10:35 SAVE test failed with "campaign is draft". Closing added after the INFO/HELP branches. |
| **WINICC2027** (active) | Welcome and closing sent literal " / ", now real line breaks. The closing's `{{ entry.reference }}` was always blank (no step generates a reference), so it was removed and the closing now uses the standard text. Stray `"` removed from the question. Duplicate "set entry status → completed" step removed. |
| **Coca-Cola** (active) | Closing added as the last step. Blank `{{ entry.reference }}` removed from the start of the thank-you message. Keyword `WINCOKE` added to the automation (it already fired via "Coke" contains-matching; now it's explicit). |
| **BMW Test Drive** (automation off, campaign draft) | Rebuilt: entry first; one welcome with 3 buttons (Book a test drive / BMW information / Contact BMW team); invalid replies re-prompted; test drive asks for model & area; each choice is recorded (new fields `interest`, `test_drive_details`), noted, assigned and notified; entry completed; closing. Triggers on `BMWTEST2026` or `BMW` as the message or its first word. **Still off.** |
| **All campaigns** | WhatsApp number 27798637339 saved, so the Settings tab's entry link / QR card works once the new code is deployed. |

## New draft flows (manual trigger)

Coca-Cola Summer Competition — Flow · WINICC2027 — Flow · BMW Test Drive Experience — Flow · Hollard Pay as You Drive — Flow

Each mirrors its automation's conversation and ends with the closing. They are **drafts with a manual trigger**, so they can't intercept a keyword. Flows have no "add campaign entry" node, so the automation must stay the entry point. To use a flow, keep the automation's Add Campaign Entry step, replace its conversation steps with a **Start Flow** step pointing at the flow, then activate the flow.

## Not changed

- **Shell** has no automation, so it has no closing and no flow. Its code `Shell 2026` contains a space, which ends up in entry references.
- Keywords edited in the app during this work were kept: Hollard `Save` (redundant, matching is case-insensitive) and Coca-Cola `Share` (contains-matching, so any message containing "share" starts the Coca-Cola automation).

## Code

`src/lib/campaigns/presets/spoton-campaigns.ts` (closing, BMW automation, flows) with tests. Applied with `scripts/setup-campaign-drafts.mjs`, which is idempotent and never activates anything. The Hollard preset gained the closing step too.

## SPOTON — Universal Welcome (rebuilt, still active)

The catch-all for messages that match no keyword. `universal-welcome-before-*.json` is the backup, kept locally and not committed.

| Before | After |
|---|---|
| Menu buttons waited for a reply with no steps after them, so the customer's next message (a tap, or a typed keyword like SAVE) was swallowed and nothing happened. | No wait. A tap arrives with the button title as its text, so it fires that campaign's keyword automation. |
| Sent on every unmatched message, including mid-conversation with an agent. | Once per contact: skipped if the contact has the tag **SPOT ON welcomed**, which is added after the menu is sent. |
| "Welcome to Red Cherry! You're officially in… Reply START…" (nobody had entered anything, and nothing handles START). Two messages. | One message: "Welcome to SPOT ON! 👋 We have a few deals and competitions running right now. Tap one below to enter, or send its keyword at any time." |
| Buttons WINICC2027 / WINCOKE / BMW (BMW automation is off). | **SAVE – Hollard**, **WINCOKE – Coca-Cola**, **WINICC2027 – ICC**. Tests check each title fires its own campaign and no other. |
| `agent_id` in the trigger (ignored for this trigger type). | Removed. |

One stale reply wait from 2026-10-21 was expired; it was holding one contact's next message. Contacts who saw the old menu will get the new one once, since nobody has the tag yet. To show someone the menu again, remove the tag from their contact. Source: `UNIVERSAL_WELCOME` in `src/lib/campaigns/presets/spoton-campaigns.ts`, applied by `scripts/setup-universal-welcome.mjs`.

## Routing fix: keywords beat first-message flows (code, needs deploy)

**What happened:** a new contact sent SAVE at 13:53 SAST. Lead capture had been switched back on at 12:57, and flows get a contact's first message before keyword automations, so Lead capture ran (name / email / company) and Hollard never did. This is not Meta behaviour.

**Change** (`src/app/api/whatsapp/webhook/route.ts`, `src/lib/flows/engine.ts`, `src/lib/automations/engine.ts`): before a flow may *start* a run, the webhook checks two things:
- If the first message matches an active keyword automation (SAVE, WINCOKE, WINICC2027, …), no first-message flow starts, so the keyword goes to its campaign. Keyword flows can still start, as before.
- If the contact is answering an automation's question (an open, unexpired reply wait), no flow starts, so the answer reaches the automation. This also covers "Toyota Hilux" vs the Welcome menu "Hi" keyword.

A flow run already in progress still advances as before. Tests: `src/lib/flows/dispatch.test.ts`, `src/app/api/whatsapp/webhook/route.test.ts`, `src/lib/automations/engine.test.ts`.

**Until this is deployed**, keep Lead capture and Welcome menu paused. Once it's deployed, Lead capture can be switched on again: new contacts who send a keyword go to the campaign, and everyone else gets Lead capture.
