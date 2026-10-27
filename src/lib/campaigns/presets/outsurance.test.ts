import { describe, expect, it } from "vitest";
import {
  OUTSURANCE_CAMPAIGN,
  OUTSURANCE_MESSAGES,
  OUTSURANCE_NAME_PATTERN,
  outsuranceSteps,
  outsuranceTriggerConfig,
} from "./outsurance";
import { CAMPAIGN_CLOSING } from "./spoton-campaigns";
import { validateStepsForActivation, validateTriggerForActivation } from "@/lib/automations/validate";
import { keywordTextMatches } from "@/lib/automations/keyword-match";
import { buildWhatsAppEntryUrl } from "@/lib/campaigns/whatsapp-link";

const CAMPAIGN_ID = "camp-outsurance";
const steps = outsuranceSteps(CAMPAIGN_ID);
const trigger = outsuranceTriggerConfig(CAMPAIGN_ID);

describe("OUTsurance preset", () => {
  it("keeps the same keyword and QR destination as before", () => {
    expect(OUTSURANCE_CAMPAIGN.keyword).toBe("SAVE");
    expect(buildWhatsAppEntryUrl(OUTSURANCE_CAMPAIGN.settings.whatsapp_number, OUTSURANCE_CAMPAIGN.keyword)).toBe(
      "https://wa.me/27798637339?text=SAVE",
    );
  });

  it("passes the activation checks the API runs", () => {
    expect(validateTriggerForActivation("keyword_match", trigger)).toEqual([]);
    expect(validateStepsForActivation(steps)).toEqual([]);
  });

  it("fires on SAVE in any case, as the whole message or its first word", () => {
    for (const yes of ["SAVE", "save", "Save please"]) expect(keywordTextMatches(trigger, yes)).toBe(true);
    for (const no of ["I want to save money", "SAVED"]) expect(keywordTextMatches(trigger, no)).toBe(false);
  });

  it("asks exactly one question: their name", () => {
    const asks = steps.filter((s) => s.step_type === "ask_question");
    expect(asks).toHaveLength(1);
    expect(asks[0].step_config.text).toBe("Welcome to OUTsurance! 👋 Thank you for your interest. What's your name?");
    expect(asks[0].step_config.timeout_hours).toBe(24);
  });

  it("then gives the OUTsurance number and says they'll be called", () => {
    expect(OUTSURANCE_MESSAGES.callback).toBe(
      "Thanks {{vars.customer_name}}! Please save this number: 08 600 60 000. That's OUTsurance, and we will call you.",
    );
  });

  it("runs entry → name → save name → assign → callback → notify → complete → closing, all at the root", () => {
    expect(steps.map((s) => s.step_type)).toEqual([
      "campaign_add_entry",
      "ask_question",
      "validate",
      "campaign_set_field",
      "assign_conversation",
      "send_message",
      "notify_agent",
      "campaign_set_status",
      "send_message",
    ]);
    expect(steps.some((s) => s.branches)).toBe(false);
    expect(steps.at(-1)!.step_config.text).toBe(CAMPAIGN_CLOSING);
    expect(OUTSURANCE_MESSAGES.closing).toBe(CAMPAIGN_CLOSING);
  });

  it("accepts a name and re-asks when the reply is SAVE again or has no letters", () => {
    const re = new RegExp(OUTSURANCE_NAME_PATTERN); // same as the engine: no flags
    for (const ok of ["Danica", "Thabo Mokoena", "José", "save the date Sipho"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["SAVE", "save", "12345", "👍"]) expect(re.test(bad)).toBe(false);
  });

  it("never mentions Hollard or claims a quote, approval or purchase", () => {
    const all = Object.values(OUTSURANCE_MESSAGES).join(" ").toLowerCase();
    expect(all).not.toContain("hollard");
    for (const word of ["quote", "approved", "purchased", "premium", "policy is"]) expect(all).not.toContain(word);
  });
});
