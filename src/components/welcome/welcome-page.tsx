import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BrandLogo } from "@/components/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FORMAT_BEATS = ["1", "2", "3", "4"] as const;

const JOURNEY_STEPS = ["1", "2", "3", "4", "5"] as const;

export async function WelcomePage() {
  const t = await getTranslations("WelcomePage");

  return (
    <div className="relative min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/40 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center">
            <BrandLogo className="h-8 w-auto" priority />
            <span className="sr-only">{t("brand")}</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-10 px-3")}
            >
              {t("navSignIn")}
            </Link>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}
            >
              {t("navStart")}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-20 pt-16 text-center sm:px-6 sm:pb-28 sm:pt-24">
          <div className="relative mb-10 flex h-[7.25rem] w-[7.25rem] items-center justify-center rounded-2xl surface-glass shadow-[0_0_80px_oklch(0.585_0.225_27_/_0.42)]">
            <BrandLogo className="h-11 w-auto" />
          </div>
          <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-primary">
            {t("eyebrow")}
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl sm:leading-[1.05]">
            {t("heroTitle")}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("heroBody")}
          </p>
          <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}
            >
              {t("heroCta")}
            </Link>
            <Link
              href="/login"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 px-6",
              )}
            >
              {t("heroSecondary")}
            </Link>
          </div>

          <dl className="mt-16 grid w-full gap-3 sm:grid-cols-3">
            <Stat value={t("statWaValue")} label={t("statWaLabel")} />
            <Stat value={t("statTimeValue")} label={t("statTimeLabel")} />
            <Stat value={t("statCtrValue")} label={t("statCtrLabel")} />
          </dl>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-primary">
            {t("problemEyebrow")}
          </p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("problemTitle")}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("problemBody")}
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-primary">
            {t("formatEyebrow")}
          </p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("formatTitle")}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("formatBody")}
          </p>

          <div className="mt-10 flex h-2 overflow-hidden rounded-full bg-muted">
            <span className="w-[12.5%] bg-primary" />
            <span className="w-1/2 bg-foreground/20" />
            <span className="w-1/4 bg-primary/55" />
            <span className="w-[12.5%] bg-primary shadow-[0_0_18px_oklch(0.585_0.225_27_/_0.7)]" />
          </div>
          <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {t("formatScale")}
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {FORMAT_BEATS.map((beat) => (
              <article
                key={beat}
                className="surface-glass rounded-xl border border-border p-5 text-left"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
                  {t(`beat${beat}Label`)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`beat${beat}Time`)}
                </p>
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {t(`beat${beat}Title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`beat${beat}Body`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
          <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-primary">
            {t("journeyEyebrow")}
          </p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("journeyTitle")}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("journeyBody")}
          </p>

          <ol className="mt-10 grid gap-3 lg:grid-cols-5">
            {JOURNEY_STEPS.map((step) => (
              <li
                key={step}
                className="surface-glass rounded-xl border border-border p-5 text-left"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
                  {t(`step${step}Num`)}
                </p>
                <h3 className="mt-3 text-base font-semibold text-foreground">
                  {t(`step${step}Title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`step${step}Body`)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="surface-glass rounded-2xl border border-border px-6 py-12 text-center sm:px-12 sm:py-16">
            <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-primary">
              {t("closeEyebrow")}
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("closeTitle")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              {t("closeBody")}
            </p>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: "lg" }), "mt-8 inline-flex h-11 px-6")}
            >
              {t("closeCta")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 py-6 text-xs uppercase tracking-[0.18em] text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>{t("footerMark")}</span>
          <span>{t("footerCredit")}</span>
        </div>
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="surface-glass rounded-xl border border-border px-5 py-6 text-left">
      <dt className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {value}
      </dt>
      <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{label}</dd>
    </div>
  );
}
