"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  AutomationBuilder,
  toApiSteps,
  type BuilderInitial,
  type BuilderReviewContext,
  type BuilderStep,
} from "@/components/automations/automation-builder"
import { issueToast } from "@/components/automations/issue-toast"
import { inferCampaignFromScript } from "@/lib/automations/generator/infer"
import { summarize } from "@/lib/automations/generator/normalize"
import type {
  GenerateResult,
  GeneratedStep,
  GeneratorCatalog,
} from "@/lib/automations/generator/types"
import {
  annotateIssues,
  validateStepReferences,
  validateStepsForActivation,
  validateTriggerForActivation,
} from "@/lib/automations/validate"
import type { AutomationStepType } from "@/types"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "automations.generator.form"
const NO_CAMPAIGN = "__none__"
const ALL_CLIENTS = ""
const NO_CLIENT = "__none__"

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"

/** Instruction syntax the built-in parser reads (English, like the parser). */
const FORMAT_EXAMPLES = [
  "Trigger: keyword WINCOKE, SHARECOKE2026",
  "Trigger: first message  |  Trigger: any message",
  "Add campaign entry",
  "Send message: Hi {{ contact.name }}!",
  "https://youtu.be/…  (a link on its own line joins the message above)",
  "Send image: https://…/poster.jpg | Caption",
  "Send template: template_name",
  "Ask: What's your cap code? -> cap_code",
  "Save field cap_code = {{ vars.cap_code }}",
  "If message contains YES:  …  Else:  …  End if",
  "Wait 2 hours",
  "Set entry status: completed",
  "Generate reference",
  "Start flow: FAQ bot",
  "Add tag: VIP  |  Remove tag: VIP",
  "Close conversation  |  End",
]

const EXAMPLE_SCRIPT = `Trigger: keyword WINCOKE, SHARECOKE2026
Add campaign entry
Send message: Welcome to the Coca-Cola Summer Competition, {{ contact.name }}! 🥤
Watch how to enter:
https://youtu.be/0Ab-F7Y3IXc
Ask: What's the code under your bottle cap? -> cap_code
Save field cap_code = {{ vars.cap_code }}
Generate reference
Send message: Thanks! Your entry number is {{ entry.reference }}. Good luck!
Set entry status: completed`

interface CampaignOption {
  id: string
  name: string
  code: string
  keyword: string | null
  status: string
  client_name: string | null
}

interface GeneratorMeta {
  campaigns: CampaignOption[]
  flows: { id: string; name: string; status: string }[]
  tags: { id: string; name: string }[]
  ai: { configured: boolean; provider?: string; model?: string }
}

interface FormState {
  name: string
  client: string
  /** undefined until the user confirms a campaign (or "no campaign"). */
  campaignId: string | undefined
  script: string
  useRules: boolean
}

const EMPTY_FORM: FormState = { name: "", client: ALL_CLIENTS, campaignId: undefined, script: "", useRules: false }

function readStoredForm(): FormState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? { ...EMPTY_FORM, ...(JSON.parse(raw) as Partial<FormState>) } : EMPTY_FORM
  } catch {
    return EMPTY_FORM
  }
}

function toBuilderSteps(steps: GeneratedStep[]): BuilderStep[] {
  return steps.map((s) => {
    const cid = String(s.step_config.node_id)
    return {
      cid,
      step_type: s.step_type as AutomationStepType,
      step_config: s.step_config,
      branches: s.branches
        ? { yes: toBuilderSteps(s.branches.yes), no: toBuilderSteps(s.branches.no) }
        : undefined,
    }
  })
}

function toGeneratedSteps(steps: ReturnType<typeof toApiSteps>): GeneratedStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    ...(s.branches
      ? { branches: { yes: toGeneratedSteps(s.branches.yes ?? []), no: toGeneratedSteps(s.branches.no ?? []) } }
      : {}),
  }))
}

/**
 * Automation Generator: script → reviewed draft. Generation is read-only
 * (POST /api/automations/generate); the review is the normal builder, so
 * saving and activation go through the same API and validation as a
 * hand-built automation. Client-only: the script is kept in
 * sessionStorage so it survives errors, regeneration and "back".
 */
export function AutomationGenerator() {
  const t = useTranslations("Automations.generator")
  const [form, setForm] = useState<FormState>(readStoredForm)
  const [meta, setMeta] = useState<GeneratorMeta | null>(null)
  const [metaError, setMetaError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<{ message: string; canFallback: boolean } | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form))
    } catch {
      // Private mode / quota: the form still works, it just won't survive a reload.
    }
  }, [form])

  useEffect(() => {
    let cancelled = false
    fetch("/api/automations/generate", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return (await res.json()) as GeneratorMeta
      })
      .then((body) => {
        if (!cancelled) setMeta(body)
      })
      .catch(() => {
        if (!cancelled) setMetaError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const campaigns = useMemo(() => meta?.campaigns ?? [], [meta])
  const clients = useMemo(
    () => [...new Set(campaigns.map((c) => c.client_name).filter((n): n is string => !!n))].sort(),
    [campaigns],
  )
  const visibleCampaigns = campaigns.filter((c) =>
    form.client === ALL_CLIENTS ? true : form.client === NO_CLIENT ? !c.client_name : c.client_name === form.client,
  )
  const inferredId = useMemo(() => inferCampaignFromScript(form.script, campaigns), [form.script, campaigns])
  const inferred = inferredId && inferredId !== form.campaignId ? campaigns.find((c) => c.id === inferredId) : undefined
  const selectedCampaign = campaigns.find((c) => c.id === form.campaignId)

  const catalog: GeneratorCatalog = useMemo(
    () => ({
      campaigns,
      flows: (meta?.flows ?? []).map((f) => ({ ...f, trigger_type: "", trigger_config: {} })),
      tags: meta?.tags ?? [],
      templates: [],
      automations: [],
    }),
    [campaigns, meta],
  )

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }))
  }

  function chooseCampaign(id: string) {
    const c = campaigns.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      campaignId: id || undefined,
      client: c && f.client !== ALL_CLIENTS ? (c.client_name ?? NO_CLIENT) : f.client,
    }))
  }

  function chooseClient(client: string) {
    setForm((f) => {
      const keep = campaigns.find((c) => c.id === f.campaignId)
      const stillVisible =
        f.campaignId === NO_CAMPAIGN ||
        (keep && (client === ALL_CLIENTS || (client === NO_CLIENT ? !keep.client_name : keep.client_name === client)))
      return { ...f, client, campaignId: stillVisible ? f.campaignId : undefined }
    })
  }

  async function generate(mode: "auto" | "rules" = form.useRules ? "rules" : "auto") {
    if (!form.script.trim() || form.campaignId === undefined) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch("/api/automations/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script: form.script,
          name: form.name,
          campaign_id: form.campaignId === NO_CAMPAIGN ? null : form.campaignId,
          mode,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError({ message: body?.error ?? t("failed"), canFallback: body?.fallback === "rules" })
        return
      }
      setResult(body as GenerateResult)
      setGeneration((g) => g + 1)
    } catch {
      setError({ message: t("failed"), canFallback: true })
    } finally {
      setGenerating(false)
    }
  }

  function backToScript() {
    if (!window.confirm(t("discardConfirm"))) return
    setResult(null)
  }

  async function regenerate() {
    if (!window.confirm(t("discardConfirm"))) return
    await generate(result?.source === "rules" ? "rules" : "auto")
  }

  if (result) {
    const initial: BuilderInitial = {
      name: result.automation.name,
      description: "",
      trigger_type: result.automation.trigger_type,
      trigger_config: result.automation.trigger_config,
      is_active: false,
      steps: toBuilderSteps(result.automation.steps),
    }
    return (
      <AutomationBuilder
        key={generation}
        initial={initial}
        review={(ctx) => (
          <GeneratorReview
            ctx={ctx}
            result={result}
            catalog={catalog}
            flows={meta?.flows ?? []}
            campaign={selectedCampaign}
            model={meta?.ai.model}
            regenerating={generating}
            onBack={backToScript}
            onRegenerate={() => void regenerate()}
          />
        )}
      />
    )
  }

  const ready = !!form.script.trim() && form.campaignId !== undefined && !generating

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex items-start gap-3">
        <Link
          href="/automations/new"
          aria-label={t("back")}
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {metaError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("loadFailed")}
        </div>
      )}

      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">{t("nameLabel")}</span>
          <Input
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={t("namePlaceholder")}
            className="bg-muted text-foreground"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t("clientLabel")}</span>
            <select value={form.client} onChange={(e) => chooseClient(e.target.value)} className={SELECT_CLASS}>
              <option value={ALL_CLIENTS}>{t("allClients")}</option>
              {clients.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={NO_CLIENT}>{t("noClient")}</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t("campaignLabel")}</span>
            <select
              value={form.campaignId ?? ""}
              onChange={(e) => chooseCampaign(e.target.value)}
              className={cn(SELECT_CLASS, form.campaignId === undefined && "text-muted-foreground")}
            >
              <option value="">{meta ? t("campaignChoose") : t("loading")}</option>
              {visibleCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}){c.status !== "active" ? ` · ${c.status}` : ""}
                </option>
              ))}
              <option value={NO_CAMPAIGN}>{t("noCampaign")}</option>
            </select>
          </label>
        </div>

        {inferred && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span className="text-foreground">{t("inferred", { name: inferred.name })}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setForm((f) => ({ ...f, campaignId: inferred.id, client: ALL_CLIENTS }))}
            >
              {t("useInferred")}
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">{t("scriptLabel")}</span>
            <button
              type="button"
              onClick={() => patch({ script: EXAMPLE_SCRIPT })}
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("insertExample")}
            </button>
          </div>
          <Textarea
            value={form.script}
            onChange={(e) => patch({ script: e.target.value })}
            placeholder={t("scriptPlaceholder")}
            className="min-h-64 bg-muted font-mono text-sm text-foreground"
          />
          <details className="group rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              {t("formatHelp")}
            </summary>
            <ul className="mt-2 space-y-1 font-mono">
              {FORMAT_EXAMPLES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          {meta?.ai.configured ? (
            <>
              <p className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("aiOn", { provider: meta.ai.provider ?? "", model: meta.ai.model ?? "" })}
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.useRules}
                  onChange={(e) => patch({ useRules: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                {t("useRules")}
              </label>
            </>
          ) : meta ? (
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {t("aiOff")}
            </p>
          ) : null}
        </div>

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span>{error.message} {t("scriptKept")}</span>
            {error.canFallback && (
              <Button type="button" size="sm" variant="outline" onClick={() => void generate("rules")} disabled={generating}>
                {t("useRulesFallback")}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {form.campaignId === undefined && form.script.trim() && (
            <span className="text-xs text-muted-foreground">{t("campaignRequired")}</span>
          )}
          <Button
            type="button"
            onClick={() => void generate()}
            disabled={!ready}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? t("generating") : t("generate")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function GeneratorReview({
  ctx,
  result,
  catalog,
  flows,
  campaign,
  model,
  regenerating,
  onBack,
  onRegenerate,
}: {
  ctx: BuilderReviewContext
  result: GenerateResult
  catalog: GeneratorCatalog
  flows: { id: string; name: string; status: string }[]
  campaign: CampaignOption | undefined
  model: string | undefined
  regenerating: boolean
  onBack: () => void
  onRegenerate: () => void
}) {
  const t = useTranslations("Automations.generator")
  const tb = useTranslations("Automations.builder")
  const { state } = ctx
  const apiSteps = toApiSteps(state.steps)

  const issues = annotateIssues(
    [
      ...validateTriggerForActivation(state.trigger_type, state.trigger_config),
      ...validateStepsForActivation(apiSteps),
      ...validateStepReferences(apiSteps, { flows }),
    ],
    apiSteps,
  )
  const summary = summarize(
    { trigger_type: state.trigger_type, trigger_config: state.trigger_config, steps: toGeneratedSteps(apiSteps) },
    catalog,
  )
  const [triggerLine, ...stepLines] = summary
  const warnings = result.warnings.filter((w) => w.level === "warning")
  const infos = result.warnings.filter((w) => w.level === "info")

  return (
    <section className="mb-8 w-full space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("reviewTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {result.source === "ai" ? t("sourceAi", { model: model ?? "AI" }) : t("sourceRules")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            {t("backToScript")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {t("generateAgain")}
          </Button>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("client")}</dt>
          <dd className="font-medium text-foreground">{campaign?.client_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("campaign")}</dt>
          <dd className="font-medium text-foreground">{campaign ? `${campaign.name} (${campaign.code})` : t("noCampaign")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("trigger")}</dt>
          <dd className="font-medium text-foreground">{triggerLine}</dd>
        </div>
      </dl>

      {issues.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          {t("ready")}
        </p>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {t("fixCount", { count: issues.length })}
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-foreground">
            {issues.map((issue, i) => {
              const { title, description } = issueToast(issue, tb)
              return (
                <li key={`${issue.path}-${i}`} className="list-disc">
                  {description ? `${title}: ${description}` : title}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("whatHappens")}</h3>
        <ol className="mt-1.5 space-y-0.5 whitespace-pre-wrap font-mono text-xs text-foreground">
          {stepLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>

      {(warnings.length > 0 || infos.length > 0) && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("notes")}</h3>
          <ul className="mt-1.5 space-y-1 text-sm">
            {[...warnings, ...infos].map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                {note.level === "warning" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className={note.level === "warning" ? "text-foreground" : "text-muted-foreground"}>
                  {note.line ? <span className="font-medium">{t("line", { n: note.line })} · </span> : null}
                  {note.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">{t("draftNote")}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => ctx.save()} disabled={ctx.saving}>
            {ctx.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("saveDraft")}
          </Button>
          <Button
            type="button"
            onClick={() => ctx.save({ activate: true })}
            disabled={ctx.saving || issues.length > 0}
            title={issues.length > 0 ? t("activateBlocked") : undefined}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("activate")}
          </Button>
        </div>
      </div>
    </section>
  )
}
