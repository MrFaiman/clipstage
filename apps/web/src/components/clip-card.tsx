import Image from "next/image";
import {
  ArrowUpRight,
  FileVideo,
  MessageSquareText,
  Play,
  UserRound,
} from "lucide-react";
import type { Clip } from "@clipstage/contracts";
import { statusLabels } from "@clipstage/contracts";
import { cn, duration } from "@/lib/utils";
import { Avatar } from "./avatar";
import { KickMark } from "./brand";

export function StatusBadge({ status }: { status: Clip["status"] }) {
  return (
    <span className={cn("status-badge", `status-${status.toLowerCase()}`)}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
export function ClipCard({
  clip,
  demo,
  index,
  view,
  onOpen,
}: {
  clip: Clip;
  demo: boolean;
  index: number;
  view: "grid" | "list";
  onOpen: () => void;
}) {
  const art = Number(clip.id.replace("demo-clip-", ""));
  return (
    <button
      onClick={onOpen}
      className={cn("clip-card group", view === "list" && "clip-card-list")}
      aria-label={`Open ${clip.title}`}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <div className="clip-thumbnail">
        {demo && art >= 1 && art <= 6 ? (
          <Image
            src={`/thumbnails/scene-${art}.svg`}
            alt=""
            fill
            sizes={
              view === "list"
                ? "160px"
                : "(max-width: 700px) 100vw, (max-width: 1200px) 50vw, 33vw"
            }
            className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
          />
        ) : (
          <div className="source-placeholder">
            <FileVideo size={34} strokeWidth={1} />
            <span>Original capture</span>
          </div>
        )}
        <span className="source-chip">
          {clip.provider === "KICK" ? (
            <KickMark className="size-2.5" />
          ) : (
            <FileVideo size={11} />
          )}
          {clip.provider}
        </span>
        <span className="thumbnail-play">
          <Play size={20} fill="currentColor" />
        </span>
        <span className="clip-duration">{duration(clip.durationSeconds)}</span>
        {demo && <span className="demo-art-label">DEMO CAPTURE</span>}
      </div>
      <div className="clip-body">
        <div className="mb-3 flex items-center justify-between gap-2">
          <StatusBadge status={clip.status} />
          <span className="clip-date">
            {new Intl.DateTimeFormat("en", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(clip.createdAt))}
          </span>
        </div>
        <h3 className="truncate text-[14px] font-semibold tracking-[-0.25px]">
          {clip.title}
        </h3>
        <p className="clip-brief">
          <MessageSquareText size={13} />
          <span>{clip.brief || "No brief yet. Add a little direction."}</span>
        </p>
        <div className="clip-card-footer">
          <span className="flex items-center gap-2">
            {clip.assignee ? (
              <>
                <Avatar
                  name={clip.assignee.name}
                  avatarUrl={clip.assignee.avatarUrl}
                  className="size-5 text-[8px]"
                />
                <span>{clip.assignee.name}</span>
              </>
            ) : (
              <>
                <span className="grid size-5 place-items-center rounded-full border border-dashed border-border">
                  <UserRound size={11} />
                </span>
                <span>Unassigned</span>
              </>
            )}
          </span>
          <ArrowUpRight
            size={15}
            className="text-muted-foreground/50 transition-colors group-hover:text-foreground"
          />
        </div>
      </div>
    </button>
  );
}
