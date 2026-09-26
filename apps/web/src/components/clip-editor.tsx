"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowDownToLine,
  Check,
  Film,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  statusLabels,
  trimSchema,
  type Clip,
  type ClipDetail,
  type ClipStatus,
  type Member,
  type Workspace,
} from "@clipstage/contracts";
import { api } from "@/lib/api";
import { duration, fileSize, message } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input, Label, Select, Textarea } from "./ui/fields";
import { StatusBadge } from "./clip-card";

export function ClipEditor({
  clip,
  workspace,
  members,
  demo,
  demoUrl,
  onClose,
  onSaved,
}: {
  clip: Clip;
  workspace: Workspace;
  members: Member[];
  demo: boolean;
  demoUrl?: string;
  onClose: () => void;
  onSaved: (clip: Clip) => void;
}) {
  const path = `/workspaces/${workspace.id}/clips/${clip.id}`;
  const {
    data: detail,
    error: loadError,
    mutate,
  } = useSWR<ClipDetail>(demo ? null : path, api, { revalidateOnFocus: false });
  const [title, setTitle] = useState(clip.title),
    [brief, setBrief] = useState(clip.brief),
    [status, setStatus] = useState(clip.status);
  const [assigneeId, setAssigneeId] = useState(clip.assignee?.id ?? ""),
    [trim, setTrim] = useState(clip.trim);
  const [length, setLength] = useState(clip.durationSeconds ?? 0),
    [playhead, setPlayhead] = useState(0);
  const [busy, setBusy] = useState(false),
    [videoError, setVideoError] = useState(false),
    [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playback = demo ? (demoUrl ?? "/demo-reel.mp4") : detail?.playbackUrl;
  const owner = workspace.role === "OWNER",
    uploading = clip.status === "UPLOADING";
  const inPoint = trim?.start ?? 0,
    outPoint = trim?.end ?? length;
  const dirty =
    title !== clip.title ||
    brief !== clip.brief ||
    status !== clip.status ||
    assigneeId !== (clip.assignee?.id ?? "") ||
    JSON.stringify(trim) !== JSON.stringify(clip.trim);
  const [version, setVersion] = useState(clip.version);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (trim) trimSchema.parse(trim);
      if (!title.trim()) throw new Error("Give this clip a title.");
      if (trim && length && trim.end > length + 0.1)
        throw new Error("The out point must be inside the source video.");
      if (clip.status === "APPROVED" && status !== "EDITING")
        throw new Error(
          "Move this clip back to In progress before changing it.",
        );
      const updated = demo
        ? {
            ...clip,
            title: title.trim(),
            brief,
            status,
            assignee:
              members.find((member) => member.id === assigneeId) ?? null,
            trim,
            version: version + 1,
            updatedAt: new Date().toISOString(),
          }
        : await api<Clip>(path, {
            method: "PATCH",
            body: JSON.stringify({
              version,
              title,
              brief,
              status,
              assigneeId: assigneeId || null,
              trim,
            }),
          });
      onSaved(updated);
      setVersion(updated.version);
      toast.success(
        demo
          ? "Changes saved in this demo tab"
          : "Changes shared with your team",
      );
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (!busy && (!dirty || window.confirm("Discard your unsaved changes?")))
      onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="editor-dialog"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="editor-heading">
          <span className="editor-icon">
            <Film size={19} />
          </span>
          <div>
            <DialogTitle className="text-base">The editing room</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {demo
                ? "Sample workspace · No server changes"
                : `${workspace.name} · Original source`}
            </DialogDescription>
          </div>
          <StatusBadge status={clip.status} />
        </div>
        <div className="editor-layout">
          <div className="editor-media">
            <div className="video-stage">
              {playback && !videoError ? (
                <video
                  ref={video}
                  src={playback}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Preview: ${clip.title}`}
                  onLoadedMetadata={(event) => {
                    const actual = event.currentTarget.duration;
                    if (Number.isFinite(actual)) setLength(actual);
                  }}
                  onTimeUpdate={(event) => {
                    setPlayhead(event.currentTarget.currentTime);
                  }}
                  onError={() => setVideoError(true)}
                />
              ) : (
                <div className="video-message">
                  <Film size={36} strokeWidth={1} />
                  <h3>
                    {uploading
                      ? "Your clip is on its way."
                      : loadError
                        ? "Couldn't load the source."
                        : videoError
                          ? "This format needs a different player."
                          : "Loading your moment…"}
                  </h3>
                  <p>
                    {videoError
                      ? "Download the original and open it in your editing software. H.264/AAC MP4 works best in the browser."
                      : uploading
                        ? "Reopen this clip after upload verification finishes."
                        : "The original recording stays untouched."}
                  </p>
                  {loadError && (
                    <Button variant="outline" onClick={() => void mutate()}>
                      Retry
                    </Button>
                  )}
                </div>
              )}
            </div>
            {demo && !demoUrl && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Preview uses an original abstract sample reel, not the
                illustrated game scene.
              </p>
            )}
            <div className="trim-panel">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Scissors size={14} /> Find the best part
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {duration(playhead)} / {duration(length || null)}
                </span>
              </div>
              <div className="trim-timeline" aria-hidden="true">
                {Array.from({ length: 64 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      height: `${10 + ((i * 13 + i * i * 7) % 25)}px`,
                      opacity:
                        length &&
                        (i / 64 < inPoint / length ||
                          i / 64 > outPoint / length)
                          ? 0.18
                          : 0.85,
                    }}
                  />
                ))}
                <i
                  style={{
                    left: `${length ? Math.min(100, (playhead / length) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="trim-controls">
                <div>
                  <Label htmlFor="trim-start">In point (seconds)</Label>
                  <Input
                    id="trim-start"
                    type="number"
                    min={0}
                    max={Math.max(0, outPoint - 0.1)}
                    step={0.1}
                    value={Number(inPoint.toFixed(1))}
                    disabled={uploading || !length}
                    onChange={(event) =>
                      setTrim({
                        start: Number(event.target.value),
                        end: outPoint,
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      setTrim({
                        start: Math.min(playhead, outPoint - 0.1),
                        end: outPoint,
                      })
                    }
                    disabled={!length || uploading}
                    className="mt-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Use playhead
                  </button>
                </div>
                <div>
                  <Label htmlFor="trim-end">Out point (seconds)</Label>
                  <Input
                    id="trim-end"
                    type="number"
                    min={inPoint + 0.1}
                    max={length || undefined}
                    step={0.1}
                    value={Number(outPoint.toFixed(1))}
                    disabled={uploading || !length}
                    onChange={(event) =>
                      setTrim({
                        start: inPoint,
                        end: Number(event.target.value),
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      setTrim({
                        start: inPoint,
                        end: Math.max(playhead, inPoint + 0.1),
                      })
                    }
                    disabled={!length || uploading}
                    className="mt-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Use playhead
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reset trim points"
                  onClick={() => setTrim(null)}
                  disabled={uploading}
                >
                  <RotateCcw size={14} />
                </Button>
              </div>
              <p className="mt-4 flex gap-2 text-[11px] leading-5 text-muted-foreground">
                <Sparkles size={13} className="mt-1 shrink-0" />
                Non-destructive editing: trim points are saved for your team.
                This preview does not render or export a new video.
              </p>
            </div>
            <div className="source-meta">
              <span className="min-w-0 truncate">{clip.fileName}</span>
              <span>{fileSize(clip.sizeBytes)}</span>
              {detail?.downloadUrl && (
                <a
                  href={detail.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1.5 font-medium text-foreground"
                >
                  <ArrowDownToLine size={12} />
                  Original
                </a>
              )}
            </div>
          </div>
          <div className="editor-details">
            <div>
              <Label htmlFor="edit-title">Clip title</Label>
              <Input
                id="edit-title"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                disabled={uploading || busy}
              />
            </div>
            <div>
              <Label htmlFor="edit-brief">The streamer's brief</Label>
              <Textarea
                id="edit-brief"
                value={brief}
                maxLength={4000}
                onChange={(event) => setBrief(event.target.value)}
                className="min-h-36"
                disabled={uploading || busy}
                placeholder="What should the editor know?"
              />
              <span className="mt-2 block text-[10px] text-muted-foreground">
                Shared direction, right next to the source.
              </span>
            </div>
            <div>
              <Label htmlFor="edit-assignee">Assigned editor</Label>
              <Select
                id="edit-assignee"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                disabled={uploading || busy}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-status">Workflow status</Label>
              <Select
                id="edit-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ClipStatus)
                }
                disabled={uploading || busy}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option
                    key={value}
                    value={value}
                    disabled={
                      value === "UPLOADING" || (value === "APPROVED" && !owner)
                    }
                  >
                    {label}
                  </option>
                ))}
              </Select>
              {!owner && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  The workspace owner gives final approval.
                </p>
              )}
            </div>
            <div className="mt-auto border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
              Captured by{" "}
              <span className="font-medium text-foreground">
                {clip.uploadedBy}
              </span>
              <br />
              Original files are preserved. Save when you're ready to share your
              changes.
            </div>
          </div>
        </div>
        <div className="editor-footer">
          {error ? (
            <p role="alert" className="mr-auto text-xs text-red-700">
              {error}
            </p>
          ) : (
            <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
              {dirty
                ? "You have unsaved changes"
                : "A great edit starts with a little direction."}
            </p>
          )}
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="dark"
            onClick={save}
            disabled={busy || uploading || !dirty || (!demo && !detail)}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}Save
            changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
