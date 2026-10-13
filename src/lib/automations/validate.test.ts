import { describe, expect, it } from "vitest";
import {
  annotateIssues,
  issueStepPath,
  referencedFlowIds,
  validateStepReferences,
  validateStepsForActivation,
  validateTriggerForActivation,
} from "./validate";

describe("validateStepsForActivation", () => {
  it("rejects empty or missing step lists", () => {
    expect(validateStepsForActivation([])).toEqual([
      { path: "steps", message: "active automations need at least one step" },
    ]);
    expect(
      validateStepsForActivation(undefined as unknown as never[]),
    ).toEqual([
      { path: "steps", message: "active automations need at least one step" },
    ]);
  });

  it("passes a fully-populated step set", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_message", step_config: { text: "hi" } },
      {
        step_type: "wait",
        step_config: { amount: 5, unit: "minutes" },
      },
      { step_type: "add_tag", step_config: { tag_id: "tag-uuid" } },
      { step_type: "close_conversation", step_config: {} },
    ]);
    expect(issues).toEqual([]);
  });

  it("flags every required field that is missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_message", step_config: { text: "  " } },
      { step_type: "send_template", step_config: {} },
      { step_type: "add_tag", step_config: { tag_id: "" } },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].text",
      "steps[1].template_name",
      "steps[2].tag_id",
    ]);
  });

  it("checks wait amount and unit boundaries", () => {
    const issues = validateStepsForActivation([
      { step_type: "wait", step_config: { amount: 0, unit: "minutes" } },
      { step_type: "wait", step_config: { amount: 5, unit: "seconds" } },
      { step_type: "wait", step_config: { amount: -1, unit: "hours" } },
      {
        step_type: "wait",
        step_config: { amount: Number.POSITIVE_INFINITY, unit: "days" },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].amount",
      "steps[1].unit",
      "steps[2].amount",
      "steps[3].amount",
    ]);
  });

  it("validates webhook URLs", () => {
    const good = validateStepsForActivation([
      {
        step_type: "send_webhook",
        step_config: { url: "https://hooks.example.com/in" },
      },
    ]);
    expect(good).toEqual([]);

    const noUrl = validateStepsForActivation([
      { step_type: "send_webhook", step_config: {} },
    ]);
    expect(noUrl.map((i) => i.message)).toContain("webhook URL is required");

    const wrongProtocol = validateStepsForActivation([
      {
        step_type: "send_webhook",
        step_config: { url: "ftp://files.example.com" },
      },
    ]);
    expect(wrongProtocol.map((i) => i.message)).toContain(
      "webhook URL must use http or https",
    );

    const garbage = validateStepsForActivation([
      { step_type: "send_webhook", step_config: { url: "not a url" } },
    ]);
    expect(garbage.map((i) => i.message)).toContain(
      "webhook URL is not a valid URL",
    );
  });

  it("validates assign_conversation only when mode is 'specific'", () => {
    const roundRobinNoAgent = validateStepsForActivation([
      {
        step_type: "assign_conversation",
        step_config: { mode: "round_robin" },
      },
    ]);
    expect(roundRobinNoAgent).toEqual([]);

    const specificMissingAgent = validateStepsForActivation([
      { step_type: "assign_conversation", step_config: { mode: "specific" } },
    ]);
    expect(specificMissingAgent.map((i) => i.path)).toEqual([
      "steps[0].agent_id",
    ]);
  });

  it("flags create_deal when required fields are missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "create_deal", step_config: {} },
    ]);
    expect(issues.map((i) => i.path).sort()).toEqual([
      "steps[0].pipeline_id",
      "steps[0].stage_id",
      "steps[0].title",
    ]);
  });

  it("validates send_buttons / send_list interactive payloads", () => {
    const good = validateStepsForActivation([
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Pick one",
          buttons: [{ id: "yes", title: "Yes" }],
        },
      },
    ]);
    expect(good).toEqual([]);

    const tooMany = validateStepsForActivation([
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Pick one",
          buttons: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
            { id: "c", title: "C" },
            { id: "d", title: "D" },
          ],
        },
      },
    ]);
    expect(tooMany.map((i) => i.path)).toEqual(["steps[0].interactive"]);
  });

  it("flags update_contact_field when field or value is missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "update_contact_field", step_config: { field: "name" } },
      {
        step_type: "update_contact_field",
        step_config: { field: "", value: "x" },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].value",
      "steps[1].field",
    ]);
  });

  it("recursively walks condition branches with stable dot-paths", () => {
    const issues = validateStepsForActivation([
      {
        step_type: "condition",
        step_config: { subject: "tag", operand: "vip" },
        branches: {
          yes: [{ step_type: "add_tag", step_config: { tag_id: "" } }],
          no: [
            {
              step_type: "send_message",
              step_config: { text: "" },
            },
          ],
        },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].yes.steps[0].tag_id",
      "steps[0].no.steps[0].text",
    ]);
  });

  it("reports an issue for unknown step types", () => {
    const issues = validateStepsForActivation([
      { step_type: "do_a_barrel_roll", step_config: {} },
    ]);
    expect(issues).toEqual([
      { path: "steps[0]", message: "unknown step type: do_a_barrel_roll" },
    ]);
  });

  it("flags condition subject/operand independently", () => {
    const issues = validateStepsForActivation([
      { step_type: "condition", step_config: {} },
    ]);
    expect(issues.map((i) => i.path).sort()).toEqual([
      "steps[0].operand",
      "steps[0].subject",
    ]);
  });
});

describe("validateTriggerForActivation", () => {
  it("accepts a valid keyword_match config", () => {
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["hello", "hi"],
        match_type: "exact",
      }),
    ).toEqual([]);
  });

  it("rejects keyword_match with empty keyword array", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: [],
      match_type: "exact",
    });
    expect(issues.map((i) => i.path)).toContain("trigger.keywords");
  });

  it("rejects keyword_match with whitespace-only entries", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: ["hi", "   "],
      match_type: "contains",
    });
    expect(issues.map((i) => i.message)).toContain(
      "keywords cannot be empty strings",
    );
  });

  it("rejects keyword_match with an unknown match_type", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: ["hi"],
      match_type: "fuzzy",
    });
    expect(issues.map((i) => i.path)).toContain("trigger.match_type");
  });

  it("accepts keyword_match with a missing match_type (defaults to contains)", () => {
    expect(
      validateTriggerForActivation("keyword_match", { keywords: ["hi"] }),
    ).toEqual([]);
  });

  it("accepts starts_with and ends_with match types", () => {
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["JOIN"],
        match_type: "starts_with",
      }),
    ).toEqual([]);
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["stop"],
        match_type: "ends_with",
      }),
    ).toEqual([]);
  });

  it("accepts the word match_type (issue #409)", () => {
    // Activation validation has to stay in step with the engine and the
    // builder's dropdown — an automation the UI can save must not be
    // rejected on activation.
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["hi"],
        match_type: "word",
      }),
    ).toEqual([]);
  });

  it("requires schedule on time_based triggers", () => {
    expect(validateTriggerForActivation("time_based", {})).toEqual([
      { path: "trigger.schedule", message: "schedule is required" },
    ]);
    expect(
      validateTriggerForActivation("time_based", { schedule: "0 9 * * *" }),
    ).toEqual([]);
  });

  it("requires tag_id on tag_added triggers", () => {
    expect(validateTriggerForActivation("tag_added", {})).toEqual([
      { path: "trigger.tag_id", message: "tag is required" },
    ]);
    expect(
      validateTriggerForActivation("tag_added", { tag_id: "tag-uuid" }),
    ).toEqual([]);
  });

  it("requires reply_ids on interactive_reply triggers", () => {
    expect(validateTriggerForActivation("interactive_reply", {})).toEqual([
      { path: "trigger.reply_ids", message: "at least one reply id is required" },
    ]);
    expect(
      validateTriggerForActivation("interactive_reply", { reply_ids: ["yes", "no"] }),
    ).toEqual([]);
    const empties = validateTriggerForActivation("interactive_reply", {
      reply_ids: ["yes", "  "],
    });
    expect(empties.map((i) => i.message)).toContain(
      "reply ids cannot be empty strings",
    );
  });

  it("does not flag unknown trigger types (handled elsewhere)", () => {
    expect(validateTriggerForActivation("some_future_trigger", {})).toEqual([]);
  });
});

describe("validateStepsForActivation — reply waits", () => {
  const list = {
    kind: "list",
    body: "Pick one",
    button_label: "Choose",
    sections: [{ rows: [{ id: "a", title: "A" }] }],
  };

  it("needs a variable key when send_list waits for a reply", () => {
    expect(
      validateStepsForActivation([
        { step_type: "send_list", step_config: { ...list, wait_for_reply: true, var_key: " " } },
      ]).map((i) => i.path),
    ).toEqual(["steps[0].var_key"]);
    expect(
      validateStepsForActivation([
        { step_type: "send_list", step_config: { ...list, wait_for_reply: true, var_key: "pick" } },
      ]),
    ).toEqual([]);
  });

  it("rejects a regex pattern that does not compile, but allows none", () => {
    expect(
      validateStepsForActivation([
        { step_type: "validate", step_config: { var_key: "answer", rule: "regex", pattern: "([A-D" } },
      ]).map((i) => i.path),
    ).toEqual(["steps[0].pattern"]);
    expect(
      validateStepsForActivation([
        { step_type: "validate", step_config: { var_key: "answer", rule: "regex" } },
      ]),
    ).toEqual([]);
  });

  it("bounds max attempts when retrying", () => {
    const run = (max_attempts: unknown) =>
      validateStepsForActivation([
        {
          step_type: "validate",
          step_config: { var_key: "answer", rule: "required", on_invalid: "retry", max_attempts },
        },
      ]).map((i) => i.path);
    expect(run(1)).toEqual(["steps[0].max_attempts"]);
    expect(run(11)).toEqual(["steps[0].max_attempts"]);
    expect(run(3)).toEqual([]);
  });
});

// The Coca-Cola automation as saved: step 5 is a Start Flow step with no
// flow picked, and there is no campaign_add_entry step at all.
const COKE_STEPS = [
  { step_type: "send_message", step_config: { text: "Welcome to Coca-Cola!" } },
  { step_type: "send_media", step_config: { url: "https://cdn.example.com/coke.mp4", media_type: "video" } },
  { step_type: "ask_question", step_config: { text: "Who will you share a Coke with?", var_key: "answer" } },
  { step_type: "send_message", step_config: { text: "{{ entry.reference }} thanks" } },
  { step_type: "start_flow", step_config: { flow_id: "" } },
];

describe("Start Flow vs Add Campaign Entry", () => {
  it("only Start Flow needs a flow: the Coca-Cola error comes from step 5 being start_flow", () => {
    const issues = annotateIssues(validateStepsForActivation(COKE_STEPS), COKE_STEPS);
    expect(issues).toEqual([
      { path: "steps[4].flow_id", message: "flow is required", step_type: "start_flow" },
    ]);
  });

  it("an Add Campaign Entry step in that slot needs a campaign, never a flow", () => {
    const fixed = [
      ...COKE_STEPS.slice(0, 4),
      { step_type: "campaign_add_entry", step_config: { campaign_id: "camp-coke" } },
    ];
    expect(validateStepsForActivation(fixed)).toEqual([]);
    expect(
      validateStepsForActivation([{ step_type: "campaign_add_entry", step_config: { campaign_id: "" } }]),
    ).toEqual([{ path: "steps[0].campaign_id", message: "campaign is required" }]);
  });
});

describe("validateStepReferences", () => {
  const flows = [
    { id: "f-active", name: "Lead capture", status: "active" },
    { id: "f-draft", name: "Welcome menu", status: "draft" },
  ];

  it("accepts a Start Flow step pointing at an active flow", () => {
    const steps = [{ step_type: "start_flow", step_config: { flow_id: "f-active" } }];
    expect(validateStepReferences(steps, { flows })).toEqual([]);
  });

  it("rejects a flow that is not active, or no longer exists", () => {
    const steps = [
      { step_type: "start_flow", step_config: { flow_id: "f-draft" } },
      {
        step_type: "condition",
        step_config: { subject: "tag_presence", operand: "t" },
        branches: { yes: [{ step_type: "start_flow", step_config: { flow_id: "gone" } }] },
      },
    ];
    expect(validateStepReferences(steps, { flows })).toEqual([
      {
        path: "steps[0].flow_id",
        message: 'flow "Welcome menu" is not active, activate it or pick another flow',
      },
      {
        path: "steps[1].yes.steps[0].flow_id",
        message: "the selected flow no longer exists, pick another flow",
      },
    ]);
  });

  it("leaves empty flow ids to validateStepsForActivation and collects referenced ids", () => {
    const steps = [
      { step_type: "start_flow", step_config: { flow_id: "" } },
      { step_type: "start_flow", step_config: { flow_id: "f-active" } },
      { step_type: "campaign_add_entry", step_config: { campaign_id: "c" } },
    ];
    expect(validateStepReferences(steps, { flows: [] })).toHaveLength(1);
    expect(referencedFlowIds(steps)).toEqual(["f-active"]);
  });
});

describe("issueStepPath", () => {
  it("maps root and nested paths back to builder step paths", () => {
    expect(issueStepPath("steps[4].flow_id")).toEqual({
      path: [{ kind: "root", index: 4 }],
      field: "flow_id",
    });
    expect(issueStepPath("steps[1].no.steps[0].text")).toEqual({
      path: [
        { kind: "root", index: 1 },
        { kind: "branch", branch: "no", index: 0 },
      ],
      field: "text",
    });
    expect(issueStepPath("steps[2]")).toEqual({ path: [{ kind: "root", index: 2 }] });
  });

  it("returns null for paths that are not about a step", () => {
    expect(issueStepPath("steps")).toBeNull();
    expect(issueStepPath("trigger.keywords")).toBeNull();
  });
});

describe("send_media vs condition", () => {
  const media = (media_type: string, url: string) => ({ step_type: "send_media", step_config: { media_type, url } });

  it("accepts every WhatsApp media type with a direct file link and never asks for an operand", () => {
    expect(
      validateStepsForActivation([
        media("image", "https://cdn.example.com/a.jpg"),
        media("video", "https://cdn.example.com/a.mp4"),
        media("document", "https://cdn.example.com/a.pdf"),
        media("audio", "https://cdn.example.com/a.ogg"),
        media("video", "{{ vars.video_url }}"),
      ]),
    ).toEqual([]);
  });

  it("rejects a YouTube page as media and points to a text message instead", () => {
    expect(validateStepsForActivation([media("video", "https://youtu.be/0Ab-F7Y3IXc")])).toEqual([
      {
        path: "steps[0].url",
        message: "YouTube links can't be sent as media, send the link in a Send Message step instead",
      },
    ]);
  });

  it("still requires url and media type", () => {
    expect(validateStepsForActivation([{ step_type: "send_media", step_config: {} }]).map((i) => i.path)).toEqual([
      "steps[0].url",
      "steps[0].media_type",
    ]);
  });

  it("only condition steps need an operand, wherever they sit", () => {
    const issues = validateStepsForActivation([
      media("video", "https://cdn.example.com/a.mp4"),
      {
        step_type: "condition",
        step_config: { subject: "message_content", operand: "" },
        branches: {
          yes: [media("image", "https://cdn.example.com/a.jpg")],
          no: [{ step_type: "condition", step_config: { subject: "tag_presence", operand: "" } }],
        },
      },
    ]);
    expect(issues).toEqual([
      { path: "steps[1].operand", message: "condition operand is required" },
      { path: "steps[1].no.steps[0].operand", message: "condition operand is required" },
    ]);
  });

  it("the current Coca-Cola steps raise no operand issue, only the YouTube-as-media one", () => {
    const coke = [
      { step_type: "send_message", step_config: { text: "Welcome to Coca-Cola!" } },
      { step_type: "send_media", step_config: { url: "https://youtu.be/0Ab-F7Y3IXc", caption: "Win With Coke!", media_type: "video" } },
      { step_type: "ask_question", step_config: { text: "Who will you share a Coke with?", var_key: "answer", timeout_hours: 48 } },
      { step_type: "send_message", step_config: { text: "{{ entry.reference }} thanks" } },
    ];
    const issues = annotateIssues(validateStepsForActivation(coke), coke);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "steps[1].url", step_type: "send_media" });
    expect(issues.some((i) => i.message.includes("operand"))).toBe(false);

    const asLink = [...coke];
    asLink[1] = { step_type: "send_message", step_config: { text: "Win With Coke!\nhttps://youtu.be/0Ab-F7Y3IXc" } };
    expect(validateStepsForActivation(asLink)).toEqual([]);
  });
});
