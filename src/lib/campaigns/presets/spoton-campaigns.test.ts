import { describe, expect, it } from "vitest";
import {
  BMW_FIELDS,
  CAMPAIGN_CLOSING,
  CAMPAIGN_FLOWS,
  UNIVERSAL_WELCOME_BODY,
  UNIVERSAL_WELCOME_BUTTONS,
  bmwSteps,
  universalWelcomeSteps,
  bmwTriggerConfig,
  type PresetStep,
} from "./spoton-campaigns";
import { OUTSURANCE_MESSAGES, OUTSURANCE_NAME_VAR, outsuranceTriggerConfig } from "./outsurance";
import { shareACokeTriggerConfig } from "./share-a-coke";
import { validateStepsForActivation, validateTriggerForActivation } from "@/lib/automations/validate";
import { keywordTextMatches } from "@/lib/automations/keyword-match";
import { validateFlowForActivation } from "@/lib/flows/validate";

const CAMPAIGN = "camp-bmw";
const steps = bmwSteps(CAMPAIGN);

/** Every path from the root to a leaf, as step lists. */
function paths(tree: PresetStep[], prefix: PresetStep[] = []): PresetStep[][] {
  const out: PresetStep[][] = [];
  for (let i = 0; i < tree.length; i++) {
    const s = tree[i];
    if (s.branches) {
      const before = [...prefix, ...tree.slice(0, i + 1)];
      for (const b of [s.branches.yes ?? [], s.branches.no ?? []]) out.push(...paths(b, before));
      return out;
    }
  }
  return [[...prefix, ...tree]];
}

describe("standard closing", () => {
  it("is the exact SPOT ON channel message, and OUTsurance uses the same text", () => {
    expect(CAMPAIGN_CLOSING).toBe(
      "Thanks for entering! 🎉\nWant to stay up to date with more competitions, news and opportunities?\nJoin the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r",
    );
    expect(OUTSURANCE_MESSAGES.closing).toBe(CAMPAIGN_CLOSING);
  });
});

describe("BMW test-drive automation", () => {
  it("passes the activation checks the API runs", () => {
    expect(validateTriggerForActivation("keyword_match", bmwTriggerConfig(CAMPAIGN))).toEqual([]);
    expect(validateStepsForActivation(steps)).toEqual([]);
  });

  it("fires on BMWTEST2026 or BMW as the message or its first word only", () => {
    const t = bmwTriggerConfig(CAMPAIGN);
    for (const yes of ["BMWTEST2026", "bmw", "BMW please"]) expect(keywordTextMatches(t, yes)).toBe(true);
    for (const no of ["my BMW broke", "BMWX5"]) expect(keywordTextMatches(t, no)).toBe(false);
  });

  it("adds the entry first", () => {
    expect(steps[0]).toEqual({ step_type: "campaign_add_entry", step_config: { campaign_id: CAMPAIGN } });
  });

  it("every path completes the entry and ends with the closing", () => {
    const all = paths(steps);
    expect(all).toHaveLength(3);
    for (const p of all) {
      expect(p.at(-2)).toEqual({ step_type: "campaign_set_status", step_config: { campaign_id: CAMPAIGN, status: "completed" } });
      expect(p.at(-1)).toEqual({ step_type: "send_message", step_config: { text: CAMPAIGN_CLOSING } });
    }
  });

  it("records every value it writes in a defined campaign field", () => {
    const keys = new Set(BMW_FIELDS.map((f) => f.key));
    const written = paths(steps)
      .flat()
      .filter((s) => s.step_type === "campaign_set_field")
      .map((s) => String(s.step_config.field_key));
    for (const k of written) expect(keys.has(k)).toBe(true);
  });
});

describe("campaign flows", () => {
  it.each(CAMPAIGN_FLOWS.map((f) => [f.name, f] as const))("%s passes flow activation checks", (_name, flow) => {
    const errors = validateFlowForActivation(flow, flow.nodes).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("are manual-trigger, so they can't intercept a campaign keyword", () => {
    for (const f of CAMPAIGN_FLOWS) expect(f.trigger_type).toBe("manual");
  });

  it("every flow sends the closing as its last message", () => {
    for (const f of CAMPAIGN_FLOWS) {
      const closing = f.nodes.find((n) => n.node_key === "closing")!;
      expect(closing.config.text).toBe(CAMPAIGN_CLOSING);
      const next = f.nodes.find((n) => n.node_key === closing.config.next_node_key)!;
      expect(["end", "handoff"]).toContain(next.node_type);
    }
  });
});

describe("OUTsurance flow", () => {
  it("asks only for their name, then sends the same callback message as the automation", () => {
    const flow = CAMPAIGN_FLOWS.find((f) => f.campaign_code === "OUTSURANCE")!;
    const asks = flow.nodes.filter((n) => n.node_type === "collect_input");
    expect(asks.map((n) => n.config.var_key)).toEqual([OUTSURANCE_NAME_VAR]);
    expect(flow.nodes.find((n) => n.node_key === "callback")!.config.text).toBe(OUTSURANCE_MESSAGES.callback);
  });
});

describe("Universal Welcome", () => {
  const steps = universalWelcomeSteps("tag-welcomed");
  // Live trigger configs of the campaign automations the buttons point at.
  const triggers = {
    SAVE: outsuranceTriggerConfig("camp-o"),
    SHARE: shareACokeTriggerConfig("camp-c"),
    WINICC2027: { keywords: ["WINICC2027"], match_type: "contains" as const },
  };

  it("passes the activation checks", () => {
    expect(validateTriggerForActivation("new_message_received", {})).toEqual([]);
    expect(validateStepsForActivation(steps)).toEqual([]);
  });

  it("only sends to contacts without the welcomed tag, and doesn't wait for a reply", () => {
    const cond = steps[0];
    expect(cond.step_config).toEqual({ subject: "tag_presence", operand: "tag-welcomed" });
    expect(cond.branches!.yes!.map((s) => s.step_type)).toEqual(["end"]);
    expect(cond.branches!.no!.map((s) => s.step_type)).toEqual(["send_buttons", "add_tag"]);
    expect(cond.branches!.no![0].step_config).not.toHaveProperty("wait_for_reply");
  });

  it("each button fires its own campaign's automation and no other", () => {
    for (const b of UNIVERSAL_WELCOME_BUTTONS) {
      expect(b.title.length).toBeLessThanOrEqual(20);
      for (const [keyword, trigger] of Object.entries(triggers)) {
        expect(keywordTextMatches(trigger, b.title)).toBe(keyword === b.keyword);
      }
    }
  });

  it("has no dead instructions or campaign-entry claims", () => {
    expect(UNIVERSAL_WELCOME_BODY).not.toMatch(/START|officially in|Red Cherry/);
  });
});
