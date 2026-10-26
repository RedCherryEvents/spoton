import { describe, expect, it } from "vitest";
import {
  HOLLARD_PAYD_CAMPAIGN,
  HOLLARD_PAYD_FIELDS,
  HOLLARD_PAYD_INFO_QUESTIONS,
  HOLLARD_PAYD_MESSAGES,
  HOLLARD_PAYD_REPLY_PATTERN,
  hollardPaydSteps,
  hollardPaydTriggerConfig,
} from "./hollard-payd";
import {
  validateStepReferences,
  validateStepsForActivation,
  validateTriggerForActivation,
} from "@/lib/automations/validate";
import { keywordTextMatches } from "@/lib/automations/keyword-match";
import { buildWhatsAppEntryUrl } from "@/lib/campaigns/whatsapp-link";

const CAMPAIGN_ID = "camp-hollard";
const steps = hollardPaydSteps(CAMPAIGN_ID);
const trigger = hollardPaydTriggerConfig(CAMPAIGN_ID);

describe("Hollard Pay as You Drive preset", () => {
  it("starts as a draft campaign whose QR destination is the full wa.me link", () => {
    expect(HOLLARD_PAYD_CAMPAIGN.status).toBe("draft");
    expect(
      buildWhatsAppEntryUrl(HOLLARD_PAYD_CAMPAIGN.settings.whatsapp_number, HOLLARD_PAYD_CAMPAIGN.keyword),
    ).toBe("https://wa.me/27798637339?text=SAVE");
  });

  it("passes the same activation checks the API runs", () => {
    expect(validateTriggerForActivation("keyword_match", trigger)).toEqual([]);
    expect(validateStepsForActivation(steps)).toEqual([]);
  });

  it("adds the entry first and sends the exact welcome second", () => {
    expect(steps[0]).toEqual({ step_type: "campaign_add_entry", step_config: { campaign_id: CAMPAIGN_ID } });
    expect(steps[1].step_type).toBe("ask_question");
    expect(steps[1].step_config.text).toBe(
      "Welcome to Hollard Pay as You Drive! Thank you for your interest in car insurance based on how much you drive. Reply INFO to learn more or HELP if you need assistance with your enquiry.",
    );
    // Reply wait stays inside the 24-hour customer-service window.
    expect(steps[1].step_config.timeout_hours).toBe(24);
  });

  it("can't be activated while its campaign is still a draft", () => {
    expect(
      validateStepReferences(steps, {
        flows: [],
        campaigns: [{ id: CAMPAIGN_ID, name: "Hollard Pay as You Drive", status: "draft" }],
      }),
    ).toEqual([
      {
        path: "steps[0].campaign_id",
        message:
          'campaign "Hollard Pay as You Drive" is draft, activate the campaign first or pick another campaign',
      },
    ]);
    expect(
      validateStepReferences(steps, {
        flows: [],
        campaigns: [{ id: CAMPAIGN_ID, name: "Hollard Pay as You Drive", status: "active" }],
      }),
    ).toEqual([]);
  });

  it("fires on SAVE in any case, as the whole message or its first word", () => {
    expect(keywordTextMatches(trigger, "SAVE")).toBe(true);
    expect(keywordTextMatches(trigger, "save")).toBe(true);
    expect(keywordTextMatches(trigger, "Save please")).toBe(true);
    expect(keywordTextMatches(trigger, "I want to save money")).toBe(false);
    expect(keywordTextMatches(trigger, "SAVED")).toBe(false);
  });

  it("accepts INFO / HELP replies and re-prompts on anything else", () => {
    const re = new RegExp(HOLLARD_PAYD_REPLY_PATTERN);
    for (const ok of ["INFO", "info", "Info please", "HELP", "help me", "I need help"]) {
      expect(re.test(ok)).toBe(true);
    }
    for (const bad of ["hello", "information", "SAVE", "", "helpful"]) {
      expect(re.test(bad)).toBe(false);
    }
  });

  it("routes INFO and HELP down separate branches that record, assign, notify and close", () => {
    const cond = steps[3];
    expect(cond.step_config).toEqual({ subject: "message_content", operand: "info" });
    const routing = ["add_note", "assign_conversation", "send_message", "notify_agent", "send_message"];
    expect(cond.branches!.yes!.map((s) => s.step_type)).toEqual([
      "campaign_set_field",
      ...Array(3).fill(["ask_question", "campaign_set_field"]).flat(),
      ...routing,
    ]);
    expect(cond.branches!.no!.map((s) => s.step_type)).toEqual(["campaign_set_field", ...routing]);
    expect(cond.branches!.yes![0].step_config).toEqual({ field_key: "request", value: "INFO" });
    expect(cond.branches!.no![0].step_config).toEqual({ field_key: "request", value: "HELP" });
  });

  it("INFO asks for their car, where they live and what they pay now, saving each answer", () => {
    const info = steps[3].branches!.yes!;
    const asks = info.filter((s) => s.step_type === "ask_question").map((s) => s.step_config);
    expect(asks.map((a) => a.text)).toEqual(HOLLARD_PAYD_INFO_QUESTIONS.map((q) => q.text));
    expect(asks.every((a) => a.timeout_hours === 24)).toBe(true);
    expect(String(asks[0].text)).toMatch(/car do you drive/);
    expect(String(asks[1].text)).toMatch(/Where do you live/);
    expect(String(asks[2].text)).toMatch(/currently pay/);
    // Each answer is saved right after its question, into a defined field.
    const fieldKeys = new Set(HOLLARD_PAYD_FIELDS.map((f) => f.key));
    HOLLARD_PAYD_INFO_QUESTIONS.forEach((q, i) => {
      const save = info[2 + i * 2];
      expect(save).toEqual({ step_type: "campaign_set_field", step_config: { field_key: q.key, value: `{{vars.${q.var_key}}}` } });
      expect(fieldKeys.has(q.key)).toBe(true);
    });
    // The agent sees the answers in the note and notification.
    const note = info.find((s) => s.step_type === "add_note")!.step_config.text as string;
    const notify = info.find((s) => s.step_type === "notify_agent")!.step_config.body as string;
    for (const q of HOLLARD_PAYD_INFO_QUESTIONS) {
      expect(note).toContain(`{{vars.${q.var_key}}}`);
      expect(notify).toContain(`{{vars.${q.var_key}}}`);
    }
  });

  it("both branches end with the standard SPOT ON closing (nothing after the condition)", () => {
    expect(steps).toHaveLength(4);
    for (const branch of ["yes", "no"] as const) {
      expect(steps[3].branches![branch]!.at(-1)).toEqual({
        step_type: "send_message",
        step_config: {
          text: "Thanks for entering! 🎉\nWant to stay up to date with more competitions, news and opportunities?\nJoin the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r",
        },
      });
    }
    expect(validateStepsForActivation(steps)).toEqual([]);
  });

  it("never claims a quote, approval or purchase", () => {
    const all = [...Object.values(HOLLARD_PAYD_MESSAGES)].join(" ").toLowerCase();
    for (const word of ["quote", "quoted", "approved", "purchased", "covered", "policy is", "premium"]) {
      expect(all).not.toContain(word);
    }
  });
});
