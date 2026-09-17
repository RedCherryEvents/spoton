import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shared auth for the scheduled drain endpoints
 * (`/api/automations/cron`, `/api/flows/cron`).
 *
 * Accepts either:
 *   - `x-cron-secret: <secret>` (external pingers / Docker docs)
 *   - `Authorization: Bearer <secret>` (Vercel Cron injects
 *     `CRON_SECRET` this way)
 *
 * Valid secrets are `AUTOMATION_CRON_SECRET` and, if set, Vercel's
 * auto-provisioned `CRON_SECRET`. Operators only need one; both are
 * accepted so a Vercel deploy works without renaming env vars.
 *
 * Returns a JSON error response on failure, or `null` when the
 * request is authorized.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const expected = uniqueNonEmpty([
    process.env.AUTOMATION_CRON_SECRET,
    process.env.CRON_SECRET,
  ]);
  if (expected.length === 0) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }

  const supplied = uniqueNonEmpty([
    request.headers.get("x-cron-secret"),
    bearerToken(request.headers.get("authorization")),
  ]);

  for (const got of supplied) {
    for (const exp of expected) {
      if (secretsEqual(got, exp)) return null;
    }
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? null;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function secretsEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
