#!/usr/bin/env node
// Rebuild "SPOTON — Universal Welcome" with the language choice, and
// create / refresh its two partners, from the presets in
// src/lib/campaigns/presets/spoton-campaigns.ts:
//
//   1. SPOTON — Universal Welcome   catch-all → language list (once per contact)
//   2. SPOTON — Language chosen     tap on a language → save it → campaign menu in that language
//   3. SPOTON — Change language     LANGUAGE / TAAL / ULIMI / ULWIMI / PUO → language list
//
//   node scripts/setup-universal-welcome.mjs           # dry run
//   node scripts/setup-universal-welcome.mjs --apply   # write (backup first)
//
// 2 and 3 get the same on/off state as the welcome: the welcome's list
// is useless if the tap has nothing to handle it. Creates the
// "SPOT ON welcomed" tag if missing ("Language: …" tags are created by
// the engine on first use). Expires open reply waits of the welcome.
// The new code (set_language step, translations) must be deployed
// BEFORE --apply on a live account. Needs Node 22.18+ and .env.local.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  CHANGE_LANGUAGE,
  LANGUAGE_CHOSEN,
  UNIVERSAL_WELCOME,
  changeLanguageSteps,
  changeLanguageTriggerConfig,
  languageChosenSteps,
  languageChosenTriggerConfig,
  universalWelcomeSteps,
} from '../src/lib/campaigns/presets/spoton-campaigns.ts'

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

const partners = [
  { preset: LANGUAGE_CHOSEN, trigger_type: 'interactive_reply', trigger_config: languageChosenTriggerConfig(), steps: (tagId) => languageChosenSteps(tagId) },
  { preset: CHANGE_LANGUAGE, trigger_type: 'keyword_match', trigger_config: changeLanguageTriggerConfig(), steps: () => changeLanguageSteps() },
]
const { data: existingPartners } = await db
  .from('automations')
  .select('*')
  .eq('account_id', auto.account_id)
  .in('name', partners.map((p) => p.preset.name))

// Keyword clash check: no other active keyword automation may own LANGUAGE etc.
const { data: keywordAutos } = await db
  .from('automations')
  .select('name, trigger_config, is_active')
  .eq('account_id', auto.account_id)
  .eq('trigger_type', 'keyword_match')
for (const a of keywordAutos ?? []) {
  if (a.name === CHANGE_LANGUAGE.name || !a.is_active) continue
  const theirs = (a.trigger_config?.keywords ?? []).map((k) => String(k).toUpperCase())
  const clash = CHANGE_LANGUAGE.keywords.filter((k) => theirs.includes(k))
  if (clash.length) fail(`"${a.name}" already uses ${clash.join(', ')}`)
}

console.log(APPLY ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)')
console.log(`Automation "${auto.name}" (${auto.is_active ? 'active' : 'inactive'}), ${oldSteps.length} current steps, ${waits.length} open reply waits`)
for (const p of partners) {
  const found = existingPartners.find((a) => a.name === p.preset.name)
  console.log(`"${p.preset.name}": ${found ? `exists (${found.is_active ? 'active' : 'inactive'}), steps will be replaced` : 'will be created'}; on/off will match the welcome (${auto.is_active ? 'ACTIVE' : 'inactive'})`)
}
if (!APPLY) {
  console.log('Would: create tag if missing, replace welcome steps with the language list, create/refresh the two partner automations, expire open waits.')
  process.exit(0)
}

const backup = path.join(root, 'docs', 'campaign-cleanup-2026-10-26', `universal-welcome-before-${Date.now()}.json`)
const partnerSteps = existingPartners.length
  ? (await db.from('automation_steps').select('*').in('automation_id', existingPartners.map((a) => a.id))).data
  : []
fs.writeFileSync(backup, JSON.stringify({ automation: auto, automation_steps: oldSteps, open_waits: waits, partners: existingPartners, partner_steps: partnerSteps }, null, 1))
console.log('backup →', path.relative(root, backup))

// Tag
let { data: tag } = await db.from('tags').select('id').eq('account_id', auto.account_id).eq('name', UNIVERSAL_WELCOME.tagName).maybeSingle()
if (!tag) {
  const res = await db.from('tags').insert({ account_id: auto.account_id, user_id: auto.user_id, name: UNIVERSAL_WELCOME.tagName, color: '#e11d48' }).select('id').single()
  if (res.error) fail(`tag insert: ${res.error.message}`)
  tag = res.data
  console.log(`✔ created tag "${UNIVERSAL_WELCOME.tagName}"`)
} else console.log(`✔ tag "${UNIVERSAL_WELCOME.tagName}" exists`)

/** Builder tree → automation_steps rows (same walk as steps-tree.ts insertSteps). */
function flatten(automationId, tree) {
  const rows = []
  const walk = (list, parentId, branch) =>
    list.forEach((s, position) => {
      const id = crypto.randomUUID()
      rows.push({ id, automation_id: automationId, parent_step_id: parentId, branch, step_type: s.step_type, step_config: { ...s.step_config, node_id: `c_${id}` }, position })
      if (s.branches?.yes) walk(s.branches.yes, id, 'yes')
      if (s.branches?.no) walk(s.branches.no, id, 'no')
    })
  walk(tree, null, null)
  return rows
}

async function replaceSteps(automationId, tree, label) {
  const { data: before } = await db.from('automation_steps').select('*').eq('automation_id', automationId)
  const rows = flatten(automationId, tree)
  const del = await db.from('automation_steps').delete().eq('automation_id', automationId)
  if (del.error) fail(`${label}: delete old steps: ${del.error.message}`)
  const ins = await db.from('automation_steps').insert(rows)
  if (ins.error) {
    if (before?.length) await db.from('automation_steps').insert(before)
    fail(`${label}: insert new steps failed, old steps restored: ${ins.error.message}`)
  }
  return rows.length
}

// Partners first, so the tap is handled before the welcome sends any list.
for (const p of partners) {
  let row = existingPartners.find((a) => a.name === p.preset.name)
  if (!row) {
    const res = await db
      .from('automations')
      .insert({
        account_id: auto.account_id,
        user_id: auto.user_id,
        name: p.preset.name,
        description: p.preset.description,
        trigger_type: p.trigger_type,
        trigger_config: p.trigger_config,
        is_active: false,
      })
      .select('*')
      .single()
    if (res.error) fail(`create "${p.preset.name}": ${res.error.message}`)
    row = res.data
  }
  const n = await replaceSteps(row.id, p.steps(tag.id), p.preset.name)
  const upd = await db
    .from('automations')
    .update({ description: p.preset.description, trigger_type: p.trigger_type, trigger_config: p.trigger_config, is_active: auto.is_active })
    .eq('id', row.id)
  if (upd.error) fail(`update "${p.preset.name}": ${upd.error.message}`)
  console.log(`✔ "${p.preset.name}" (${n} steps, ${auto.is_active ? 'ACTIVE' : 'inactive'})`)
}

// Old waits: expire them (same as the engine's expireReplyWait).
for (const w of waits) {
  await db.from('automation_pending_executions').update({ status: 'failed' }).eq('id', w.id)
  if (w.log_id) await db.from('automation_logs').update({ status: 'failed', error_message: 'reply wait removed when the welcome was rebuilt' }).eq('id', w.log_id)
  console.log(`✔ expired open reply wait from ${w.created_at}`)
}

const n = await replaceSteps(auto.id, universalWelcomeSteps(tag.id), auto.name)
const upd = await db.from('automations').update({ trigger_config: {}, description: UNIVERSAL_WELCOME.description }).eq('id', auto.id)
if (upd.error) fail(`update automation: ${upd.error.message}`)
console.log(`✔ rebuilt "${auto.name}" (${n} steps, still ${auto.is_active ? 'active' : 'inactive'})`)
