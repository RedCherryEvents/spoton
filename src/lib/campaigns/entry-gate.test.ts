import { describe, expect, it } from "vitest";
import { campaignEntryGate, isTestNumber } from "./entry-gate";

const NOW = new Date("2026-11-15T12:00:00Z");
const base = { status: "active" as const, starts_at: null, ends_at: null, settings: {} };

describe("campaignEntryGate", () => {
  it("an active campaign without dates is open", () => {
    expect(campaignEntryGate(base, "27821234567", NOW)).toEqual({ open: true, test: false });
  });

  it("enforces opening and closing dates", () => {
    expect(campaignEntryGate({ ...base, starts_at: "2026-12-01T00:00:00Z" }, "27821234567", NOW)).toEqual({
      open: false,
      reason: "not_started",
    });
    expect(campaignEntryGate({ ...base, ends_at: "2026-11-01T00:00:00Z" }, "27821234567", NOW)).toEqual({
      open: false,
      reason: "ended",
    });
    expect(
      campaignEntryGate({ ...base, starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-30T23:59:59Z" }, "27821234567", NOW),
    ).toEqual({ open: true, test: false });
  });

  it("paused, closed and archived campaigns take no entries", () => {
    for (const status of ["paused", "closed", "archived"] as const) {
      expect(campaignEntryGate({ ...base, status }, "27821234567", NOW)).toEqual({ open: false, reason: status });
    }
  });

  it("a draft only lets its test numbers in, as test entries, whatever the dates", () => {
    const draft = { ...base, status: "draft" as const, starts_at: "2027-01-01T00:00:00Z", settings: { test_numbers: ["27821234567"] } };
    expect(campaignEntryGate(draft, "27821234567", NOW)).toEqual({ open: true, test: true });
    expect(campaignEntryGate(draft, "27839999999", NOW)).toEqual({ open: false, reason: "draft" });
    expect(campaignEntryGate({ ...draft, settings: {} }, "27821234567", NOW)).toEqual({ open: false, reason: "draft" });
  });
});

describe("isTestNumber", () => {
  it("matches with or without country code and formatting", () => {
    expect(isTestNumber("27821234567", ["+27 82 123 4567"])).toBe(true);
    expect(isTestNumber("27821234567", ["0821234567"])).toBe(true);
    expect(isTestNumber("27821234567", ["27821234568"])).toBe(false);
    expect(isTestNumber("", ["27821234567"])).toBe(false);
    expect(isTestNumber("27821234567", undefined)).toBe(false);
  });
});
