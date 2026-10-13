"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

// Client-only: the generator restores the user's script from
// sessionStorage, which doesn't exist during server rendering.
const AutomationGenerator = dynamic(
  () => import("@/components/automations/automation-generator").then((m) => m.AutomationGenerator),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    ),
  },
)

export default function GenerateAutomationPage() {
  return <AutomationGenerator />
}
