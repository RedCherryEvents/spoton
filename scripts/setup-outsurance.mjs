#!/usr/bin/env node
// Set up the OUTsurance WhatsApp campaign (keyword SAVE).
// Formerly Hollard Pay as You Drive: an existing Hollard campaign and
// automation are renamed in place, so the keyword, WhatsApp number, QR
// code and existing entries are kept.
//
//   node scripts/setup-outsurance.mjs                          # dry run
//   node scripts/setup-outsurance.mjs --apply                  # create / rename
//   node scripts/setup-outsurance.mjs --apply --update-steps   # also replace the
//        automation's steps (backup first; open reply waits are ended,
//        because their step positions no longer exist)
//
// Checks first that +27 79 863 7339 is CONNECTED on the Cloud API with
// the WABA subscribed, and that nothing else listens for SAVE. Never
// activates anything; an existing campaign/automation keeps its status.
// Reads .env.local; tokens are decrypted in memory only. Node 22.18+.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  OUTSURANCE_AUTOMATION,
  OUTSURANCE_CAMPAIGN,
  OUTSURANCE_FIELDS,
  OUTSURANCE_KEYWORD,
  OUTSURANCE_LEGACY_AUTOMATION_NAME,
  OUTSURANCE_LEGACY_CODE,
  OUTSURANCE_WHATSAPP_NUMBER,
  outsuranceSteps,
  outsuranceTriggerConfig,
} from '../src/lib/campaigns/presets/outsurance.ts'
import { CAMPAIGN_FLOWS } from '../src/lib/campaigns/presets/spoton-campaigns.ts'
import { buildWhatsAppEntryUrl } from '../src/lib/campaigns/whatsapp-link.ts'
import { keywordTextMatches } from '../src/lib/automations/keyword-match.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const { createClient } = require('@supabase/supabase-js')
const APPLY = process.argv.includes('--apply')
const UPDATE_STEPS = process.argv.includes('--update-steps')
const META = 'https://graph.facebook.com/v21.0'

function fail(msg) {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

function loadEnv() {
  const file = path.join(root, '.env.local')
  const env = { ...process.env }
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
    }
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY']) {
    if (!env[k]) fail(`${k} is not set (.env.local)`)
  }
  return env
}

// Same formats as src/lib/whatsapp/encryption.ts (GCM, legacy CBC).
function decrypt(text, keyHex) {
  const key = Buffer.from(keyHex, 'hex')
  const p = String(text).split(':')
  if (p.length === 3) {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p[0], 'hex'))
    d.setAuthTag(Buffer.from(p[2], 'hex'))
    return d.update(p[1], 'hex', 'utf8') + d.final('utf8')
  }
  const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(p[0], 'hex'))
  return d.update(p[1], 'hex', 'utf8') + d.final('utf8')
}

async function meta(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message ?? `Meta API ${res.status}`)
  return body
}

/** Mirrors flows' keyword trigger: lowercase substring unless match_type is exact. */
function flowKeywordHits(cfg, text) {
  const t = String(text).toLowerCase().trim()
  return (Array.isArray(cfg?.keywords) ? cfg.keywords : []).some((k) => {
    const kk = String(k ?? '').toLowerCase().trim()
    if (!kk) return false
    return cfg.match_type === 'exact' ? t === kk : t.includes(kk)
  })
}

/** Builder tree → automation_steps rows (same walk as steps-tree.ts insertSteps). */
function flattenSteps(automationId, tree) {
  const rows = []
  const walk = (steps, parentId, branch) =>
    steps.forEach((s, position) => {
      const id = crypto.randomUUID()
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: s.step_type,
        step_config: s.step_config,
        position,
      })
      if (s.branches?.yes) walk(s.branches.yes, id, 'yes')
      if (s.branches?.no) walk(s.branches.no, id, 'no')
    })
  walk(tree, null, null)
  return rows
}

const env = loadEnv()
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const warnings = []

console.log(APPLY ? 'Mode: APPLY (creates draft records)' : 'Mode: dry run (no writes; pass --apply to create)')

// 1. Which configured number is +27 79 863 7339, and is it really live?
const { data: configs, error: cfgErr } = await db
  .from('whatsapp_config')
  .select('id, account_id, user_id, phone_number_id, waba_id, status, access_token')
if (cfgErr) fail(`could not read whatsapp_config: ${cfgErr.message}`)

const matches = []
for (const c of configs ?? []) {
  let token
  try {
    token = decrypt(c.access_token, env.ENCRYPTION_KEY)
  } catch {
    warnings.push(`whatsapp_config ${c.id}: token could not be decrypted, skipped`)
    continue
  }
  try {
    const phone = await meta(
      `${META}/${c.phone_number_id}?fields=id,display_phone_number,verified_name,status,platform_type,quality_rating`,
      token,
    )
    if (String(phone.display_phone_number ?? '').replace(/\D/g, '') === OUTSURANCE_WHATSAPP_NUMBER) {
      matches.push({ config: c, phone, token })
    }
  } catch (err) {
    warnings.push(`whatsapp_config ${c.id}: Meta lookup failed (${err.message}), skipped`)
  }
}
if (matches.length === 0) {
  fail(`no connected whatsapp_config uses +${OUTSURANCE_WHATSAPP_NUMBER}. Connect the number under Settings → WhatsApp first.`)
}
if (matches.length > 1) fail(`more than one whatsapp_config uses +${OUTSURANCE_WHATSAPP_NUMBER}; resolve the duplicate first.`)

const { config, phone, token } = matches[0]
if (phone.status !== 'CONNECTED') fail(`Meta reports the number as ${phone.status}, not CONNECTED.`)
if (phone.platform_type && phone.platform_type !== 'CLOUD_API') fail(`number is on ${phone.platform_type}, not the Cloud API.`)
if (config.status !== 'connected') fail(`whatsapp_config status is "${config.status}", not "connected".`)
if (!config.waba_id) fail('whatsapp_config has no waba_id, so the webhook subscription cannot be checked.')
const apps = await meta(`${META}/${config.waba_id}/subscribed_apps`, token)
if (!Array.isArray(apps.data) || apps.data.length === 0) {
  fail('the WhatsApp Business Account is not subscribed to any app, so inbound messages will not reach the webhook.')
}
console.log(
  `✔ +${OUTSURANCE_WHATSAPP_NUMBER} is phone_number_id ${config.phone_number_id} ("${phone.verified_name}", ${phone.status}, ${phone.platform_type}, quality ${phone.quality_rating}); WABA subscribed to: ${apps.data.map((a) => a.whatsapp_business_api_data?.name ?? '?').join(', ')}`,
)
const accountId = config.account_id
const ownerId = config.user_id

// 2. Conflicts and pre-emption.
const [{ data: campaigns }, { data: automations }, { data: flows }] = await Promise.all([
  db.from('campaigns').select('id, name, code, keyword, status, settings').eq('account_id', accountId),
  db.from('automations').select('id, name, trigger_type, trigger_config, is_active').eq('account_id', accountId),
  db.from('flows').select('id, name, status, trigger_type, trigger_config').eq('account_id', accountId),
])

const existingCampaign =
  (campaigns ?? []).find((c) => c.code === OUTSURANCE_CAMPAIGN.code) ??
  (campaigns ?? []).find((c) => c.code === OUTSURANCE_LEGACY_CODE) ??
  null
for (const c of campaigns ?? []) {
  if (c.id === existingCampaign?.id) continue
  const tokens = String(c.keyword ?? '').split(',').map((k) => k.trim().toLowerCase())
  if (tokens.includes(OUTSURANCE_KEYWORD.toLowerCase())) fail(`campaign "${c.name}" already uses the keyword ${OUTSURANCE_KEYWORD}.`)
}
for (const a of automations ?? []) {
  if (a.name === OUTSURANCE_AUTOMATION.name || a.name === OUTSURANCE_LEGACY_AUTOMATION_NAME || !a.is_active || a.trigger_type !== 'keyword_match') continue
  if (keywordTextMatches(a.trigger_config ?? {}, OUTSURANCE_KEYWORD)) {
    fail(`active automation "${a.name}" already fires on "${OUTSURANCE_KEYWORD}".`)
  }
}
for (const f of (flows ?? []).filter((x) => x.status === 'active')) {
  if (f.trigger_type === 'keyword' && flowKeywordHits(f.trigger_config, OUTSURANCE_KEYWORD)) {
    fail(`active flow "${f.name}" already starts on "${OUTSURANCE_KEYWORD}"; flows run before automations.`)
  }
  if (f.trigger_type === 'first_inbound_message') {
    warnings.push(
      `active flow "${f.name}" starts on a contact's FIRST message, so a new customer's SAVE goes to that flow and the OUTsurance automation does not run. Change its trigger or pause it before going live.`,
    )
  }
}

const entryUrl = buildWhatsAppEntryUrl(OUTSURANCE_WHATSAPP_NUMBER, OUTSURANCE_KEYWORD)
console.log(`✔ no other campaign, active automation or active flow uses ${OUTSURANCE_KEYWORD}`)
console.log(`  Entry link / QR destination: ${entryUrl}`)

if (!APPLY) {
  console.log(`\nWould create: campaign "${OUTSURANCE_CAMPAIGN.name}" (draft)${existingCampaign ? ' — already exists, reused' : ''}, fields ${OUTSURANCE_FIELDS.map((f) => f.key).join(', ')}, automation "${OUTSURANCE_AUTOMATION.name}" (inactive).`)
} else {
  // 3a. Campaign (draft). An existing one keeps its status; only the
  // keyword and WhatsApp number are brought in line.
  let campaign = existingCampaign
  if (!campaign) {
    const { data, error } = await db
      .from('campaigns')
      .insert({ ...OUTSURANCE_CAMPAIGN, account_id: accountId, user_id: ownerId })
      .select('*')
      .single()
    if (error) fail(`campaign insert failed: ${error.message}`)
    campaign = data
    console.log(`✔ created campaign "${campaign.name}" (${campaign.status})`)
  } else {
    // Rename in place: keyword, status and entries are kept.
    const settings = {
      ...(campaign.settings ?? {}),
      client_name: OUTSURANCE_CAMPAIGN.settings.client_name,
      whatsapp_number: OUTSURANCE_WHATSAPP_NUMBER,
    }
    const { error } = await db
      .from('campaigns')
      .update({
        name: OUTSURANCE_CAMPAIGN.name,
        code: OUTSURANCE_CAMPAIGN.code,
        description: OUTSURANCE_CAMPAIGN.description,
        keyword: OUTSURANCE_KEYWORD,
        settings,
      })
      .eq('id', campaign.id)
      .eq('account_id', accountId)
    if (error) fail(`campaign update failed: ${error.message}`)
    console.log(`✔ campaign "${campaign.name}" (${campaign.status}) is now "${OUTSURANCE_CAMPAIGN.name}" (code ${OUTSURANCE_CAMPAIGN.code}); keyword, WhatsApp number and entries kept`)
  }

  // 3b. Captured fields.
  for (const [position, f] of OUTSURANCE_FIELDS.entries()) {
    const { error: fieldErr } = await db.from('campaign_field_definitions').upsert(
      { ...f, campaign_id: campaign.id, account_id: accountId, required: false, position },
      { onConflict: 'campaign_id,key', ignoreDuplicates: true },
    )
    if (fieldErr) fail(`field ${f.key} upsert failed: ${fieldErr.message}`)
  }
  console.log(`✔ campaign fields present: ${OUTSURANCE_FIELDS.map((f) => f.key).join(', ')}`)

  // 3c. Automation (inactive). Existing ones are left untouched.
  const existingAutomation = (automations ?? []).find((a) => a.name === OUTSURANCE_AUTOMATION.name || a.name === OUTSURANCE_LEGACY_AUTOMATION_NAME)
  if (existingAutomation && UPDATE_STEPS) {
    // The steps change completely, so a run paused on the old steps
    // can't resume correctly: end those waits first.
    const { data: waits } = await db
      .from('automation_pending_executions')
      .select('id, log_id, created_at')
      .eq('automation_id', existingAutomation.id)
      .in('status', ['pending', 'running'])
    for (const w of waits ?? []) {
      await db.from('automation_pending_executions').update({ status: 'failed' }).eq('id', w.id)
      if (w.log_id) await db.from('automation_logs').update({ status: 'failed', error_message: 'run ended when the automation was replaced' }).eq('id', w.log_id)
      console.log(`✔ ended an open reply wait from ${w.created_at}`)
    }
    const { data: oldSteps } = await db.from('automation_steps').select('*').eq('automation_id', existingAutomation.id)
    const backupDir = path.join(root, 'docs', 'outsurance')
    const backup = path.join(backupDir, `automation-steps-before-${Date.now()}.json`)
    fs.writeFileSync(backup, JSON.stringify({ automation: existingAutomation, automation_steps: oldSteps }, null, 1))
    const rows = flattenSteps(existingAutomation.id, outsuranceSteps(campaign.id))
    const { error: delErr } = await db.from('automation_steps').delete().eq('automation_id', existingAutomation.id)
    if (delErr) fail(`delete old steps: ${delErr.message}`)
    const { error: insErr } = await db.from('automation_steps').insert(rows)
    if (insErr) {
      await db.from('automation_steps').insert(oldSteps)
      fail(`insert new steps failed, old steps restored: ${insErr.message}`)
    }
    await db.from('automations').update({ name: OUTSURANCE_AUTOMATION.name, description: OUTSURANCE_AUTOMATION.description }).eq('id', existingAutomation.id)
    console.log(`✔ updated "${existingAutomation.name}" to the preset (${rows.length} steps, still ${existingAutomation.is_active ? 'ACTIVE' : 'inactive'}); backup → ${path.relative(root, backup)}`)
  } else if (existingAutomation) {
    console.log(`✔ automation "${existingAutomation.name}" already exists (${existingAutomation.is_active ? 'ACTIVE' : 'inactive'}); left unchanged (pass --update-steps to replace its steps)`)
  } else {
    const { data: automation, error } = await db
      .from('automations')
      .insert({
        account_id: accountId,
        user_id: ownerId,
        name: OUTSURANCE_AUTOMATION.name,
        description: OUTSURANCE_AUTOMATION.description,
        trigger_type: OUTSURANCE_AUTOMATION.trigger_type,
        trigger_config: outsuranceTriggerConfig(campaign.id),
        is_active: false,
      })
      .select('id')
      .single()
    if (error) fail(`automation insert failed: ${error.message}`)
    const rows = flattenSteps(automation.id, outsuranceSteps(campaign.id))
    const { error: stepsErr } = await db.from('automation_steps').insert(rows)
    if (stepsErr) {
      await db.from('automations').delete().eq('id', automation.id)
      fail(`automation steps insert failed (automation removed again): ${stepsErr.message}`)
    }
    console.log(`✔ created automation "${OUTSURANCE_AUTOMATION.name}" (inactive, ${rows.length} steps)`)
  }
}

// 3d. The campaign's flow copy (manual trigger; never starts on its own):
// rename the old Hollard flow if there is one and refresh its nodes.
if (APPLY) {
  const preset = CAMPAIGN_FLOWS.find((f) => f.campaign_code === OUTSURANCE_CAMPAIGN.code)
  const flow = (flows ?? []).find((f) => f.name === preset.name || f.name === 'Hollard Pay as You Drive — Flow')
  if (flow) {
    if (flow.trigger_type !== 'manual') fail(`flow "${flow.name}" is not manual-trigger; not touching it`)
    const { data: oldNodes } = await db.from('flow_nodes').select('*').eq('flow_id', flow.id)
    await db.from('flow_nodes').delete().eq('flow_id', flow.id)
    const { error: nErr } = await db
      .from('flow_nodes')
      .insert(preset.nodes.map((n) => ({ flow_id: flow.id, node_key: n.node_key, node_type: n.node_type, config: n.config })))
    if (nErr) {
      await db.from('flow_nodes').insert(oldNodes)
      fail(`flow refresh failed, old nodes restored: ${nErr.message}`)
    }
    await db.from('flows').update({ name: preset.name, description: preset.description, entry_node_id: preset.entry_node_id }).eq('id', flow.id)
    console.log(`✔ flow "${flow.name}" is now "${preset.name}" (${preset.nodes.length} nodes, ${flow.status})`)
  }
}

if (warnings.length > 0) {
  console.log('\nBefore going live:')
  for (const w of warnings) console.log(`  ! ${w}`)
}
console.log('\nNothing was activated. Review the campaign and automation in the app, then activate the campaign first and the automation second.')
