"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { ArrowLeft, Hammer, Loader2, Sparkles } from "lucide-react"

import {
  AutomationBuilder,
  type BuilderInitial,
  type BuilderStep,
} from "@/components/automations/automation-builder"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import type { AutomationStepType, AutomationTriggerType, Campaign } from "@/types"

// `useSearchParams` requires a Suspense boundary or the production build
// bails to CSR and errors out. Thin wrapper supplies it; the inner
// component reads the `?template=` query string.
export default function NewAutomationPage() {
  return (
    <Suspense fallback={null}>
      <NewAutomationPageInner />
    </Suspense>
  )
}

function NewAutomationPageInner() {
  const params = useSearchParams()
  const template = params.get("template") as TemplateSlug | null
  const campaignId = template ? null : params.get("campaign")
  if (!template && !campaignId && params.get("mode") !== "manual") {
    return <CreateAutomationChooser />
  }
  return <NewAutomationBuilder template={template} campaignId={campaignId} />
}

function CreateAutomationChooser() {
  const t = useTranslations("Automations.create")
  const options = [
    { href: "/automations/new?mode=manual", icon: Hammer, title: t("manualTitle"), body: t("manualBody") },
    { href: "/automations/generate", icon: Sparkles, title: t("generateTitle"), body: t("generateBody") },
  ]
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex items-start gap-3">
        <Link
          href="/automations"
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
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60 hover:bg-muted/40"
          >
            <Icon className="h-6 w-6 text-primary" />
            <h2 className="mt-3 font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

function NewAutomationBuilder({
  template,
  campaignId,
}: {
  template: TemplateSlug | null
  campaignId: string | null
}) {
  // undefined = still loading, null = not found / not requested
  const [campaign, setCampaign] = useState<Campaign | null | undefined>(
    campaignId ? undefined : null,
  )

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    fetch(`/api/campaigns/${campaignId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setCampaign((body?.campaign as Campaign | undefined) ?? null)
      })
      .catch(() => {
        if (!cancelled) setCampaign(null)
      })
    return () => {
      cancelled = true
    }
  }, [campaignId])

  const initial: BuilderInitial = useMemo(() => {
    if (campaign) {
      return {
        name: `${campaign.name} entries`,
        description: "",
        trigger_type: "keyword_match" as AutomationTriggerType,
        trigger_config: {
          keywords: [campaign.keyword || campaign.code],
          match_type: "word",
          case_sensitive: false,
        },
        is_active: false,
        steps: [
          {
            cid: uid(),
            step_type: "campaign_add_entry" as AutomationStepType,
            step_config: { campaign_id: campaign.id },
          },
        ],
      }
    }
    if (template && AUTOMATION_TEMPLATES[template]) {
      const t = AUTOMATION_TEMPLATES[template]
      const steps = expandFromSeeds(
        t.steps.map((seed, idx) => ({
          index: idx,
          step_type: seed.step_type,
          step_config: seed.step_config as Record<string, unknown>,
          branch: seed.branch ?? null,
          parent_index: seed.parent_index ?? null,
        })),
      )
      return {
        name: t.name,
        description: t.description,
        trigger_type: t.trigger_type,
        trigger_config: t.trigger_config as Record<string, unknown>,
        is_active: false,
        steps,
      }
    }
    return {
      name: "",
      description: "",
      trigger_type: "new_message_received" as AutomationTriggerType,
      trigger_config: {},
      is_active: false,
      steps: [],
    }
  }, [template, campaign])

  if (campaign === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return <AutomationBuilder initial={initial} />
}

interface SeedRow {
  index: number
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branch: "yes" | "no" | null
  parent_index: number | null
}

function uid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/** Template seeds are flat with parent_index references. Expand into the
 *  builder's nested tree, preserving order within each scope. */
function expandFromSeeds(rows: SeedRow[]): BuilderStep[] {
  const nodes: BuilderStep[] = rows.map((r) => ({
    cid: uid(),
    step_type: r.step_type,
    step_config: r.step_config,
    branches:
      r.step_type === "condition" || r.step_type === "random_split"
        ? { yes: [], no: [] }
        : undefined,
  }))
  const roots: BuilderStep[] = []
  rows.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i])
      return
    }
    const parent = nodes[r.parent_index]
    if (!parent.branches) parent.branches = { yes: [], no: [] }
    parent.branches[r.branch ?? "yes"].push(nodes[i])
  })
  return roots
}
