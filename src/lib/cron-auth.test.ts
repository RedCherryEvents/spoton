import { afterEach, describe, expect, it } from "vitest";
import { authorizeCron } from "./cron-auth";

const ORIG_AUTO = process.env.AUTOMATION_CRON_SECRET;
const ORIG_CRON = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIG_AUTO === undefined) delete process.env.AUTOMATION_CRON_SECRET;
  else process.env.AUTOMATION_CRON_SECRET = ORIG_AUTO;
  if (ORIG_CRON === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIG_CRON;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/flows/cron", { headers });
}

describe("authorizeCron", () => {
  it("returns 503 when no cron secret is configured", async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    delete process.env.CRON_SECRET;
    const res = authorizeCron(req({ "x-cron-secret": "anything" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
  });

  it("accepts x-cron-secret matching AUTOMATION_CRON_SECRET", () => {
    process.env.AUTOMATION_CRON_SECRET = "auto-secret";
    delete process.env.CRON_SECRET;
    expect(authorizeCron(req({ "x-cron-secret": "auto-secret" }))).toBeNull();
  });

  it("accepts Authorization Bearer matching CRON_SECRET (Vercel Cron)", () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    process.env.CRON_SECRET = "vercel-secret";
    expect(
      authorizeCron(req({ authorization: "Bearer vercel-secret" })),
    ).toBeNull();
  });

  it("rejects a mismatched secret", async () => {
    process.env.AUTOMATION_CRON_SECRET = "auto-secret";
    const res = authorizeCron(req({ "x-cron-secret": "nope" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a truncated secret (length must match)", async () => {
    process.env.AUTOMATION_CRON_SECRET = "auto-secret";
    const res = authorizeCron(req({ "x-cron-secret": "auto" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});
