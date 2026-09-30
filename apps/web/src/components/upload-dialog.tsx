"use client";
import { useRef, useState } from "react";
import { FileVideo, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  createUploadSchema,
  MAX_UPLOAD_BYTES,
  type Clip,
  type UploadTicket,
  type Viewer,
  type Workspace,
} from "@clipstage/contracts";
import { post, uploadFile } from "@/lib/api";
import { retryCompletion, uploadWithRetry } from "@/lib/resilient-upload";
import { uploadMultipart } from "@/lib/multipart-upload";
import { fileSize, message } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input, Label, Textarea } from "./ui/fields";

function videoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video"),
      url = URL.createObjectURL(file);
    let complete = false;
    const finish = (value?: number) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 4000);
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish(
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : undefined,
      );
    video.onerror = () => finish();
    video.src = url;
  });
}
export function UploadDialog({
  workspace,
  viewer,
  demo,
  onClose,
  onUploaded,
}: {
  workspace: Workspace;
  viewer: Viewer;
  demo: boolean;
  onClose: () => void;
  onUploaded: (clip: Clip, objectUrl?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(""),
    [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [phase, setPhase] = useState(""),
    [error, setError] = useState<string | null>(null);
  const clientId = useRef(crypto.randomUUID());
  function choose(next?: File) {
    if (!next) return;
    if (next.size > MAX_UPLOAD_BYTES) {
      setError("Choose a source file smaller than 2 GB.");
      return;
    }
    setFile(next);
    setTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 120));
    setError(null);
    clientId.current = crypto.randomUUID();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setPhase("Preparing your clip…");
    try {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      const inferred = (
        {
          mp4: "video/mp4",
          mov: "video/quicktime",
          webm: "video/webm",
          mkv: "video/x-matroska",
        } as Record<string, string>
      )[extension ?? ""];
      const input = createUploadSchema.parse({
        clientUploadId: clientId.current,
        title,
        brief,
        fileName: file.name,
        mimeType: inferred ?? file.type,
        sizeBytes: file.size,
        durationSeconds: await videoDuration(file),
        provider: "KICK",
      });
      if (demo) {
        const clip: Clip = {
          ...input,
          id: crypto.randomUUID(),
          status: "INBOX",
          durationSeconds: input.durationSeconds ?? null,
          trim: null,
          assignee: null,
          uploadedBy: viewer.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 0,
        };
        onUploaded(clip, URL.createObjectURL(file));
        toast.success(
          "Added to this demo tab. Nothing was uploaded to a server.",
        );
      } else {
        const base = `/workspaces/${workspace.id}/clips`;
        const ticket = await post<UploadTicket>(`${base}/uploads`, input);
        setPhase("Uploading directly to storage…");
        if (ticket.multipart) {
          await uploadMultipart(
            ticket,
            file,
            () => post<UploadTicket>(`${base}/uploads`, input),
            async (clipId, number) =>
              (
                await post<{ uploadUrl: string }>(
                  `${base}/${clipId}/parts/${number}`,
                )
              ).uploadUrl,
            (url, chunk, progress) =>
              uploadFile(url, chunk, {}, progress, false),
            setProgress,
          );
        } else {
          await uploadWithRetry(
            ticket,
            () => post<UploadTicket>(`${base}/uploads`, input),
            (next) =>
              uploadFile(next.uploadUrl!, file, next.headers, setProgress),
            (attempt) => {
              setPhase(`Connection interrupted. Retrying (${attempt}/3)…`);
              setProgress(0);
            },
          );
        }
        setPhase("Verifying your upload…");
        const clip = await retryCompletion(() =>
          post<Clip>(`${base}/${ticket.clipId}/complete`),
        );
        onUploaded(clip);
        toast.success("Clip uploaded. Your team can see it now.");
      }
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle>A moment worth keeping.</DialogTitle>
        <DialogDescription>
          Upload the source. Add a little direction. Your team takes it from
          here.{demo && " In demo mode, the file stays in this browser tab."}
        </DialogDescription>
        <form className="mt-6 space-y-5" onSubmit={submit}>
          <div
            className="upload-dropzone"
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) choose(event.dataTransfer.files[0]);
            }}
          >
            <input
              id="clip-file"
              type="file"
              className="sr-only"
              accept=".mp4,.mov,.webm,.mkv"
              disabled={busy}
              onChange={(event) => choose(event.target.files?.[0])}
            />
            <label
              htmlFor="clip-file"
              className="flex cursor-pointer flex-col items-center gap-2 p-7"
            >
              <span className="mb-2 grid size-11 place-items-center rounded-full bg-muted">
                {file ? <FileVideo size={22} /> : <Upload size={21} />}
              </span>
              <span className="max-w-full truncate text-sm font-semibold">
                {file ? file.name : "Choose a clip or drop it here"}
              </span>
              <span className="text-xs text-muted-foreground">
                {file
                  ? `${fileSize(file.size)} · Click to change`
                  : "MP4, MOV, WebM or MKV · Up to 2 GB"}
              </span>
            </label>
          </div>
          <div>
            <Label htmlFor="clip-title">Give it a name</Label>
            <Input
              id="clip-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
              disabled={busy}
              placeholder="The one chat won't stop talking about"
            />
          </div>
          <div>
            <Label htmlFor="clip-brief">
              The brief{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="clip-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              maxLength={4000}
              disabled={busy}
              placeholder="What's the hook? Where should the cut start? Give your editor a little direction…"
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs leading-relaxed text-red-700"
            >
              {error}
            </p>
          )}
          {busy && (
            <div role="status">
              <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                <span>{phase}</span>
                <span>{progress}%</span>
              </div>
              <progress
                max={100}
                value={progress}
                className="h-1.5 w-full accent-[#789e3d]"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Keep this tab open until verification finishes.
              </p>
            </div>
          )}
          <Button
            type="submit"
            variant="dark"
            className="w-full"
            disabled={!file || busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {busy
              ? "Making the handoff…"
              : demo
                ? "Add to demo workspace"
                : "Upload & share with team"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
