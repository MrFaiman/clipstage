import { cn } from "@/lib/utils";
export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      {!compact && (
        <span className="text-[23px] font-bold tracking-[-1.1px]">
          clipstage<span className="text-primary">.</span>
        </span>
      )}
    </div>
  );
}
export function KickMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      <path d="M3 3h6v6h3V6h3V3h6v6h-3v3h-3v3h3v3h3v3h-6v-3h-3v-3H9v6H3z" />
    </svg>
  );
}
