import { describe, it, expect } from "vitest";
import {
  NO_CAMPAIGN,
  groupConversationsByCampaign,
  matchesContactFilters,
  normalizeConversation,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
  id = "c1",
  unread = 0,
): Conversation {
  return {
    id,
    unread_count: unread,
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });

  it("flattens campaign_entries into distinct campaign_ids, newest entry first", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        campaign_entries: [
          { campaign_id: "icc", created_at: "2026-10-01T10:00:00Z" },
          { campaign_id: "coke", created_at: "2026-10-13T10:00:00Z" },
          { campaign_id: "icc", created_at: "2026-10-05T10:00:00Z" },
        ],
      },
    };
    const contact = normalizeConversation(raw).contact as unknown as Record<string, unknown>;
    expect(contact.campaign_ids).toEqual(["coke", "icc"]);
    expect(contact.campaign_entries).toBeUndefined();
  });

  it("leaves campaign_ids unset when entries weren't selected", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
      },
    };
    expect(normalizeConversation(raw).contact).not.toHaveProperty("campaign_ids");
  });
});

describe("campaign filter", () => {
  const inCoke = makeConversation({ campaign_ids: ["coke", "icc"] });
  const inNone = makeConversation({ campaign_ids: [] });

  it("matches any campaign the contact has an entry in", () => {
    expect(matchesContactFilters(inCoke, { tagIds: [], company: null, campaignId: "icc" })).toBe(true);
    expect(matchesContactFilters(inCoke, { tagIds: [], company: null, campaignId: "bmw" })).toBe(false);
  });

  it("matches only contacts with no entries for NO_CAMPAIGN", () => {
    expect(matchesContactFilters(inNone, { tagIds: [], company: null, campaignId: NO_CAMPAIGN })).toBe(true);
    expect(matchesContactFilters(makeConversation(null), { tagIds: [], company: null, campaignId: NO_CAMPAIGN })).toBe(true);
    expect(matchesContactFilters(inCoke, { tagIds: [], company: null, campaignId: NO_CAMPAIGN })).toBe(false);
  });
});

describe("groupConversationsByCampaign", () => {
  it("groups each conversation once under its newest campaign, keeping order and putting no-campaign last", () => {
    const groups = groupConversationsByCampaign([
      makeConversation({ campaign_ids: [] }, "a", 2),
      makeConversation({ campaign_ids: ["coke", "icc"] }, "b", 11),
      makeConversation({ campaign_ids: ["icc"] }, "c", 0),
      makeConversation(null, "d", 1),
      makeConversation({ campaign_ids: ["coke"] }, "e", 0),
    ]);
    expect(groups.map((g) => [g.key, g.conversations.map((c) => c.id), g.unread])).toEqual([
      ["coke", ["b", "e"], 11],
      ["icc", ["c"], 0],
      [NO_CAMPAIGN, ["a", "d"], 3],
    ]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupConversationsByCampaign([])).toEqual([]);
  });
});
