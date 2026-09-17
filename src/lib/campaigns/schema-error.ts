import { NextResponse } from "next/server";

/**
 * PostgREST returns this when the table exists in SQL but isn't in
 * the API schema cache yet — or when the campaigns migration hasn't
 * been applied. Surface a setup hint instead of the raw cache error.
 */
export function isMissingRelationError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    /Could not find the table/i.test(error.message ?? "") ||
    /schema cache/i.test(error.message ?? "")
  );
}

export function campaignsNotReadyResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Campaigns isn't set up on this database yet. Apply supabase/migrations/040_campaigns_and_inbound_wait.sql and 041_campaign_entries_reporting.sql, then reload.",
    },
    { status: 503 },
  );
}
