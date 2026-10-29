import { describe, expect, it } from "vitest";
import {
  SHARE_A_COKE_ANSWER_PATTERN,
  SHARE_A_COKE_CAMPAIGN,
  SHARE_A_COKE_MESSAGES,
  shareACokeSteps,
  shareACokeTriggerConfig,
} from "./share-a-coke";
import { CAMPAIGN_CLOSING } from "./spoton-campaigns";
import { validateStepsForActivation, validateTriggerForActivation } from "@/lib/automations/validate";
import { keywordTextMatches } from "@/lib/automations/keyword-match";

const steps = shareACokeSteps("camp-coke");
const trigger = shareACokeTriggerConfig("camp-coke");

describe("Share a Coke preset", () => {
  it("is a draft campaign that needs T&Cs, one entry per number, with not-open and repeat replies", () => {
    expect(SHARE_A_COKE_CAMPAIGN.name).toBe("Share a Coke — Win R20,000");
    expect(SHARE_A_COKE_CAMPAIGN.status).toBe("draft");
    expect(SHARE_A_COKE_CAMPAIGN.settings).toMatchObject({ duplicate_rule: "whatsapp", terms_required: true });
    expect(SHARE_A_COKE_CAMPAIGN.settings.closed_message).toBeTruthy();
    expect(SHARE_A_COKE_CAMPAIGN.settings.duplicate_message).toBeTruthy();
  });

  it("passes the activation checks", () => {
    expect(validateTriggerForActivation("keyword_match", trigger)).toEqual([]);
    expect(validateStepsForActivation(steps)).toEqual([]);
  });

  it("fires on SHAREACOKE only, not on the old Coke keywords", () => {
    for (const yes of ["SHAREACOKE", "shareacoke", "ShareACoke please"]) expect(keywordTextMatches(trigger, yes)).toBe(true);
    for (const no of ["COKE", "WINCOKE", "share", "I want to share a coke"]) expect(keywordTextMatches(trigger, no)).toBe(false);
  });

  it("gates the entry first, then welcome, validated answer, Completed, confirmation, closing", () => {
    expect(steps.map((s) => s.step_type)).toEqual([
      "campaign_add_entry",
      "ask_question",
      "validate",
      "campaign_set_field",
      "campaign_set_status",
      "send_message",
      "send_message",
    ]);
    expect(steps[4].step_config).toEqual({ campaign_id: "camp-coke", status: "completed" });
    expect(steps.at(-1)!.step_config.text).toBe(CAMPAIGN_CLOSING);
  });

  it("uses the spec's welcome and confirmation wording, plus the T&C link and advert", () => {
    expect(SHARE_A_COKE_MESSAGES.welcome).toContain(
      "Welcome to Share a Coke! You could win R20,000! Tell us who you would share a Coke with and why. Reply with your answer to enter the competition. Terms and conditions apply",
    );
    expect(SHARE_A_COKE_MESSAGES.welcome).toContain("{{campaign.terms_url}}");
    expect(SHARE_A_COKE_MESSAGES.welcome).toContain("https://www.youtube.com/watch?v=0Ab-F7Y3IXc");
    expect(SHARE_A_COKE_MESSAGES.confirmation).toBe(
      "Thanks for entering Share a Coke! Your competition entry has been received. Good luck! Please refer to the official terms and conditions for eligibility, closing dates and winner selection.",
    );
  });

  it("valid answer: at least 10 characters and not the keyword", () => {
    const re = new RegExp(SHARE_A_COKE_ANSWER_PATTERN); // engine: no flags, trimmed input
    for (const ok of ["My mom, because she works so hard", "Thabo - my best friend", "abcdefghij"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["", "ok", "my mom", "SHAREACOKE", "share a coke"]) expect(re.test(bad)).toBe(false);
  });

  it("never announces a winner or promises the prize", () => {
    const all = Object.values(SHARE_A_COKE_MESSAGES).join(" ").toLowerCase();
    for (const phrase of ["you won", "you have won", "winner is", "congratulations", "you will receive"]) {
      expect(all).not.toContain(phrase);
    }
  });
});
