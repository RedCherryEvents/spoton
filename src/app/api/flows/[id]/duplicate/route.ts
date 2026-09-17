import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * POST /api/flows/[id]/duplicate
 *
 * Clones a flow the caller can see into a new draft, including its
 * node graph. Always lands as `draft` with a fresh execution count
 * so a copy of a live flow can't start answering customers until
 * someone activates it.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS scopes this to the caller's account — a flow they don't own
  // returns null (404 below) rather than leaking existence.
  const { data: original } = await supabase
    .from("flows")
    .select(
      "id, account_id, name, description, trigger_type, trigger_config, entry_node_id, fallback_policy",
    )
    .eq("id", id)
    .maybeSingle();
  if (!original) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = supabaseAdmin();
  const { data: copy, error: copyErr } = await admin
    .from("flows")
    .insert({
      account_id: original.account_id,
      user_id: user.id,
      name: `${original.name} (Copy)`,
      description: original.description,
      status: "draft",
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      entry_node_id: original.entry_node_id,
      fallback_policy: original.fallback_policy,
    })
    .select()
    .single();
  if (copyErr || !copy) {
    return NextResponse.json(
      { error: copyErr?.message ?? "copy failed" },
      { status: 500 },
    );
  }

  const { data: nodes, error: nodesErr } = await supabase
    .from("flow_nodes")
    .select("node_key, node_type, config, position_x, position_y")
    .eq("flow_id", id);
  if (nodesErr) {
    await admin.from("flows").delete().eq("id", copy.id);
    return NextResponse.json({ error: nodesErr.message }, { status: 500 });
  }

  if (nodes && nodes.length > 0) {
    const { error: insErr } = await admin.from("flow_nodes").insert(
      nodes.map((n) => ({
        flow_id: copy.id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
        position_x: n.position_x ?? 0,
        position_y: n.position_y ?? 0,
      })),
    );
    if (insErr) {
      await admin.from("flows").delete().eq("id", copy.id);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ flow: copy }, { status: 201 });
}
