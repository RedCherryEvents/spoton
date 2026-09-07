import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WelcomePage } from "@/components/welcome/welcome-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WelcomePage");
  return {
    title: { absolute: t("metaTitle") },
    description: t("metaDescription"),
  };
}

export default function RootPage() {
  return <WelcomePage />;
}
