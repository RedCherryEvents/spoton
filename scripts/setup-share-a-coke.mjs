#!/usr/bin/env node
// Turn the Coca-Cola Summer Competition into "Share a Coke — Win R20,000",
// in place (same campaign, automation and flow rows; existing entries kept).
//
//   node scripts/setup-share-a-coke.mjs           # dry run
//   node scripts/setup-share-a-coke.mjs --apply   # write (backup first)
//
// Leaves everything in DRAFT: the campaign status is set to draft and
// the automation is switched OFF. Nothing is sent to anyone. To test,
// add test numbers on the campaign's Settings tab and switch the
// automation on: while the campaign is Draft only those numbers get in.
// Open reply waits on the old steps are ended (their positions change).
// Needs Node 22.18+ and .env.local.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  SHARE_A_COKE_AUTOMATION,
  SHARE_A_COKE_CAMPAIGN,
  SHARE_A_COKE_FIELDS,
  SHARE_A_COKE_KEYWORD,
  SHARE_A_COKE_LEGACY_AUTOMATION_NAME,
  SHARE_A_COKE_LEGACY_CODE,
  shareACokeSteps,
  shareACokeTriggerConfig,
} from '../src/lib/campaigns/presets/share-a-coke.ts'
import { CAMPAIGN_FLOWS } from '../src/lib/campaigns/presets/spoton-campaigns.ts'
import { keywordTextMatches } from '../src/lib/automations/keyword-match.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const { createClient } = require('@supabase/supabase-js')
const APPLY = process.argv.includes('--apply')
const fail = (m) => {
  console.error(`\n✖ ${m}`)
  process.exit(1)
}

const env = { ...process.env }
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

console.log(APPLY ? 'Mode: APPLY (everything stays draft / off)' : 'Mode: dry run (pass --apply to write)')

// Campaign: new code, or the legacy Coca-Cola one.
const { data: matches } = await db
  .from('campaigns')
  .select('*')
  .in('code', [SHARE_A_COKE_CAMPAIGN.code, SHARE_A_COKE_LEGACY_CODE])
if (!matches?.length) fail(`no campaign with code ${SHARE_A_COKE_CAMPAIGN.code} or ${SHARE_A_COKE_LEGACY_CODE}`)
if (matches.length > 1) fail('both the new and the legacy campaign exist; resolve that first')
const campaign = matches[0]
const accountId = campaign.account_id

// Nobody else may listen for SHAREACOKE.
const [{ data: automations }, { data: flows }, { data: others }] = await Promise.all([
  db.from('automations').select('id, name, is_active, trigger_type, trigger_config, user_id').eq('account_id', accountId),
  db.from('flows').select('id, name, status, trigger_type, trigger_config').eq('account_id', accountId),
  db.from('campaigns').select('id, name, keyword').eq('account_id', accountId),
])
const auto = automations.find((a) => a.name === SHARE_A_COKE_AUTOMATION.name || a.name === SHARE_A_COKE_LEGACY_AUTOMATION_NAME)
if (!auto) fail(`automation "${SHARE_A_COKE_LEGACY_AUTOMATION_NAME}" not found`)
for (const c of others) {
  if (c.id === campaign.id) continue
  if (String(c.keyword ?? '').split(',').some((k) => k.trim().toLowerCase() === SHARE_A_COKE_KEYWORD.toLowerCase())) {
    fail(`campaign "${c.name}" already uses ${SHARE_A_COKE_KEYWORD}`)
  }
}
for (const a of automations) {
  if (a.id === auto.id || !a.is_active || a.trigger_type !== 'keyword_match') continue
  if (keywordTextMatches(a.trigger_config ?? {}, SHARE_A_COKE_KEYWORD)) fail(`active automation "${a.name}" already fires on ${SHARE_A_COKE_KEYWORD}`)
}
for (const f of flows.filter((x) => x.status === 'active' && x.trigger_type === 'keyword')) {
  const kws = (f.trigger_config?.keywords ?? []).map((k) => String(k).toLowerCase())
  if (kws.some((k) => SHARE_A_COKE_KEYWORD.toLowerCase().includes(k))) fail(`active flow "${f.name}" would catch ${SHARE_A_COKE_KEYWORD}`)
}
const { count: entryCount } = await db.from('campaign_entries').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id)
console.log(`✔ campaign "${campaign.name}" (${campaign.status}, ${entryCount} entries) and automation "${auto.name}" (${auto.is_active ? 'ON' : 'off'}) found; nothing else listens for ${SHARE_A_COKE_KEYWORD}`)

if (!APPLY) {
  console.log(`Would: rename to "${SHARE_A_COKE_CAMPAIGN.name}" (draft), keyword ${SHARE_A_COKE_KEYWORD}, replace the automation steps (switched off), refresh the flow copy.`)
  process.exit(0)
}

// Backup
const { data: oldSteps } = await db.from('automation_steps').select('*').eq('automation_id', auto.id)
const backup = path.join(root, 'docs', 'share-a-coke', `before-${Date.now()}.json`)
fs.mkdirSync(path.dirname(backup), { recursive: true })
fs.writeFileSync(backup, JSON.stringify({ campaign, automation: auto, automation_steps: oldSteps }, null, 1))
console.log('backup →', path.relative(root, backup))

// Switch the automation off first, so nothing runs half-updated.
{ const { error } = await db.from('automations').update({ is_active: false }).eq('id', auto.id); if (error) fail(error.message) }

// Campaign → Share a Coke, Draft. Existing settings (WhatsApp number etc.) kept.
{
  const settings = { ...(campaign.settings ?? {}), ...SHARE_A_COKE_CAMPAIGN.settings }
  if (campaign.settings?.terms_url) settings.terms_url = campaign.settings.terms_url
  if (campaign.settings?.test_numbers) settings.test_numbers = campaign.settings.test_numbers
  const { error } = await db
    .from('campaigns')
    .update({
      name: SHARE_A_COKE_CAMPAIGN.name,
      code: SHARE_A_COKE_CAMPAIGN.code,
      keyword: SHARE_A_COKE_CAMPAIGN.keyword,
      description: SHARE_A_COKE_CAMPAIGN.description,
      status: 'draft',
      settings,
    })
    .eq('id', campaign.id)
  if (error) fail(`campaign update: ${error.message}`)
  console.log(`✔ campaign is now "${SHARE_A_COKE_CAMPAIGN.name}" (draft, keyword ${SHARE_A_COKE_KEYWORD}); existing entries kept`)
}

for (const [position, f] of SHARE_A_COKE_FIELDS.entries()) {
  const { error } = await db.from('campaign_field_definitions').upsert(
    { ...f, campaign_id: campaign.id, account_id: accountId, required: false, position },
    { onConflict: 'campaign_id,key', ignoreDuplicates: true },
  )
  if (error) fail(`field ${f.key}: ${error.message}`)
}
console.log(`✔ campaign field: ${SHARE_A_COKE_FIELDS.map((f) => f.key).join(', ')}`)

// End reply waits on the old steps.
const { data: waits } = await db
  .from('automation_pending_executions')
  .select('id, log_id, created_at')
  .eq('automation_id', auto.id)
  .in('status', ['pending', 'running'])
for (const w of waits ?? []) {
  await db.from('automation_pending_executions').update({ status: 'failed' }).eq('id', w.id)
  if (w.log_id) await db.from('automation_logs').update({ status: 'failed', error_message: 'run ended when the automation was replaced' }).eq('id', w.log_id)
  console.log(`✔ ended an open reply wait from ${w.created_at}`)
}

// Automation steps
const rows = []
const walk = (list, parentId, branch) =>
  list.forEach((s, position) => {
    const id = crypto.randomUUID()
    rows.push({ id, automation_id: auto.id, parent_step_id: parentId, branch, step_type: s.step_type, step_config: { ...s.step_config, node_id: `c_${id}` }, position })
    if (s.branches?.yes) walk(s.branches.yes, id, 'yes')
    if (s.branches?.no) walk(s.branches.no, id, 'no')
  })
walk(shareACokeSteps(campaign.id), null, null)
{ const { error } = await db.from('automation_steps').delete().eq('automation_id', auto.id); if (error) fail(error.message) }
{
  const { error } = await db.from('automation_steps').insert(rows)
  if (error) {
    await db.from('automation_steps').insert(oldSteps)
    fail(`insert steps failed, old steps restored: ${error.message}`)
  }
}
{
  const { error } = await db
    .from('automations')
    .update({
      name: SHARE_A_COKE_AUTOMATION.name,
      description: SHARE_A_COKE_AUTOMATION.description,
      trigger_config: shareACokeTriggerConfig(campaign.id),
      is_active: false,
    })
    .eq('id', auto.id)
  if (error) fail(error.message)
}
console.log(`✔ automation is now "${SHARE_A_COKE_AUTOMATION.name}" (${rows.length} steps, OFF)`)

// Flow copy (manual trigger, never starts on its own)
const preset = CAMPAIGN_FLOWS.find((f) => f.campaign_code === SHARE_A_COKE_CAMPAIGN.code)
const flow = flows.find((f) => f.name === preset.name || f.name === 'Coca-Cola Summer Competition — Flow')
if (flow) {
  if (flow.trigger_type !== 'manual') fail(`flow "${flow.name}" is not manual-trigger; not touching it`)
  const { data: oldNodes } = await db.from('flow_nodes').select('*').eq('flow_id', flow.id)
  await db.from('flow_nodes').delete().eq('flow_id', flow.id)
  const { error } = await db
    .from('flow_nodes')
    .insert(preset.nodes.map((n) => ({ flow_id: flow.id, node_key: n.node_key, node_type: n.node_type, config: n.config })))
  if (error) {
    await db.from('flow_nodes').insert(oldNodes)
    fail(`flow refresh failed, old nodes restored: ${error.message}`)
  }
  await db.from('flows').update({ name: preset.name, description: preset.description, entry_node_id: preset.entry_node_id, status: 'draft' }).eq('id', flow.id)
  console.log(`✔ flow "${flow.name}" is now "${preset.name}" (draft)`)
}

console.log('\nNothing was activated and nothing was sent.')
