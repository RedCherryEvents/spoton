import type { useTranslations } from "next-intl"
import { formatStepNumber } from "@/lib/automations/builder-tree"
import { issueStepPath, type ValidationIssue } from "@/lib/automations/validate"

type BuilderT = ReturnType<typeof useTranslations>

/**
 * Toast text for a validation issue: names the step the way the builder
 * shows it ("Step 5 · Start Flow") instead of the raw `steps[4].flow_id`.
 * `t` must be scoped to `Automations.builder`.
 */
export function issueToast(
  issue: ValidationIssue,
  t: BuilderT,
): { title: string; description?: string } {
  const message = issue.message.charAt(0).toUpperCase() + issue.message.slice(1)
  const loc = issueStepPath(issue.path)
  if (!loc || !issue.step_type) return { title: message }
  const number = formatStepNumber(loc.path, {
    yes: t("branches.yes"),
    no: t("branches.no"),
  })
  const step = t.has(`steps.${issue.step_type}`)
    ? t(`steps.${issue.step_type}`)
    : issue.step_type
  return { title: t("issues.atStep", { number, step }), description: message }
}
