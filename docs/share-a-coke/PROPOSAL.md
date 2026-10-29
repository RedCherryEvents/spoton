# Share a Coke — Win R20,000: proposed changes

Status: **proposal, nothing built yet.** Based on an inspection of the live system on 2026-10-29.

## What exists today

| Spec item | Today | Gap |
|---|---|---|
| Keyword → campaign routing | Keyword automations; a first-message keyword now beats first-message flows | The live Coca-Cola automation contains-matches `COKE`, `Coke`, `Share`, so it already fires on "SHAREACOKE". It has to be replaced or narrowed. |
| Contact create/retrieve | Webhook creates or reuses the contact | none |
| Welcome → wait → validate → re-ask | Ask Question + Validate (regex, re-ask up to N times) | none |
| Record answer, link entry to campaign + contact | Campaign fields + Add Campaign Entry | The current Coke automation never saves the answer: its 5 live entries are all "In Progress" with no answer. |
| Keyword alone ≠ completed entry | Entries start "In Progress"; only "Completed" counts | Reports and exports must use **Completed** as the eligible list |
| Duplicate prevention | Duplicate rule per campaign (one per WhatsApp number, per number per day, unlimited). Open entry reused. | Migration 044 (DB-level "one open entry") written but **not applied** |
| Draft / Active / Closed | Draft / Active / Paused / Archived | **No "Closed"** status |
| Opening / closing dates | Fields + UI exist | **Not enforced**: entries are accepted outside the dates |
| Eligibility rules, entry limits | Entry limit = duplicate rule | Answer rule (e.g. minimum length) lives only in the automation |
| T&C URL | none | **Missing** |
| Entry list, search, filter, CSV | Entries tab: answers as columns, search, status/date filters, CSV / Excel / PDF export | none (filter Status = Completed for the eligible list) |
| Auditable winner selection | none | **Missing** |
| Winner notification only after approval | none | **Missing**; needs a Meta-approved template (none exists, only Meta's samples) |
| Test before activation | none: an automation is either live for everyone or off | **Missing** test-contacts mode |

## Proposed build

1. **Automation** (preset + setup script, saved as a draft):
   SHAREACOKE → entry added (In Progress) → welcome (spec text, plus the advert and the T&C link) → wait for the answer → validate (min length, not just the keyword) → re-ask if invalid → save answer → mark **Completed** → confirmation (spec text) → SPOT ON closing.
2. **Entry gate** in the engine, applied to every campaign: Add Campaign Entry refuses outside the campaign's dates, or when it isn't Active, and sends the campaign's "not open" message instead of silence. **Draft + test contacts**: while a campaign is Draft, only listed test numbers can enter. Their entries are tagged *test* and excluded from draws.
3. **Campaign settings**: T&C URL, test numbers, "not open" message, minimum answer length. New status **Closed**, with a migration.
4. **Winner selection** (admin only, only once Closed): a random draw from Completed, non-test, non-duplicate entries. Each draw records who ran it, when, the pool size, a hash of the pool and the random value used, in a new audit table. Re-draws are logged too.
5. **Winner notification**: a separate admin action after the draw, sending an approved template. It never runs automatically and no message promises a prize.

## Needs the organiser

Official T&Cs + URL, opening/closing dates, eligibility (age 18+, SA residents, employee exclusions), entry limit, draw method, prize fulfilment, brand authorisation, POPIA wording, and an approved WhatsApp winner template.
