import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { drawWinner, eligiblePoolIds, poolHash } from "./draw";

const entries = [
  { id: "c", status: "completed", metadata: {} },
  { id: "a", status: "completed", metadata: null },
  { id: "t", status: "completed", metadata: { test: true } },
  { id: "d", status: "duplicate", metadata: {} },
  { id: "p", status: "in_progress", metadata: {} },
  { id: "b", status: "completed" },
];

describe("winner draw", () => {
  it("draws only from Completed, non-test entries, in a stable order", () => {
    expect(eligiblePoolIds(entries)).toEqual(["a", "b", "c"]);
  });

  it("records the pool, its hash and the index it picked", () => {
    const result = drawWinner(entries, () => 1);
    expect(result).toEqual({
      pool_entry_ids: ["a", "b", "c"],
      pool_size: 3,
      pool_hash: createHash("sha256").update("a,b,c").digest("hex"),
      random_index: 1,
      winner_entry_id: "b",
    });
    expect(poolHash(["a", "b", "c"])).toBe(result!.pool_hash);
  });

  it("returns null when nobody is eligible, and rejects an out-of-range index", () => {
    expect(drawWinner([{ id: "x", status: "in_progress" }])).toBeNull();
    expect(() => drawWinner(entries, () => 3)).toThrow(/out of range/);
  });

  it("uses a secure random index by default, always inside the pool", () => {
    for (let i = 0; i < 50; i++) {
      const r = drawWinner(entries)!;
      expect(r.pool_entry_ids).toContain(r.winner_entry_id);
      expect(r.random_index).toBeGreaterThanOrEqual(0);
      expect(r.random_index).toBeLessThan(3);
    }
  });
});
