import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    logInserts: [] as Record<string, unknown>[],
    logUpdates: [] as Record<string, unknown>[],
    pendingInserts: [] as Record<string, unknown>[],
    pendingRow: null as Record<string, unknown> | null,
    profiles: [] as Record<string, unknown>[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
    single?: boolean;
  }) {
    const { table, type } = ops;
    if (table === "automation_pending_executions") {
      if (type === "insert") {
        state.pendingInserts.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      // hasOpenReplyWait: list query filtered on run_at > now
      const gt = ops.filters.find(([op, k]) => op === "gt" && k === "run_at");
      if (gt) {
        const row = state.pendingRow;
        return { data: row && String(row.run_at) > String(gt[2]) ? [row] : [], error: null };
      }
      // claim (update … select id) and lookup both read the parked row
      if (type === "update") return { data: state.pendingRow ? { id: state.pendingRow.id } : null, error: null };
      return { data: state.pendingRow, error: null };
    }
    if (table === "automations" && ops.single) {
      return { data: state.automations[0] ?? null, error: null };
    }
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") {
      // honour the trigger_type filter like the real query does
      const tt = ops.filters.find(([op, k]) => op === "eq" && k === "trigger_type");
      return {
        data: tt ? state.automations.filter((a) => a.trigger_type === tt[2]) : state.automations,
        error: null,
      };
    }
    if (table === "profiles") return { data: state.profiles, error: null };
    if (table === "automation_logs") {
      if (type === "insert") {
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: "log1" }, error: null };
      }
      if (type === "update") {
        state.logUpdates.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") {
      // honour executeStepsFrom's `.gte('position', start)` so a resumed
      // run starts after the parked step
      const gte = ops.filters.find(([op, k]) => op === "gte" && k === "position");
      const from = gte ? Number(gte[2]) : -Infinity;
      // and the parent/branch scope, so condition branches see only their children
      const parent = ops.filters.find(([op, k]) => op === "eq" && k === "parent_step_id");
      const branch = ops.filters.find(([op, k]) => op === "eq" && k === "branch");
      const scoped = state.steps.filter((s) =>
        parent
          ? s.parent_step_id === parent[2] && (!branch || s.branch === branch[2])
          : s.parent_step_id == null,
      );
      return { data: scoped.filter((s) => Number(s.position) >= from), error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: (k: string, v: unknown) => (ops.filters.push(["gte", k, v]), b),
      gt: (k: string, v: unknown) => (ops.filters.push(["gt", k, v]), b),
      lte: () => b,
      in: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve({ ...ops, single: true })),
      maybeSingle: () => Promise.resolve(resolve({ ...ops, single: true })),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

vi.mock("./campaign-ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./campaign-ops")>()),
  addCampaignEntry: vi.fn(),
  loadCampaign: vi.fn(async () => null),
  setCampaignFieldValue: vi.fn(async () => "field set"),
}));

vi.mock("@/lib/flows/engine", () => ({
  startFlowForContact: vi.fn(),
}));

import {
  runAutomationsForTrigger,
  triggerMatches,
  interpolateTemplate,
  tryResumeInboundWait,
  keywordAutomationMatches,
  hasOpenReplyWait,
} from "./engine";
import { engineSendText, engineSendInteractive, engineSendMedia } from "./meta-send";
import { addCampaignEntry, setCampaignFieldValue } from "./campaign-ops";
import {
  OUTSURANCE_MESSAGES,
  outsuranceSteps,
  outsuranceTriggerConfig,
  type PresetStep,
} from "@/lib/campaigns/presets/outsurance";
import { startFlowForContact } from "@/lib/flows/engine";
import type { Automation, KeywordMatchTriggerConfig } from "@/types";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.logInserts = [];
  h.state.logUpdates = [];
  h.state.pendingInserts = [];
  h.state.pendingRow = null;
  h.state.profiles = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("automation_logs — status is seeded pessimistically (issue #409)", () => {
  it("writes the log row as 'failed' before any step runs", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The insert happens before execution, so a run killed mid-flight must
    // not leave behind a row that claims it succeeded.
    expect(h.state.logInserts).toHaveLength(1);
    expect(h.state.logInserts[0]).toMatchObject({
      status: "failed",
      steps_executed: [],
    });
  });

  it("still promotes the log to 'success' once the steps complete", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The seed is only a floor — the outermost scope still writes the real
    // verdict, so a completed run reports success as it always did.
    const withStatus = h.state.logUpdates.filter((u) => "status" in u);
    expect(withStatus.at(-1)).toMatchObject({ status: "success" });
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)", () => {
  it("refuses a private / link-local destination and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep("http://169.254.169.254/latest/meta-data/")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain("automation_steps");
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_webhook",
    position: 0,
    parent_step_id: null,
    step_config: { url, headers: { "Metadata-Flavor": "Google" }, body_template: "{}" },
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe("triggerMatches — interactive_reply", () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "menu step",
      trigger_type: "interactive_reply",
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches when the tapped id is in reply_ids (exact)", () => {
    expect(
      triggerMatches(automation(["yes", "no"]), { interactive_reply_id: "yes" }),
    ).toBe(true);
  });

  it("does not match a different id", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "maybe" }),
    ).toBe(false);
  });

  it("does not match on a substring (exact only)", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "yes_please" }),
    ).toBe(false);
  });

  it("does not match when no reply id is present or config is empty", () => {
    expect(triggerMatches(automation(["yes"]), {})).toBe(false);
    expect(triggerMatches(automation([]), { interactive_reply_id: "yes" })).toBe(false);
  });
});

describe("triggerMatches — tag_added", () => {
  function automation(tagId?: string): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "tag follow-up",
      trigger_type: "tag_added",
      trigger_config: tagId ? { tag_id: tagId } : {},
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches only the exact tag id", () => {
    expect(triggerMatches(automation("tag-a"), { tag_id: "tag-a" })).toBe(true);
    expect(triggerMatches(automation("tag-a"), { tag_id: "tag-ab" })).toBe(false);
  });

  it("fails closed when the config or event tag is missing", () => {
    expect(triggerMatches(automation(), { tag_id: "tag-a" })).toBe(false);
    expect(triggerMatches(automation("tag-a"), {})).toBe(false);
    expect(triggerMatches(automation("tag-a"), undefined)).toBe(false);
  });
});

describe("tag_added — conversation policy", () => {
  it("records a clear failed step when the contact has no conversation", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [{
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "tag outreach",
      trigger_type: "tag_added",
      trigger_config: { tag_id: "tag-a" },
      is_active: true,
    }];
    h.state.steps = [{
      id: "s1",
      automation_id: "a1",
      step_type: "send_message",
      position: 0,
      parent_step_id: null,
      step_config: { text: "Hello" },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { tag_id: "tag-a" },
    });

    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "tag_added automation cannot send: contact has no existing conversation",
    }));
  });
});

describe("condition — message_content", () => {
  function conditionRun(cfg: Record<string, unknown>) {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { id: "cond", automation_id: "a1", step_type: "condition", position: 0, parent_step_id: null, branch: null, step_config: cfg },
      { id: "yes", automation_id: "a1", step_type: "add_note", position: 0, parent_step_id: "cond", branch: "yes", step_config: { text: "yes" } },
      { id: "no", automation_id: "a1", step_type: "add_note", position: 0, parent_step_id: "cond", branch: "no", step_config: { text: "no" } },
    ];
  }
  const branchTaken = () => JSON.stringify(h.state.logUpdates).match(/branch=(yes|no)/)?.[1];

  async function run(text: string) {
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: text },
    });
  }

  it("filters on the operand when value is empty (builder and generator drafts)", async () => {
    conditionRun({ subject: "message_content", operand: "share" });
    await run("hello there");
    expect(branchTaken()).toBe("no");
  });

  it("matches the operand case-insensitively", async () => {
    conditionRun({ subject: "message_content", operand: "share" });
    await run("I want to SHARE");
    expect(branchTaken()).toBe("yes");
  });

  it("still prefers value when both are set", async () => {
    conditionRun({ subject: "message_content", operand: "ignored", value: "coke" });
    await run("coke please");
    expect(branchTaken()).toBe("yes");
  });
});

describe("triggerMatches — keyword_match", () => {
  function automation(
    cfg: Partial<KeywordMatchTriggerConfig> & { keywords: string[] },
  ): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "kw",
      trigger_type: "keyword_match",
      trigger_config: { match_type: "contains", ...cfg },
      is_active: true,
    } as unknown as Automation;
  }

  const on = (a: Automation, text: string) =>
    triggerMatches(a, { message_text: text });

  it("keeps `contains` as a raw substring test", () => {
    // Issue #409 asked for this to become word-boundary matching. It
    // deliberately did NOT change: existing automations relying on
    // substring behaviour ("cat" firing on "category") must keep working,
    // and `contains` is the builder's default. `word` is the opt-in fix.
    expect(on(automation({ keywords: ["k"] }), "thanks")).toBe(true);
    expect(on(automation({ keywords: ["cat"] }), "category")).toBe(true);
  });

  it("`word` matches only standalone words", () => {
    const a = automation({ keywords: ["k"], match_type: "word" });
    expect(on(a, "thanks")).toBe(false);
    expect(on(a, "k")).toBe(true);
    expect(on(a, "press k to continue")).toBe(true);
    expect(on(a, "press K!")).toBe(true);
  });

  it("`word` respects punctuation and line edges around the keyword", () => {
    const a = automation({ keywords: ["hi"], match_type: "word" });
    expect(on(a, "hi")).toBe(true);
    expect(on(a, "hi!")).toBe(true);
    expect(on(a, "(hi)")).toBe(true);
    expect(on(a, "say hi.")).toBe(true);
    expect(on(a, "this")).toBe(false);
    expect(on(a, "hiya")).toBe(false);
  });

  it("`word` handles a keyword that itself carries punctuation", () => {
    // `\b` can't do this: /\bhi!\b/ demands a word char after the "!",
    // so it never matches. Hence the lookaround implementation.
    const a = automation({ keywords: ["hi!"], match_type: "word" });
    expect(on(a, "say hi!")).toBe(true);
    expect(on(a, "hi! there")).toBe(true);
  });

  it("`word` treats regex metacharacters in a keyword as literal", () => {
    // Account-supplied free text — an unescaped "(" would throw.
    const a = automation({ keywords: ["c++ (beginner)"], match_type: "word" });
    expect(on(a, "I want the c++ (beginner) course")).toBe(true);
    expect(on(a, "I want the cxx beginner course")).toBe(false);
    expect(() => on(automation({ keywords: ["("], match_type: "word" }), "(")).not.toThrow();
  });

  it("`word` is case-insensitive unless case_sensitive is set", () => {
    expect(on(automation({ keywords: ["Hi"], match_type: "word" }), "hi")).toBe(true);
    expect(
      on(
        automation({ keywords: ["Hi"], match_type: "word", case_sensitive: true }),
        "hi",
      ),
    ).toBe(false);
    expect(
      on(
        automation({ keywords: ["Hi"], match_type: "word", case_sensitive: true }),
        "Hi",
      ),
    ).toBe(true);
  });

  it("`word` finds a space-delimited keyword in a non-Latin script", () => {
    // ASCII `\b` fails outright here — every character of "안녕" is a
    // non-word character to it, so /\b안녕\b/ matches nothing.
    const a = automation({ keywords: ["안녕"], match_type: "word" });
    expect(on(a, "안녕")).toBe(true);
    expect(on(a, "저기 안녕 하세요")).toBe(true);
    // Documented limitation, not an accident: a language written without
    // spaces has no word edge inside a run of characters.
    expect(on(a, "안녕하세요")).toBe(false);
  });

  it("`exact` matches the whole message or the keyword as the first token", () => {
    const a = automation({ keywords: ["hi"], match_type: "exact" });
    expect(on(a, "hi")).toBe(true);
    expect(on(a, "  HI  ")).toBe(true);
    // Campaign traffic is almost never *only* the keyword.
    expect(on(a, "hi there")).toBe(true);
    expect(on(a, "WINICC2027 I want to enter")).toBe(false);
    expect(on(a, "say hi")).toBe(false);
    expect(on(a, "high")).toBe(false);
  });

  it("`exact` fires on a campaign keyword followed by more text", () => {
    const a = automation({
      keywords: ["WINICC2027"],
      match_type: "exact",
    });
    expect(on(a, "WINICC2027")).toBe(true);
    expect(on(a, "WINICC2027 I want to enter")).toBe(true);
    expect(on(a, "please WINICC2027")).toBe(false);
    expect(on(a, "WINICC2027xyz")).toBe(false);
  });

  it("`starts_with` matches a prefix", () => {
    const a = automation({ keywords: ["JOIN"], match_type: "starts_with" });
    expect(on(a, "JOIN ICC")).toBe(true);
    expect(on(a, "please JOIN")).toBe(false);
  });

  it("`ends_with` matches a suffix", () => {
    const a = automation({ keywords: ["stop"], match_type: "ends_with" });
    expect(on(a, "please stop")).toBe(true);
    expect(on(a, "stop now")).toBe(false);
  });

  it("ignores empty keywords and empty messages in `word` mode", () => {
    expect(on(automation({ keywords: [""], match_type: "word" }), "anything")).toBe(false);
    expect(on(automation({ keywords: ["hi"], match_type: "word" }), "")).toBe(false);
  });
});

describe("interpolateTemplate", () => {
  it("fills contact, campaign, entry, vars and message tokens", () => {
    const out = interpolateTemplate(
      "Hi {{ contact.name }} / {{ campaign.code }} / {{ entry.reference }} / {{ vars.answer }} / {{ message.text }}",
      {
        message_text: "hello",
        vars: { answer: "yes" },
        contact: { name: "Ada" },
        campaign: { code: "ICC" },
        entry: { reference: "ICC-1" },
      },
    );
    expect(out).toBe("Hi Ada / ICC / ICC-1 / yes / hello");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(interpolateTemplate("x{{ missing.y }}z", {})).toBe("xz");
  });
});

// ------------------------------------------------------------
// Reply waits: send_list / send_buttons `wait_for_reply` + validate retry
// ------------------------------------------------------------

function messageTrigger() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    name: "quiz",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function step(position: number, step_type: string, step_config: Record<string, unknown>) {
  return { id: `s${position}`, automation_id: "a1", step_type, position, parent_step_id: null, step_config };
}

const LIST = {
  kind: "list",
  body: "Who's your pick?",
  button_label: "Choose",
  sections: [{ rows: [{ id: "team_a", title: "Team A" }, { id: "team_b", title: "Team B" }] }],
};

describe("send_list — wait_for_reply", () => {
  it("parks after the send and does not run the next step", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [
      step(0, "send_list", { ...LIST, wait_for_reply: true, var_key: "pick" }),
      step(1, "send_message", { text: "should wait" }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "WINICC2027", conversation_id: "conv1" },
    });

    // The wait keys never reach Meta.
    const sent = vi.mocked(engineSendInteractive).mock.calls[0][0].payload;
    expect(sent).not.toHaveProperty("wait_for_reply");
    expect(sent).not.toHaveProperty("var_key");
    expect(sent.body).toBe("Who's your pick?");

    expect(h.state.pendingInserts).toEqual([
      expect.objectContaining({ wait_kind: "inbound_reply", expect_var_key: "pick", next_step_position: 1 }),
    ]);
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("runs straight through when wait_for_reply is off", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "send_list", LIST), step(1, "send_message", { text: "next" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "hi", conversation_id: "conv1" },
    });

    expect(h.state.pendingInserts).toEqual([]);
    expect(engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "next" }));
  });

  it("resumes on the tap with the option title and id in vars", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [
      step(0, "send_list", { ...LIST, wait_for_reply: true, var_key: "pick" }),
      step(1, "send_message", { text: "{{ vars.pick }} / {{ vars.pick_id }}" }),
    ];
    h.state.pendingRow = {
      id: "p1",
      automation_id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      contact_id: "c1",
      log_id: "log1",
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      expect_var_key: "pick",
      context: { conversation_id: "conv1", vars: {} },
    };

    const consumed = await tryResumeInboundWait({
      accountId: ACCOUNT,
      contactId: "c1",
      conversationId: "conv1",
      messageText: "Team B",
      interactiveReplyId: "team_b",
    });

    expect(consumed).toBe(true);
    expect(engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Team B / team_b" }));
  });
});

describe("validate — on_invalid retry", () => {
  const validate = (extra: Record<string, unknown> = {}) =>
    step(0, "validate", {
      var_key: "answer",
      rule: "regex",
      pattern: "^[A-Da-d]$",
      on_invalid: "retry",
      retry_text: "Please reply A, B, C or D.",
      max_attempts: 3,
      ...extra,
    });

  it("asks again and parks AT the validate step when the answer is invalid", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [validate(), step(1, "send_message", { text: "after" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "maybe", conversation_id: "conv1", vars: { answer: "maybe" } },
    });

    expect(engineSendText).toHaveBeenCalledTimes(1);
    expect(engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Please reply A, B, C or D." }));
    expect(h.state.pendingInserts).toEqual([
      expect.objectContaining({
        wait_kind: "inbound_reply",
        expect_var_key: "answer",
        next_step_position: 0,
        context: expect.objectContaining({ vars: expect.objectContaining({ answer_attempts: 2 }) }),
      }),
    ]);
  });

  it("continues to the next step once the answer is valid", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [validate(), step(1, "send_message", { text: "after" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "B", conversation_id: "conv1", vars: { answer: "B", answer_attempts: 2 } },
    });

    expect(h.state.pendingInserts).toEqual([]);
    expect(engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "after" }));
  });

  it("fails like `stop` once the attempts are used up", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [validate(), step(1, "send_message", { text: "after" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "nope", conversation_id: "conv1", vars: { answer: "nope", answer_attempts: 3 } },
    });

    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.pendingInserts).toEqual([]);
    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "validate failed: answer (regex)",
    }));
  });
});

describe("start_flow", () => {
  it("passes the saved flow id to the flows engine", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "start_flow", { flow_id: "flow-9" })];
    vi.mocked(startFlowForContact).mockResolvedValue({
      started: true,
      flow_run_id: "run-1",
      outcome: "started",
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "hi", conversation_id: "conv1" },
    });

    expect(startFlowForContact).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      flowId: "flow-9",
      contactId: "c1",
      conversationId: "conv1",
      startedBy: "automation:a1",
    });
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "success" });
  });

  it("fails the run with a clear error when no flow is selected", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "start_flow", { flow_id: "" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "hi", conversation_id: "conv1" },
    });

    expect(startFlowForContact).not.toHaveBeenCalled();
    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "start_flow needs contact + flow_id",
    }));
  });

  it("reports a flow that is no longer active instead of skipping silently", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "start_flow", { flow_id: "flow-9" })];
    vi.mocked(startFlowForContact).mockResolvedValue({ started: false, reason: "flow_not_active" });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "hi", conversation_id: "conv1" },
    });

    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "start_flow failed: flow not active",
    }));
  });
});

describe("campaign_add_entry", () => {
  it("records the entry for the configured campaign without needing a flow", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [
      step(0, "campaign_add_entry", { campaign_id: "camp-coke" }),
      step(1, "send_message", { text: "Your reference: {{ entry.reference }}" }),
    ];
    vi.mocked(addCampaignEntry).mockResolvedValue({
      entry: { id: "e1", status: "in_progress", entry_reference: "COKE-0001" },
      created: false,
      duplicate: false,
    } as unknown as Awaited<ReturnType<typeof addCampaignEntry>>);

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "WINCOKE", conversation_id: "conv1" },
    });

    expect(addCampaignEntry).toHaveBeenCalledTimes(1);
    expect(addCampaignEntry).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT, campaignId: "camp-coke", contactId: "c1" }),
    );
    expect(startFlowForContact).not.toHaveBeenCalled();
    expect(engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Your reference: COKE-0001" }),
    );
  });
});

describe("send_media", () => {
  it("sends a direct video file as media", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "send_media", { media_type: "video", url: "https://cdn.example.com/coke.mp4", caption: "Win With Coke!" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "WINCOKE", conversation_id: "conv1" },
    });

    expect(engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video", link: "https://cdn.example.com/coke.mp4", caption: "Win With Coke!" }),
    );
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "success" });
  });

  it("fails clearly on a YouTube page instead of handing it to Meta as a video", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "send_media", { media_type: "video", url: "https://youtu.be/0Ab-F7Y3IXc" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "WINCOKE", conversation_id: "conv1" },
    });

    expect(engineSendMedia).not.toHaveBeenCalled();
    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "send_media cannot send a YouTube link as media; use a send_message step",
    }));
  });

  it("sends the YouTube link as a normal text message", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "send_message", { text: "Win With Coke!\nhttps://youtu.be/0Ab-F7Y3IXc" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "WINCOKE", conversation_id: "conv1" },
    });

    expect(engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Win With Coke!\nhttps://youtu.be/0Ab-F7Y3IXc" }),
    );
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "success" });
  });
});

describe("OUTsurance automation", () => {
  const CAMPAIGN = "camp-outsurance";
  const outsurance = {
    id: "os",
    account_id: ACCOUNT,
    user_id: "u1",
    name: "OUTsurance — Welcome",
    trigger_type: "keyword_match",
    trigger_config: outsuranceTriggerConfig(CAMPAIGN),
    is_active: true,
  };

  // Preset steps → automation_steps rows (all root-level).
  const rows = (tree: PresetStep[]) =>
    tree.map((s, position) => ({ id: `s${position}`, automation_id: "os", step_type: s.step_type, step_config: s.step_config, position, parent_step_id: null, branch: null }));

  function parkedOnName(extra: Record<string, unknown> = {}) {
    return {
      id: "p1",
      automation_id: "os",
      account_id: ACCOUNT,
      user_id: "u1",
      contact_id: "c1",
      log_id: "log1",
      parent_step_id: null,
      branch: null,
      next_step_position: 2,
      expect_var_key: "customer_name",
      run_at: new Date(Date.now() + 3_600_000).toISOString(),
      context: { conversation_id: "conv1", campaign_id: CAMPAIGN, entry: { id: "e1", status: "in_progress" }, vars: {} },
      ...extra,
    };
  }

  function setUp() {
    h.state.owned = { id: "c1" };
    h.state.automations = [outsurance];
    h.state.steps = rows(outsuranceSteps(CAMPAIGN));
    h.state.profiles = [{ user_id: "agent-1" }];
  }

  const reply = (messageText: string) =>
    tryResumeInboundWait({ accountId: ACCOUNT, contactId: "c1", conversationId: "conv1", messageText });

  it("SAVE adds the campaign entry first, then asks their name and waits", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({
      entry: { id: "e1", status: "in_progress", entry_reference: null } as never,
      created: true,
      duplicate: false,
    });

    const matched = await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "keyword_match",
      contactId: "c1",
      context: { message_text: "SAVE", conversation_id: "conv1" },
    });

    expect(matched).toBe(1);
    expect(addCampaignEntry).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN, contactId: "c1", automationId: "os", messageText: "SAVE" }),
    );
    expect(vi.mocked(engineSendText).mock.calls.map(([a]) => a.text)).toEqual([OUTSURANCE_MESSAGES.welcome]);
    expect(vi.mocked(addCampaignEntry).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(engineSendText).mock.invocationCallOrder[0],
    );
    expect(h.state.pendingInserts).toEqual([
      expect.objectContaining({ wait_kind: "inbound_reply", expect_var_key: "customer_name", next_step_position: 2 }),
    ]);
  });

  it("their name is saved, then the OUTsurance number, the team alert and the closing", async () => {
    setUp();
    h.state.pendingRow = parkedOnName();

    expect(await reply("Thabo Mokoena")).toBe(true);

    expect(setCampaignFieldValue).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN, fieldKey: "name", value: "Thabo Mokoena", entryId: "e1" }),
    );
    expect(vi.mocked(engineSendText).mock.calls.map(([a]) => a.text)).toEqual([
      "Thanks Thabo Mokoena! Please save this number: 08 600 60 000. That's OUTsurance, and we will call you.",
      OUTSURANCE_MESSAGES.closing,
    ]);
    expect(h.state.fromCalls).toEqual(expect.arrayContaining(["conversations", "notifications"]));
    expect(h.state.pendingInserts).toEqual([]);
  });

  it("SAVE sent again while waiting is re-asked: no new entry, no name saved", async () => {
    setUp();
    h.state.pendingRow = parkedOnName();

    expect(await reply("SAVE")).toBe(true);

    expect(addCampaignEntry).not.toHaveBeenCalled();
    expect(setCampaignFieldValue).not.toHaveBeenCalled();
    expect(vi.mocked(engineSendText).mock.calls.map(([a]) => a.text)).toEqual([OUTSURANCE_MESSAGES.retry]);
    expect(h.state.pendingInserts).toEqual([
      expect.objectContaining({ expect_var_key: "customer_name", next_step_position: 2 }),
    ]);
  });

  it("reuses the open entry when SAVE is sent again later", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({
      entry: { id: "e1", status: "in_progress", entry_reference: null } as never,
      created: false,
      duplicate: false,
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "keyword_match",
      contactId: "c1",
      context: { message_text: "save", conversation_id: "conv1" },
    });

    const details = h.state.logUpdates.flatMap(
      (u) => ((u.steps_executed as { detail?: string }[] | undefined) ?? []).map((r) => r.detail),
    );
    expect(details).toContain("entry already existed (e1)");
  });
});

describe("tryResumeInboundWait — expired waits", () => {
  it("expires a wait past its timeout instead of resuming it", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [step(0, "ask_question", { text: "q?", var_key: "a" }), step(1, "send_message", { text: "after" })];
    h.state.pendingRow = {
      id: "p1",
      automation_id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      contact_id: "c1",
      log_id: "log1",
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      expect_var_key: "a",
      run_at: new Date(Date.now() - 60_000).toISOString(),
      context: { conversation_id: "conv1", vars: {} },
    };

    const consumed = await tryResumeInboundWait({
      accountId: ACCOUNT,
      contactId: "c1",
      conversationId: "conv1",
      messageText: "WINICC2027",
    });

    // Not consumed, so the webhook goes on to keyword automations.
    expect(consumed).toBe(false);
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.logUpdates).toEqual([
      expect.objectContaining({ status: "failed", error_message: "no reply before the wait timed out" }),
    ]);
  });
});

describe("BMW test-drive automation", () => {
  it("after the test-drive question, finishes the branch with the completion and closing", async () => {
    const { bmwSteps, CAMPAIGN_CLOSING, BMW_MESSAGES } = await import("@/lib/campaigns/presets/spoton-campaigns");
    const tree = bmwSteps("camp-bmw");
    // Flatten like steps-tree.ts: yes branch of the outer condition (root position 3).
    const rows: Record<string, unknown>[] = [];
    const walk = (list: typeof tree, parent: string | null, branch: string | null) =>
      list.forEach((s, position) => {
        const id = parent ? `${parent}.${branch}${position}` : `s${position}`;
        rows.push({ id, automation_id: "bmw", step_type: s.step_type, step_config: s.step_config, position, parent_step_id: parent, branch });
        if (s.branches?.yes) walk(s.branches.yes, id, "yes");
        if (s.branches?.no) walk(s.branches.no, id, "no");
      });
    walk(tree, null, null);
    h.state.owned = { id: "c1" };
    h.state.automations = [{ id: "bmw", account_id: ACCOUNT, user_id: "u1", name: "BMW", trigger_type: "keyword_match", trigger_config: {}, is_active: true }];
    h.state.steps = rows;
    h.state.profiles = [{ user_id: "agent-1" }];
    // Parked on the test-drive question: yes branch of s3, resume at position 2.
    h.state.pendingRow = {
      id: "p1", automation_id: "bmw", account_id: ACCOUNT, user_id: "u1", contact_id: "c1", log_id: "log1",
      parent_step_id: "s3", branch: "yes", next_step_position: 2, expect_var_key: "test_drive_details",
      run_at: new Date(Date.now() + 3_600_000).toISOString(),
      context: { conversation_id: "conv1", campaign_id: "camp-bmw", entry: { id: "e1", status: "in_progress" }, vars: {} },
    };

    expect(await tryResumeInboundWait({ accountId: ACCOUNT, contactId: "c1", conversationId: "conv1", messageText: "X5, Sandton" })).toBe(true);

    expect(setCampaignFieldValue).toHaveBeenCalledWith(expect.objectContaining({ fieldKey: "test_drive_details", value: "X5, Sandton" }));
    expect(vi.mocked(engineSendText).mock.calls.map(([arg]) => arg.text)).toEqual([BMW_MESSAGES.testDriveAck, CAMPAIGN_CLOSING]);
  });
});

describe("webhook routing helpers", () => {
  it("keywordAutomationMatches: true only when an active keyword automation matches", async () => {
    h.state.automations = [
      { id: "os", account_id: ACCOUNT, trigger_type: "keyword_match", trigger_config: outsuranceTriggerConfig("c"), is_active: true },
    ];
    expect(await keywordAutomationMatches(ACCOUNT, "SAVE")).toBe(true);
    expect(await keywordAutomationMatches(ACCOUNT, "save please")).toBe(true);
    expect(await keywordAutomationMatches(ACCOUNT, "hello")).toBe(false);
    expect(await keywordAutomationMatches(ACCOUNT, "   ")).toBe(false);
  });

  it("hasOpenReplyWait: true for an unexpired wait, false once it has expired", async () => {
    h.state.pendingRow = { id: "p1", run_at: new Date(Date.now() + 3_600_000).toISOString() };
    expect(await hasOpenReplyWait(ACCOUNT, "c1")).toBe(true);
    h.state.pendingRow = { id: "p1", run_at: new Date(Date.now() - 60_000).toISOString() };
    expect(await hasOpenReplyWait(ACCOUNT, "c1")).toBe(false);
    h.state.pendingRow = null;
    expect(await hasOpenReplyWait(ACCOUNT, "c1")).toBe(false);
  });
});

describe("campaign_add_entry — not open, repeats, test entries", () => {
  function setUp() {
    h.state.owned = { id: "c1" };
    h.state.automations = [messageTrigger()];
    h.state.steps = [
      step(0, "campaign_add_entry", { campaign_id: "camp" }),
      step(1, "send_message", { text: "welcome" }),
    ];
  }
  const run = () =>
    runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "SHAREACOKE", conversation_id: "conv1" },
    });
  const loggedDetails = () =>
    h.state.logUpdates.flatMap((u) => ((u.steps_executed as { detail?: string }[] | undefined) ?? []).map((r) => r.detail));

  it("closed: sends the campaign's not-open message, sends nothing else, and logs why", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({ closed: "closed", message: "Not open right now." });
    await run();
    expect(vi.mocked(engineSendText).mock.calls.map(([a]) => a.text)).toEqual(["Not open right now."]);
    expect(loggedDetails()).toContain("campaign not open (closed); not-open message sent");
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "success" });
  });

  it("draft: stays silent for non-test contacts, even with a not-open message", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({ closed: "draft", message: "Not open right now." });
    await run();
    expect(engineSendText).not.toHaveBeenCalled();
    expect(loggedDetails()).toContain("campaign not open (draft)");
  });

  it("not open without a message: silent, run ends cleanly", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({ closed: "ended", message: null });
    await run();
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("repeat entry with a duplicate message: sends it and stops before the questions", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({
      entry: { id: "e2", status: "duplicate", entry_reference: null } as never,
      created: true,
      duplicate: true,
      duplicateMessage: "You've already entered.",
    });
    await run();
    expect(vi.mocked(engineSendText).mock.calls.map(([a]) => a.text)).toEqual(["You've already entered."]);
  });

  it("repeat entry without a duplicate message: carries on as before", async () => {
    setUp();
    vi.mocked(addCampaignEntry).mockResolvedValue({
      entry: { id: "e2", status: "duplicate", entry_reference: null } as never,
      created: true,
      duplicate: true,
      duplicateMessage: null,
    });
    await run();
    expect(vi.mocked(engineSendText).mock.calls.map(([a]) => a.text)).toEqual(["welcome"]);
  });

  it("test entry: carries on, but doesn't fire campaign_entry automations", async () => {
    setUp();
    h.state.automations = [
      messageTrigger(),
      { id: "a2", account_id: ACCOUNT, user_id: "u1", name: "on entry", trigger_type: "campaign_entry", trigger_config: {}, is_active: true },
    ];
    vi.mocked(addCampaignEntry).mockResolvedValue({
      entry: { id: "e3", status: "in_progress", entry_reference: null } as never,
      created: true,
      duplicate: false,
      test: true,
    });
    await run();
    expect(loggedDetails()).toContain("test entry created (e3)");
    expect(h.state.logInserts.map((l) => l.trigger_event)).toEqual(["new_message_received"]);
  });
});
