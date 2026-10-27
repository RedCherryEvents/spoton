# OUTsurance (WhatsApp)

| | |
|---|---|
| Campaign | OUTsurance (code `OUTSURANCE`, keyword `SAVE`), active |
| Automation | OUTsurance — Welcome, active |
| WhatsApp number | +27 79 863 7339 (`27798637339`) |
| Entry link / QR destination | https://wa.me/27798637339?text=SAVE (unchanged) |
| QR files | `HOLLARDPAYD-whatsapp-qr.png` / `.svg`, still valid: they encode the link above. Also downloadable from the campaign's Settings tab. |
| Number customers are asked to save | OUTsurance **08 600 60 000** |

Formerly **Hollard Pay as You Drive**. On 2026-10-27 the same campaign, automation and flow were renamed in place, so the keyword, QR code and the 10 Hollard-era entries were kept. Those entries still show their old answers (request, car, area, current premium); new entries record **Name**.

Source: `src/lib/campaigns/presets/outsurance.ts`. Apply with `node scripts/setup-outsurance.mjs --apply --update-steps` (dry run without `--apply`). The script backs up the old steps and ends any reply waits that are still open.

## How it runs

1. Customer sends `SAVE` (any case; the whole message or its first word).
2. **Add Campaign Entry**: an open entry for the same contact is reused, never duplicated.
3. **One question**: *"Welcome to OUTsurance! 👋 Thank you for your interest. What's your name?"* (waits up to 24 hours).
4. If the reply has no letters, or is just `SAVE` again, the customer is asked again (up to 3 answers): *"Please reply with your name so OUTsurance can call you."*
5. Name saved on the entry, conversation assigned, then: *"Thanks {name}! Please save this number: 08 600 60 000. That's OUTsurance, and we will call you."*
6. The assigned agent is notified ("OUTsurance: call back"), the entry is marked **Completed**, and the standard SPOT ON closing is sent.

Every message replies to something the customer just sent, so all of them are inside WhatsApp's 24-hour window.

## Notes

- The Universal Welcome menu button is now **SAVE – OUTsurance**.
- **OUTsurance — Flow** (manual trigger) mirrors this conversation. It never starts on its own.
- Routing: in production, a first message of `SAVE` goes to this automation even when a first-message flow is on, and a reply to the name question can't be taken by a flow.
