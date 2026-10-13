import { videoPageSite } from '@/lib/whatsapp/media-url'
import { mediaTypeForUrl } from './normalize'
import type { DraftSpec, DraftStep, GeneratorNote } from './types'

// ------------------------------------------------------------
// Built-in script parser: one instruction per line, used when the
// account has no AI provider set up (or the user asks for it). It only
// recognises the documented phrasings below and reports every line it
// skips, rather than guessing.
//
//   Trigger: keyword COKE, SHARECOKE2026
//   Add campaign entry
//   Send message: Welcome to Coca-Cola, {{ contact.name }}!
//   https://youtu.be/0Ab-F7Y3IXc
//   Ask: What's the code under your cap? -> code
//   Save field code = {{ vars.code }}
//   If message contains yes:
//     Send message: Great!
//   Else:
//     Send message: No problem.
//   End if
//   Wait 2 hours
//   Set entry status: completed
// ------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"')]+/i

interface Frame {
  steps: DraftStep[]
  condition?: DraftStep
  ifIndent: number
  /** Indent of the first body line; null until seen. */
  bodyIndent: number | null
}

function unquote(s: string): string {
  return s.trim().replace(/^["“'‘]+|["”'’]+$/g, '').trim()
}

function stripBullet(s: string): string {
  return s.replace(/^(?:\d+\s*[.)]|[-*•]|step\s*\d+\s*[:.)-])\s+/i, '').trim()
}

function splitKeywords(s: string): string[] {
  const quoted = [...s.matchAll(/["“']([^"”']+)["”']/g)].map((m) => m[1].trim())
  if (quoted.length > 0) return quoted
  return s
    .split(/,|\/|\bor\b|\band\b/i)
    .map((k) => unquote(k).replace(/^(?:the\s+)?(?:key)?words?\s+/i, '').trim())
    .filter((k) => k.length > 0 && k.length <= 60)
}

function parseTrigger(text: string): DraftSpec['trigger'] | null {
  const t = text.toLowerCase()
  if (/first (?:time|message|inbound)|new (?:contact|conversation)|conversation start/.test(t)) {
    return { type: 'first_inbound_message', config: {} }
  }
  if (/campaign entry|added to (?:the |a )?campaign|new entry/.test(t)) {
    return { type: 'campaign_entry', config: {} }
  }
  if (/any (?:incoming )?message|every message|new message|anything else|no keyword/.test(t)) {
    return { type: 'new_message_received', config: {} }
  }
  const m = /(?:keywords?|sends?|types?|texts?|says?|messages?)\s*(?:is|are|of)?\s*:?\s*(.+)$/i.exec(text)
  const raw = (m ? m[1] : text).replace(/\b(?:exactly|containing|contains|starting with|starts with)\b/gi, '')
  const keywords = splitKeywords(raw)
  if (keywords.length === 0) return null
  const match_type = /\bexact(?:ly)?\b/.test(t)
    ? 'exact'
    : /starts? with|starting with/.test(t)
    ? 'starts_with'
    : /\bcontains?\b|containing/.test(t)
    ? 'contains'
    : 'word'
  return { type: 'keyword_match', config: { keywords, match_type } }
}

function parseCondition(text: string): Record<string, unknown> | null {
  let m = /(?:message|reply|answer|response|text|they\s+(?:say|reply|answer|send|write))\s*(?:contains|includes|says|is|=|has)\s*(.+)$/i.exec(text)
  if (m) return { subject: 'message_content', value: unquote(m[1]) }
  m = /(?:have|has)\s+(?:the\s+)?tag\s+(.+)$/i.exec(text)
  if (m) return { subject: 'tag_presence', operand: unquote(m[1]) }
  m = /(\d{1,2}:\d{2})\s*(?:-|to|and)\s*(\d{1,2}:\d{2})/.exec(text)
  if (m) return { subject: 'time_of_day', operand: `${m[1]}-${m[2]}` }
  m = /\b(name|email|company|phone)\s*(?:is|=|equals)\s*(.+)$/i.exec(text)
  if (m) return { subject: 'contact_field', operand: m[1].toLowerCase(), value: unquote(m[2]) }
  return null
}

const MEDIA_WORDS: Record<string, string> = {
  image: 'image', photo: 'image', picture: 'image', video: 'video',
  document: 'document', pdf: 'document', file: 'document', audio: 'audio', 'voice note': 'audio',
}

/**
 * Parse one instruction (bullet already stripped). Returns the steps it
 * produced, `null` when the line isn't an instruction, or a trigger.
 */
function parseInstruction(
  text: string,
  line: number,
): { steps: DraftStep[] } | { trigger: DraftSpec['trigger'] } | null {
  let m: RegExpExecArray | null

  if ((m = /^(?:trigger|when|start when|starts? on)\b\s*:?\s*(.+)$/i.exec(text)) || (m = /^(keywords?\s*:.+)$/i.exec(text))) {
    const trigger = parseTrigger(m[1])
    return trigger ? { trigger } : null
  }

  if ((m = /^(?:wait|delay|pause|after)\s*(?:for\s*)?(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\b[\s,.:-]*(?:then\s+)?(.*)$/i.exec(text))) {
    const unit = m[2].toLowerCase().startsWith('m') ? 'minutes' : m[2].toLowerCase().startsWith('d') ? 'days' : 'hours'
    const steps: DraftStep[] = [{ type: 'wait', config: { amount: Number(m[1]), unit }, line }]
    if (m[3].trim()) {
      const rest = parseInstruction(m[3].trim(), line)
      if (rest && 'steps' in rest) steps.push(...rest.steps)
    }
    return { steps }
  }

  if ((m = /^(?:add|create|register|record)\b.*?\bentry\b(?:\s+(?:in|for|to)\s+(?:the\s+)?(?:campaign\s+)?(.+))?$/i.exec(text)) ||
      (m = /^add\s+(?:them\s+|the\s+contact\s+|contact\s+)?to\s+(?:the\s+)?campaign\b\s*:?\s*(.*)$/i.exec(text)) ||
      (m = /^campaign\s+entry\b\s*:?\s*(.*)$/i.exec(text))) {
    const name = unquote(m[1] ?? '')
    return { steps: [{ type: 'campaign_add_entry', config: name ? { campaign_id: name } : {}, line }] }
  }

  if (/^(?:generate|create)\b.*\breference\b/i.test(text)) {
    return { steps: [{ type: 'campaign_generate_reference', config: {}, line }] }
  }

  if ((m = /^(?:set|mark|change)\s+(?:the\s+)?conversation\s+(?:status\s+)?(?:as\s+|to\s+)?(open|pending|closed)$/i.exec(text))) {
    return { steps: [{ type: 'set_conversation_status', config: { status: m[1].toLowerCase() }, line }] }
  }

  if ((m = /^(?:set|mark|change)\s+(?:the\s+)?(?:entry\s+)?(?:status\s*)?(?:as|to|:)?\s*(?:status\s*)?(?:to|:)?\s*([a-z ]+)$/i.exec(text)) && /status|entry/i.test(text)) {
    return { steps: [{ type: 'campaign_set_status', config: { status: m[1].trim() }, line }] }
  }

  if ((m = /^(?:save|set|store)\s+(?:campaign\s+)?field\s+([\w-]+)\s*(?:=|to|:|as)\s*(.+)$/i.exec(text))) {
    return { steps: [{ type: 'campaign_set_field', config: { field_key: m[1], value: unquote(m[2]) }, line }] }
  }

  if ((m = /^ask\b(?:\s+(?:a\s+|the\s+)?question)?\s*[:-]?\s*(.+)$/i.exec(text))) {
    let body = m[1]
    let var_key = ''
    const arrow = /\s*(?:->|→)\s*([\w ]+)\s*$/.exec(body)
    const save = /\s*\(?\s*save\s+(?:it\s+|the\s+answer\s+|the\s+reply\s+)?(?:as|to|in(?:to)?)\s+([\w ]+?)\s*\)?\s*$/i.exec(body)
    const hit = arrow ?? save
    if (hit) {
      var_key = hit[1]
      body = body.slice(0, hit.index)
    }
    const timeout = /\s*\(?\s*(?:wait|timeout)\s*(?:up to\s*)?(\d+)\s*h(?:ours?|rs?)?\s*\)?/i.exec(body)
    if (timeout) body = body.slice(0, timeout.index) + body.slice(timeout.index + timeout[0].length)
    return {
      steps: [{
        type: 'ask_question',
        config: { text: unquote(body), var_key, ...(timeout ? { timeout_hours: Number(timeout[1]) } : {}) },
        line,
      }],
    }
  }

  if ((m = /^send\s+(?:the\s+|an?\s+)?(?:approved\s+)?template\s*:?\s*(.+)$/i.exec(text))) {
    return { steps: [{ type: 'send_template', config: { template_name: unquote(m[1]) }, line }] }
  }

  if ((m = /^send\s+(?:the\s+|an?\s+)?(image|photo|picture|video|document|pdf|file|audio|voice note|media)\b\s*:?\s*(.*)$/i.exec(text))) {
    const url = URL_RE.exec(m[2])?.[0] ?? ''
    const caption = unquote(
      m[2].replace(url, '').replace(/^\s*[|,-]\s*/, '').replace(/^(?:with\s+)?(?:the\s+)?caption\s*:?\s*/i, ''),
    )
    const media_type = MEDIA_WORDS[m[1].toLowerCase()] ?? (url ? mediaTypeForUrl(url) : null) ?? ''
    return { steps: [{ type: 'send_media', config: { media_type, url, ...(caption ? { caption } : {}) }, line }] }
  }

  if ((m = /^(?:send|share)\s+(?:the\s+|a\s+)?(?:[\w-]+\s+){0,2}link\b[^:]*:?\s*(.*)$/i.exec(text)) && URL_RE.test(m[1])) {
    const url = URL_RE.exec(m[1])![0]
    if (mediaTypeForUrl(url) && !videoPageSite(url)) {
      return { steps: [{ type: 'send_media', config: { url }, line }] }
    }
    return { steps: [{ type: 'send_message', config: { text: unquote(m[1]) }, line }] }
  }

  if ((m = /^(?:send|reply|respond|say)(?:\s+(?:with\s+)?(?:a|an|the))?(?:\s+\w+)?\s+(?:message|text|reply|msg)\b\s*(?:saying|that says|with|:)?\s*:?\s*(.*)$/i.exec(text)) ||
      (m = /^(?:send|reply|say|message|text)\s*:\s*(.*)$/i.exec(text))) {
    return { steps: [{ type: 'send_message', config: { text: unquote(m[1]) }, line }] }
  }

  if ((m = /^remove\s+(?:the\s+)?tag\s*:?\s*(.+)$/i.exec(text))) {
    return { steps: [{ type: 'remove_tag', config: { tag: unquote(m[1]) }, line }] }
  }
  if ((m = /^(?:add\s+(?:the\s+)?tag|tag(?:\s+(?:them|the contact|contact)\s+(?:as|with))?)\s*:?\s+(.+)$/i.exec(text))) {
    return { steps: [{ type: 'add_tag', config: { tag: unquote(m[1]) }, line }] }
  }

  if ((m = /^(?:start|run|launch|trigger|hand\s+(?:over|off)\s+to)\s+(?:the\s+)?flow\s*:?\s*(.+)$/i.exec(text)) ||
      (m = /^(?:start|run|launch)\s+(?:the\s+)?(.+?)\s+flow$/i.exec(text))) {
    return { steps: [{ type: 'start_flow', config: { flow: unquote(m[1]) }, line }] }
  }

  if ((m = /^(?:add\s+(?:an?\s+)?)?(?:internal\s+)?note\s*:\s*(.+)$/i.exec(text))) {
    return { steps: [{ type: 'add_note', config: { text: unquote(m[1]) }, line }] }
  }

  if (/^close\s+(?:the\s+)?(?:conversation|chat)$/i.test(text)) {
    return { steps: [{ type: 'close_conversation', config: {}, line }] }
  }
  if (/^(?:end|stop)(?:\s+(?:here|the automation|automation))?\.?$/i.test(text)) {
    return { steps: [{ type: 'end', config: {}, line }] }
  }

  if ((m = /^["“](.+)["”]$/.exec(text))) {
    return { steps: [{ type: 'send_message', config: { text: m[1].trim() }, line }] }
  }

  return null
}

/** Metadata lines the form already captures. */
const META_LINE = /^(?:name|automation|client|campaign|brand)\s*:/i

export function parseScript(script: string): DraftSpec {
  const notes: GeneratorNote[] = []
  let trigger: DraftSpec['trigger'] | null = null
  const root: DraftStep[] = []
  const stack: Frame[] = [{ steps: root, ifIndent: -1, bodyIndent: null }]
  /** The send_message that plain follow-on lines extend, if any. */
  let openMessage: DraftStep | null = null
  let pendingBlank = false

  const top = () => stack[stack.length - 1]
  const closeIf = () => {
    if (stack.length > 1) stack.pop()
  }

  const lines = script.replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    if (!rawLine.trim()) {
      if (openMessage) pendingBlank = true
      return
    }
    const indent = rawLine.length - rawLine.trimStart().length
    const text = stripBullet(rawLine.trim())
    if (!text || /^(?:#|\/\/)/.test(text)) return

    // Indentation closes an If block once its body was indented.
    while (stack.length > 1) {
      const f = top()
      if (f.bodyIndent !== null && f.bodyIndent > f.ifIndent && indent <= f.ifIndent && !/^(?:else|otherwise)\b/i.test(text)) {
        stack.pop()
        openMessage = null
      } else break
    }

    if (/^(?:end\s*if|endif|end\s+condition)\b/i.test(text)) {
      closeIf()
      openMessage = null
      return
    }
    if (/^(?:else|otherwise)\b\s*:?\s*(.*)$/i.test(text)) {
      const f = top()
      if (!f.condition) {
        notes.push({ level: 'warning', line: lineNo, message: '"Else" without an "If" above it was skipped.' })
        return
      }
      const rest = /^(?:else|otherwise)\b\s*,?\s*:?\s*(.*)$/i.exec(text)?.[1] ?? ''
      stack[stack.length - 1] = { ...f, steps: f.condition.no!, bodyIndent: null }
      openMessage = null
      if (rest) {
        const parsed = parseInstruction(rest, lineNo)
        if (parsed && 'steps' in parsed) top().steps.push(...parsed.steps)
      }
      return
    }

    const f = top()
    if (stack.length > 1 && f.bodyIndent === null) f.bodyIndent = indent

    // "If <cond>:" or "If <cond>, then <step>"; a colon only ends the
    // condition before a space or end of line, so 08:00-17:00 survives.
    const ifMatch = /^if\b\s*(.*?)\s*(?::(?=\s|$)|,?\s*then\b)\s*(.*)$/i.exec(text) ?? /^if\b\s*(.*)$/i.exec(text)
    if (ifMatch) {
      const config = parseCondition(ifMatch[1])
      if (!config) {
        notes.push({ level: 'warning', line: lineNo, message: `The condition "${ifMatch[1]}" wasn't understood; set it in the step.` })
      }
      const step: DraftStep = { type: 'condition', config: config ?? { subject: 'message_content' }, yes: [], no: [], line: lineNo }
      f.steps.push(step)
      openMessage = null
      const inline = ifMatch[2]?.trim()
      if (inline) {
        const parsed = parseInstruction(inline, lineNo)
        if (parsed && 'steps' in parsed) step.yes!.push(...parsed.steps)
        return
      }
      stack.push({ steps: step.yes!, condition: step, ifIndent: indent, bodyIndent: null })
      return
    }

    // A bare link: direct files become media, anything else (YouTube,
    // web pages) rides along in the message text.
    if (/^https?:\/\/\S+$/i.test(text)) {
      if (mediaTypeForUrl(text) && !videoPageSite(text)) {
        f.steps.push({ type: 'send_media', config: { url: text }, line: lineNo })
        openMessage = null
      } else if (openMessage) {
        const sep = pendingBlank ? '\n\n' : '\n'
        openMessage.config.text = `${openMessage.config.text ?? ''}${sep}${text}`.trim()
      } else {
        const step: DraftStep = { type: 'send_message', config: { text }, line: lineNo }
        f.steps.push(step)
        openMessage = step
      }
      pendingBlank = false
      return
    }

    if (META_LINE.test(text)) return

    const parsed = parseInstruction(text, lineNo)
    if (parsed && 'trigger' in parsed) {
      if (trigger) notes.push({ level: 'warning', line: lineNo, message: 'Only one trigger is allowed; the first one is used.' })
      else trigger = parsed.trigger
      openMessage = null
      return
    }
    if (parsed) {
      f.steps.push(...parsed.steps)
      const last = parsed.steps[parsed.steps.length - 1]
      openMessage = last?.type === 'send_message' ? last : null
      pendingBlank = false
      return
    }

    if (openMessage) {
      const sep = pendingBlank ? '\n\n' : '\n'
      openMessage.config.text = `${openMessage.config.text ?? ''}${openMessage.config.text ? sep : ''}${rawLine.trim()}`
      pendingBlank = false
      return
    }

    notes.push({ level: 'warning', line: lineNo, message: `Line ${lineNo} wasn't understood and was skipped: "${text.slice(0, 80)}"` })
  })

  // An If without "End if" runs to the end of the script.
  return {
    trigger: trigger ?? { type: '', config: {} },
    steps: root,
    notes,
  }
}
