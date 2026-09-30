"use client";
import { useState } from "react";
import { cn, initials } from "@/lib/utils";
export function Avatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const safeUrl = avatarUrl?.startsWith("https://") ? avatarUrl : null;
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
      {safeUrl && safeUrl !== failedUrl ? (
        // Render provider images directly, without making the server fetch an
        // arbitrary external URL. Keep the container size fixed on failure.
        <img
          key={safeUrl}
          src={safeUrl}
          alt=""
          width={48}
          height={48}
          className="size-full rounded-full object-cover"
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setFailedUrl(safeUrl)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
