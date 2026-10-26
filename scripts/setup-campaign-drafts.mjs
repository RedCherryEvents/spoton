#!/usr/bin/env node
// Rebuild the BMW test-drive automation and create a draft Flow per campaign.
//
//   node scripts/setup-campaign-drafts.mjs           # dry run
//   node scripts/setup-campaign-drafts.mjs --apply   # write
//
// - BMW: replaces the steps of "BMW — Test Drive Campaign Automation"
//   with the clean version in src/lib/campaigns/presets/spoton-campaigns.ts,
//   adds its campaign fields, and leaves it INACTIVE. Refuses if the
//   automation is active (edit it in the app instead).
// - Flows: creates each preset flow as a DRAFT with a manual trigger,
//   for campaigns that exist. Skips any flow whose name already exists.
//   With --refresh-flows, a preset flow that already exists AND is still
//   a draft gets its nodes replaced by the preset's.
// Nothing is activated. Needs Node 22.18+ and .env.local.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  BMW_AUTOMATION,
  BMW_FIELDS,
  CAMPAIGN_FLOWS,
  bmwSteps,
  bmwTriggerConfig,
} from '../src/lib/campaigns/presets/spoton-campaigns.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const { createClient } = require('@supabase/supabase-js')
const APPLY = process.argv.includes('--apply')
const REFRESH_FLOWS = process.argv.includes('--refresh-flows')

function fail(msg) {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

const env = { ...process.env }
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/** Builder tree → automation_steps rows (same walk as steps-tree.ts insertSteps). */
function flattenSteps(automationId, tree) {
  const rows = []
  const walk = (steps, parentId, branch) =>
    steps.forEach((s, position) => {
      const id = crypto.randomUUID()
      rows.push({ id, automation_id: automationId, parent_step_id: parentId, branch, step_type: s.step_type, step_config: { ...s.step_config, node_id: `c_${id}` }, position })
      if (s.branches?.yes) walk(s.branches.yes, id, 'yes')
      if (s.branches?.no) walk(s.branches.no, id, 'no')
    })
  walk(tree, null, null)
  return rows
}

console.log(APPLY ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)')

// ---- BMW automation ----
const { data: bmwCampaigns } = await db.from('campaigns').select('id, account_id, name').eq('code', 'BMWTEST2026')
if (!bmwCampaigns?.length) fail('BMW campaign (code BMWTEST2026) not found')
if (bmwCampaigns.length > 1) fail('more than one BMW campaign; resolve that first')
const bmwCampaign = bmwCampaigns[0]
const accountId = bmwCampaign.account_id

const { data: bmwAutos } = await db.from('automations').select('id, user_id, is_active').eq('account_id', accountId).eq('name', BMW_AUTOMATION.name)
if (bmwAutos?.length !== 1) fail(`expected exactly one automation named "${BMW_AUTOMATION.name}"`)
const bmw = bmwAutos[0]
if (bmw.is_active) fail('the BMW automation is active; deactivate it first, or edit it in the app')
const { count: waiting } = await db.from('automation_pending_executions').select('id', { count: 'exact', head: true }).eq('automation_id', bmw.id).in('status', ['pending', 'running'])
if (waiting) fail(`${waiting} BMW runs are mid-wait; not replacing their steps`)

const rows = flattenSteps(bmw.id, bmwSteps(bmwCampaign.id))
if (!APPLY) {
  console.log(`Would rebuild "${BMW_AUTOMATION.name}" (${rows.length} steps, stays inactive) and add fields: ${BMW_FIELDS.map((f) => f.key).join(', ')}`)
} else {
  for (const [position, f] of BMW_FIELDS.entries()) {
    const { error } = await db.from('campaign_field_definitions').upsert(
      { ...f, campaign_id: bmwCampaign.id, account_id: accountId, required: false, position },
      { onConflict: 'campaign_id,key', ignoreDuplicates: true },
    )
    if (error) fail(`field ${f.key}: ${error.message}`)
  }
  const { data: oldSteps } = await db.from('automation_steps').select('*').eq('automation_id', bmw.id)
  const { error: delErr } = await db.from('automation_steps').delete().eq('automation_id', bmw.id)
  if (delErr) fail(`delete old BMW steps: ${delErr.message}`)
  const { error: insErr } = await db.from('automation_steps').insert(rows)
  if (insErr) {
    await db.from('automation_steps').insert(oldSteps)
    fail(`insert BMW steps failed, old steps restored: ${insErr.message}`)
  }
  const { error: updErr } = await db
    .from('automations')
    .update({ trigger_config: bmwTriggerConfig(bmwCampaign.id), description: BMW_AUTOMATION.description, is_active: false })
    .eq('id', bmw.id)
  if (updErr) fail(`update BMW automation: ${updErr.message}`)
  console.log(`✔ rebuilt "${BMW_AUTOMATION.name}" (${rows.length} steps, inactive); fields ${BMW_FIELDS.map((f) => f.key).join(', ')}`)
}

// ---- Draft flows ----
const { data: campaigns } = await db.from('campaigns').select('id, code, name, user_id').eq('account_id', accountId)
const { data: flows } = await db.from('flows').select('id, name, status').eq('account_id', accountId)
const existingFlows = new Map((flows ?? []).map((f) => [f.name, f]))
for (const preset of CAMPAIGN_FLOWS) {
  const campaign = campaigns.find((c) => c.code === preset.campaign_code)
  if (!campaign) {
    console.log(`- skip "${preset.name}": campaign ${preset.campaign_code} not found`)
    continue
  }
  const current = existingFlows.get(preset.name)
  if (current && REFRESH_FLOWS && current.status === 'draft') {
    if (!APPLY) {
      console.log(`Would refresh draft flow "${preset.name}" (${preset.nodes.length} nodes)`)
      continue
    }
    const { data: oldNodes } = await db.from('flow_nodes').select('*').eq('flow_id', current.id)
    await db.from('flow_nodes').delete().eq('flow_id', current.id)
    const { error: insErr } = await db
      .from('flow_nodes')
      .insert(preset.nodes.map((n) => ({ flow_id: current.id, node_key: n.node_key, node_type: n.node_type, config: n.config })))
    if (insErr) {
      await db.from('flow_nodes').insert(oldNodes)
      fail(`refresh "${preset.name}" failed, old nodes restored: ${insErr.message}`)
    }
    await db.from('flows').update({ entry_node_id: preset.entry_node_id, description: preset.description }).eq('id', current.id)
    console.log(`✔ refreshed draft flow "${preset.name}" (${preset.nodes.length} nodes)`)
    continue
  }
  if (current) {
    console.log(`✔ "${preset.name}" already exists (${current.status}); left unchanged`)
    continue
  }
  if (!APPLY) {
    console.log(`Would create draft flow "${preset.name}" (${preset.nodes.length} nodes, manual trigger)`)
    continue
  }
  const { data: flow, error } = await db
    .from('flows')
    .insert({
      account_id: accountId,
      user_id: campaign.user_id,
      name: preset.name,
      description: preset.description,
      status: 'draft',
      trigger_type: preset.trigger_type,
      trigger_config: preset.trigger_config,
      entry_node_id: preset.entry_node_id,
    })
    .select('id')
    .single()
  if (error) fail(`flow "${preset.name}": ${error.message}`)
  const { error: nodesErr } = await db
    .from('flow_nodes')
    .insert(preset.nodes.map((n) => ({ flow_id: flow.id, node_key: n.node_key, node_type: n.node_type, config: n.config })))
  if (nodesErr) {
    await db.from('flows').delete().eq('id', flow.id)
    fail(`flow "${preset.name}" nodes failed (flow removed again): ${nodesErr.message}`)
  }
  console.log(`✔ created draft flow "${preset.name}" (${preset.nodes.length} nodes)`)
}
console.log('\nNothing was activated.')
