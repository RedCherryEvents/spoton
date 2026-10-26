#!/usr/bin/env node
// Rebuild "SPOTON — Universal Welcome" from the preset in
// src/lib/campaigns/presets/spoton-campaigns.ts.
//
//   node scripts/setup-universal-welcome.mjs           # dry run
//   node scripts/setup-universal-welcome.mjs --apply   # write (backup first)
//
// Creates the "SPOT ON welcomed" tag if missing, replaces the steps,
// clears the unused trigger config, and expires reply waits of the old
// version (they swallowed the customer's next message). Keeps the
// automation's on/off state. Needs Node 22.18+ and .env.local.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { UNIVERSAL_WELCOME, universalWelcomeSteps } from '../src/lib/campaigns/presets/spoton-campaigns.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const { createClient } = require('@supabase/supabase-js')
const APPLY = process.argv.includes('--apply')
const fail = (m) => { console.error(`\n✖ ${m}`); process.exit(1) }

const env = { ...process.env }
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: autos } = await db.from('automations').select('*').eq('name', UNIVERSAL_WELCOME.name)
if (autos?.length !== 1) fail(`expected one automation named "${UNIVERSAL_WELCOME.name}", found ${autos?.length ?? 0}`)
const auto = autos[0]
const { data: oldSteps } = await db.from('automation_steps').select('*').eq('automation_id', auto.id)
const { data: waits } = await db
  .from('automation_pending_executions')
  .select('id, log_id, contact_id, run_at, created_at')
  .eq('automation_id', auto.id)
  .in('status', ['pending', 'running'])

console.log(APPLY ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)')
console.log(`Automation "${auto.name}" (${auto.is_active ? 'active' : 'inactive'}), ${oldSteps.length} current steps, ${waits.length} open reply waits`)
if (!APPLY) {
  console.log('Would: create tag if missing, replace steps, clear trigger config, expire open waits.')
  process.exit(0)
}

const backup = path.join(root, 'docs', 'campaign-cleanup-2026-10-26', `universal-welcome-before-${Date.now()}.json`)
fs.writeFileSync(backup, JSON.stringify({ automation: auto, automation_steps: oldSteps, open_waits: waits }, null, 1))
console.log('backup →', path.relative(root, backup))

// Tag
let { data: tag } = await db.from('tags').select('id').eq('account_id', auto.account_id).eq('name', UNIVERSAL_WELCOME.tagName).maybeSingle()
if (!tag) {
  const res = await db.from('tags').insert({ account_id: auto.account_id, user_id: auto.user_id, name: UNIVERSAL_WELCOME.tagName, color: '#e11d48' }).select('id').single()
  if (res.error) fail(`tag insert: ${res.error.message}`)
  tag = res.data
  console.log(`✔ created tag "${UNIVERSAL_WELCOME.tagName}"`)
} else console.log(`✔ tag "${UNIVERSAL_WELCOME.tagName}" exists`)

// Old waits: expire them (same as the engine's expireReplyWait).
for (const w of waits) {
  await db.from('automation_pending_executions').update({ status: 'failed' }).eq('id', w.id)
  if (w.log_id) await db.from('automation_logs').update({ status: 'failed', error_message: 'reply wait removed when the welcome was rebuilt' }).eq('id', w.log_id)
  console.log(`✔ expired open reply wait from ${w.created_at}`)
}

// Steps
const rows = []
const walk = (list, parentId, branch) =>
  list.forEach((s, position) => {
    const id = crypto.randomUUID()
    rows.push({ id, automation_id: auto.id, parent_step_id: parentId, branch, step_type: s.step_type, step_config: { ...s.step_config, node_id: `c_${id}` }, position })
    if (s.branches?.yes) walk(s.branches.yes, id, 'yes')
    if (s.branches?.no) walk(s.branches.no, id, 'no')
  })
walk(universalWelcomeSteps(tag.id), null, null)

const del = await db.from('automation_steps').delete().eq('automation_id', auto.id)
if (del.error) fail(`delete old steps: ${del.error.message}`)
const ins = await db.from('automation_steps').insert(rows)
if (ins.error) {
  await db.from('automation_steps').insert(oldSteps)
  fail(`insert new steps failed, old steps restored: ${ins.error.message}`)
}
const upd = await db.from('automations').update({ trigger_config: {}, description: UNIVERSAL_WELCOME.description }).eq('id', auto.id)
if (upd.error) fail(`update automation: ${upd.error.message}`)
console.log(`✔ rebuilt "${auto.name}" (${rows.length} steps, still ${auto.is_active ? 'active' : 'inactive'})`)
