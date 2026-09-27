"use client";
import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowDownToLine, Check, Film, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  CLIP_SOURCE,
  projectTrim,
  replaceProjectSource,
  statusLabels,
  trimSchema,
  videoProjectSchema,
  type Clip,
  type ClipDetail,
  type ClipProject,
  type ClipStatus,
  type Member,
  type Workspace,
} from "@clipstage/contracts";
import { api } from "@/lib/api";
import { fileSize, message } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input, Label, Select, Textarea } from "./ui/fields";
import { StatusBadge } from "./clip-card";
import { VideoTimeline } from "./video-timeline";

type EditorProps = {
  clip: Clip;
  workspace: Workspace;
  members: Member[];
  demo: boolean;
  demoUrl?: string;
  onClose: () => void;
  onSaved: (clip: Clip) => void;
};
export function ClipEditor(props: EditorProps) {
  const { clip, workspace, demo, demoUrl, onClose } = props;
  const {
    data: detail,
    error,
    mutate,
    isValidating,
  } = useSWR<ClipDetail>(
    demo ? null : `/workspaces/${workspace.id}/clips/${clip.id}`,
    api,
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
  if (!demo && (!detail || isValidating || error))
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogTitle>The editing room</DialogTitle>
          <DialogDescription>
            {error
              ? "Couldn't load this clip. Try again."
              : "Loading the latest clip and timeline…"}
          </DialogDescription>
          {error && (
            <Button className="mt-4" onClick={() => void mutate()}>
              Retry
            </Button>
          )}
        </DialogContent>
      </Dialog>
    );
  return (
    <EditorForm
      {...props}
      clip={detail ?? clip}
      playback={
        demo ? (demoUrl ?? "/demo-reel.mp4") : (detail?.playbackUrl ?? null)
      }
      downloadUrl={detail?.downloadUrl ?? null}
    />
  );
}

function EditorForm({
  clip: loadedClip,
  playback: loadedPlayback,
  downloadUrl,
  workspace,
  members,
  demo,
  demoUrl,
  onClose,
  onSaved,
}: EditorProps & { playback: string | null; downloadUrl: string | null }) {
  // Freeze the editing snapshot. Background library refreshes must not reset a timeline
  // or advance the expected version underneath an unsaved edit.
  const [{ clip, playback }] = useState(() => ({
    clip: loadedClip,
    playback: loadedPlayback,
  }));
  const [title, setTitle] = useState(clip.title),
    [brief, setBrief] = useState(clip.brief),
    [status, setStatus] = useState(clip.status);
  const [assigneeId, setAssigneeId] = useState(clip.assignee?.id ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const project = useRef<ClipProject | null>(null);
  const initialProject = useRef("");
  const ready = useCallback((value: ClipProject) => {
    project.current = value;
    initialProject.current = JSON.stringify(value);
  }, []);
  const changed = useCallback((value: ClipProject) => {
    project.current = value;
    setProjectDirty(JSON.stringify(value) !== initialProject.current);
  }, []);
  const owner = workspace.role === "OWNER",
    uploading = clip.status === "UPLOADING";
  const dirty =
    title !== clip.title ||
    brief !== clip.brief ||
    status !== clip.status ||
    assigneeId !== (clip.assignee?.id ?? "") ||
    projectDirty;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!title.trim()) throw new Error("Give this clip a title.");
      if (clip.status === "APPROVED" && status !== "EDITING")
        throw new Error(
          "Move this clip back to In progress before changing it.",
        );
      // Normalize every copy of the source (including nested/split layers). Reopening
      // resolves the reference against a fresh signed URL or the current demo blob.
      const savedProject =
        project.current && playback
          ? replaceProjectSource(project.current, playback, CLIP_SOURCE)
          : clip.project;
      if (savedProject && !videoProjectSchema.safeParse(savedProject).success)
        throw new Error(
          "This timeline can't be saved. Additional local media has temporary blob URLs; use the original clip, text, or durable media URLs. Projects must be under 1 MiB.",
        );
      const trim = savedProject ? projectTrim(savedProject) : clip.trim;
      if (trim) trimSchema.parse(trim);
      const updated: Clip = demo
        ? {
            ...clip,
            title: title.trim(),
            brief,
            status,
            assignee:
              members.find((member) => member.id === assigneeId) ?? null,
            trim,
            project: savedProject,
            version: clip.version + 1,
            updatedAt: new Date().toISOString(),
          }
        : await api<Clip>(`/workspaces/${workspace.id}/clips/${clip.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              version: clip.version,
              title,
              brief,
              status,
              assigneeId: assigneeId || null,
              trim,
              project: savedProject,
            }),
          });
      onSaved(updated);
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
            {playback && !uploading ? (
              <VideoTimeline
                clip={clip}
                playback={playback}
                onReady={ready}
                onChange={changed}
              />
            ) : (
              <div className="video-timeline video-message">
                <Film size={36} strokeWidth={1} />
                <h3>Your clip is on its way.</h3>
                <p>Reopen this clip after upload verification finishes.</p>
              </div>
            )}
            {demo && !demoUrl && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Preview uses an original abstract sample reel, not the
                illustrated game scene.
              </p>
            )}
            <p className="mt-4 flex gap-2 text-[11px] leading-5 text-muted-foreground">
              <Sparkles size={13} className="mt-1 shrink-0" />
              The timeline is saved with this clip. Export downloads an MP4
              locally; it never uploads a new clip or replaces the original.
            </p>
            <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
              Additional dropped files are temporary and must be removed before
              saving the timeline. Text, effects, and copies of the original
              source are saved.
            </p>
            <div className="source-meta">
              <span className="min-w-0 truncate">{clip.fileName}</span>
              <span>{fileSize(clip.sizeBytes)}</span>
              {downloadUrl && (
                <a
                  href={downloadUrl}
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
            disabled={busy || uploading || !dirty}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}Save
            changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
