import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      src="/spot-on-logo.png"
      alt="SPOT ON"
      className={cn("h-8 w-auto", className)}
      {...(priority ? { fetchPriority: "high" as const } : {})}
    />
  );
}
