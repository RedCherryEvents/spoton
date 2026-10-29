# Share a Coke — Win R20,000 (WhatsApp competition)

| | |
|---|---|
| Campaign | Share a Coke — Win R20,000 (code `SHAREACOKE`, keyword `SHAREACOKE`), **Draft** |
| Automation | Share a Coke — Win R20,000, **off** |
| Entry link | https://wa.me/27798637339?text=SHAREACOKE (QR on the campaign's Settings tab) |
| Advert | https://www.youtube.com/watch?v=0Ab-F7Y3IXc |
| Entry limit | One per WhatsApp number (repeats are kept as **Duplicate** and get the repeat reply) |
| Valid answer | At least 10 characters and not just the keyword; asked again up to 3 times |
| Winner | Audited random draw from Completed, non-test entries, only after **Closed** |

Converted in place from the Coca-Cola Summer Competition on 2026-10-29: same campaign, automation and flow rows, with the 5 earlier entries kept (In Progress, not eligible). The old keywords (COKE, WINCOKE, SHARECOKE2026, Coke, Share) no longer reply. Source: `src/lib/campaigns/presets/share-a-coke.ts`. Apply with `node scripts/setup-share-a-coke.mjs --apply`; it backs up, keeps everything draft/off, and sends nothing. See `PROPOSAL.md` for the spec-to-system mapping.

## Customer journey

1. `SHAREACOKE` → **Add Campaign Entry**. Status, opening/closing dates, test numbers and the one-entry rule are all checked here, before any message is sent:
   - not open (paused / closed / outside its dates): the *not-open* reply, nothing else; while Draft, no reply at all for non-test numbers
   - already entered: the *repeat* reply, nothing else
2. Welcome (spec wording + the T&C link + the advert), then wait up to 24 hours for the answer.
3. The answer is validated (≥10 characters, not the keyword); if invalid, the customer is asked again.
4. The answer is saved to the entry (**Who and why**), the entry is marked **Completed** (this is the eligible list), then the confirmation (spec wording) and the SPOT ON closing.

The keyword alone never completes an entry. Nothing announces a winner or promises the prize.

## Admin

- **Settings → Competition**: T&C link (required before activation), test numbers, the not-open reply and the repeat reply. **Settings → Campaign period**: opening and closing dates, now enforced.
- **Entries**: participant, answer, timestamp, status (Completed = eligible; Duplicate / Invalid / Disqualified excluded), search, filters, CSV / Excel / PDF export.
- **Close** (header button): stops entries and enables the draw.
- **Winner tab** (admins): *Run random draw* records the pool of entry ids, its sha256 hash, the random index (crypto-secure) and who ran it, and never contacts anyone. *Notify winner* is a separate admin action that sends an **approved WhatsApp template** once per draw, recorded with the template and message id.

## Test before launch

1. Apply migrations **044** and **045** in the Supabase SQL editor.
2. Deploy (the gate, settings, Close and Winner tab are code changes).
3. Settings → Competition → add your **test numbers**. Then Automations → switch **Share a Coke** on. The campaign stays Draft, so only test numbers get a reply.
4. From a test phone: `SHAREACOKE` → welcome; reply `ok` → asked again; reply a real sentence → confirmation; the entry is **Completed** and marked *test*. Send `SHAREACOKE` again → repeat reply, and the second row is Duplicate.

## Launch checklist (organiser)

- [ ] Official T&Cs approved and published, and the link added in Settings
- [ ] Opening and closing dates set
- [ ] Eligibility (e.g. 18+, SA residents, employee exclusions) written into the T&Cs
- [ ] Entry limit (one per number) and draw method confirmed
- [ ] Prize fulfilment process agreed
- [ ] Coca-Cola brand authorisation, plus Consumer Protection Act (s36) and POPIA review
- [ ] Winner notification template created and **approved by Meta**
- [ ] Campaign → **Activate**. Add the menu button back (`SHAREACOKE – Coke`) if wanted.
