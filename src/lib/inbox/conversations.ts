import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/**
 * Inbox-only variant that also embeds the contact's campaign entries, for
 * campaign filtering and grouping. Kept separate so the public API's
 * conversation payload and query cost don't change.
 */
export const INBOX_CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)), campaign_entries(campaign_id, created_at))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & {
  contact_tags?: { tags: Tag | null }[];
  campaign_entries?: { campaign_id: string; created_at: string }[] | null;
};
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/** Distinct campaign ids, ordered by each campaign's newest entry. */
function campaignIdsNewestFirst(
  entries: { campaign_id: string; created_at: string }[],
): string[] {
  const sorted = [...entries].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return Array.from(new Set(sorted.map((e) => e.campaign_id)));
}

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`, and
 * `campaign_entries` (when selected) into `contact.campaign_ids`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, campaign_entries, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
      ...(campaign_entries !== undefined && {
        campaign_ids: campaignIdsNewestFirst(campaign_entries ?? []),
      }),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

/** Campaign filter value for conversations whose contact is in no campaign. */
export const NO_CAMPAIGN = "__none__";

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
  /**
   * Campaign id (contact has an entry in it), {@link NO_CAMPAIGN}, or
   * null/undefined for no campaign filter.
   */
  campaignId?: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company, campaignId }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  if (campaignId) {
    const ids = conversation.contact?.campaign_ids ?? [];
    if (campaignId === NO_CAMPAIGN ? ids.length > 0 : !ids.includes(campaignId)) {
      return false;
    }
  }

  return true;
}

export interface CampaignGroup {
  /** Campaign id, or {@link NO_CAMPAIGN}. */
  key: string;
  conversations: Conversation[];
  unread: number;
}

/**
 * Group conversations under the campaign of the contact's newest entry, so
 * each conversation appears once. Groups keep the input order (the Inbox
 * passes conversations newest-activity first, so the busiest campaign leads);
 * the no-campaign group always comes last.
 */
export function groupConversationsByCampaign(
  conversations: Conversation[],
): CampaignGroup[] {
  const groups = new Map<string, CampaignGroup>();
  for (const conv of conversations) {
    const key = conv.contact?.campaign_ids?.[0] ?? NO_CAMPAIGN;
    let group = groups.get(key);
    if (!group) {
      group = { key, conversations: [], unread: 0 };
      groups.set(key, group);
    }
    group.conversations.push(conv);
    group.unread += conv.unread_count ?? 0;
  }
  const none = groups.get(NO_CAMPAIGN);
  groups.delete(NO_CAMPAIGN);
  const ordered = Array.from(groups.values());
  if (none) ordered.push(none);
  return ordered;
}
