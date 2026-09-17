import { describe, expect, it } from "vitest";
import { scheduleMatchesNow } from "./schedule";

describe("scheduleMatchesNow", () => {
  const noon = new Date("2026-03-09T12:00:00");

  it("matches HH:mm in local time", () => {
    const hh = String(noon.getHours()).padStart(2, "0");
    const mm = String(noon.getMinutes()).padStart(2, "0");
    expect(scheduleMatchesNow(`${hh}:${mm}`, undefined, noon)).toBe(true);
    expect(scheduleMatchesNow("00:00", undefined, noon)).toBe(false);
  });

  it("matches a 5-field cron on minute and hour", () => {
    expect(scheduleMatchesNow(`${noon.getMinutes()} ${noon.getHours()} * * *`, undefined, noon)).toBe(true);
    expect(scheduleMatchesNow("0 0 * * *", undefined, noon)).toBe(false);
  });

  it("rejects empty or unknown formats", () => {
    expect(scheduleMatchesNow("", undefined, noon)).toBe(false);
    expect(scheduleMatchesNow("daily", undefined, noon)).toBe(false);
  });
});
