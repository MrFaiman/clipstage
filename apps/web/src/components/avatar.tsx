import { cn, initials } from "@/lib/utils";
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const color =
    [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 4;
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-background",
        [
          "bg-[#e8e1f4] text-[#6b538f]",
          "bg-[#e5ebd9] text-[#5c7147]",
          "bg-[#f6e5d7] text-[#a87951]",
          "bg-[#dce9ee] text-[#51758a]",
        ][color],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
