import { cn } from "@/lib/utils";

/**
 * Compact GIA brand mark — geometric "G" with a signal node.
 * Uses currentColor so it adapts to light/dark parents.
 */
export function GiaMark({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 text-violet-600 dark:text-violet-300", className)}
      aria-hidden
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        className="fill-violet-500/15 stroke-current"
        strokeWidth="1"
        opacity={0.45}
      />
      <path
        d="M22.2 11.2A7.2 7.2 0 1 0 22.5 18.8"
        className="stroke-current"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M16.2 16.2H22.8"
        className="stroke-current"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="23.4" cy="16.2" r="2.1" className="fill-current" />
      <circle cx="23.4" cy="16.2" r="0.85" className="fill-background" />
    </svg>
  );
}

/** Wordmark used next to GiaMark */
export function GiaWordmark({
  className,
  subtitle,
  size = "sm",
}: {
  className?: string;
  subtitle?: string;
  size?: "sm" | "lg";
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline gap-1.5 leading-none">
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            size === "lg" ? "text-base font-bold" : "text-sm",
          )}
        >
          GIA
        </span>
        <span
          className={cn(
            "font-medium tracking-wide text-violet-600 dark:text-violet-300/90",
            size === "lg" ? "text-xs" : "text-[11px]",
          )}
        >
          Core
        </span>
      </div>
      {subtitle ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
