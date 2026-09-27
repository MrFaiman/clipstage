"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowRight,
  Cable,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Monitor,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  Twitch,
  Users,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import {
  LOGO_TYPES,
  MAX_LOGO_BYTES,
  workspaceSchema,
  type Connection,
  type Device,
  type InviteResult,
  type LogoTicket,
  type Member,
  type PendingInvite,
  type Viewer,
  type Workspace,
} from "@clipstage/contracts";
import { API_URL, api, post, uploadFile } from "@/lib/api";
import { initials, message } from "@/lib/utils";
import { Avatar } from "./avatar";
import { KickMark } from "./brand";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input, Label } from "./ui/fields";

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Clipboard unavailable. Select and copy the text manually.");
  }
}
function logoMime(file: File) {
  if ((LOGO_TYPES as readonly string[]).includes(file.type))
    return file.type as (typeof LOGO_TYPES)[number];
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}
function WorkspaceForm({
  workspace,
  demo,
  onUpdated,
}: {
  workspace: Workspace;
  demo: boolean;
  onUpdated: (workspace: Workspace) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(workspace.name);
    setFile(null);
    setRemoveLogo(false);
  }, [workspace]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const shown = preview ?? (removeLogo ? null : workspace.logoUrl);
  const parsed = workspaceSchema.safeParse({ name });
  return (
    <form
      className="panel-card mb-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!parsed.success) return;
        setBusy(true);
        try {
          if (demo) {
            onUpdated({
              ...workspace,
              name: parsed.data.name,
              logoUrl: file
                ? URL.createObjectURL(file)
                : removeLogo
                  ? null
                  : workspace.logoUrl,
            });
            setFile(null);
            setRemoveLogo(false);
            toast.success("Workspace updated");
            return;
          }
          let next = workspace;
          if (parsed.data.name !== workspace.name)
            next = await api<Workspace>(`/workspaces/${workspace.id}`, {
              method: "PATCH",
              body: JSON.stringify({ name: parsed.data.name }),
            });
          if (file) {
            const mimeType = logoMime(file);
            if (!mimeType) throw new Error("Use a JPEG, PNG, or WebP logo.");
            const ticket = await post<LogoTicket>(
              `/workspaces/${workspace.id}/logo`,
              { mimeType, sizeBytes: file.size },
            );
            await uploadFile(ticket.uploadUrl, file, ticket.headers, () => {});
            next = await post<Workspace>(
              `/workspaces/${workspace.id}/logo/complete`,
              { key: ticket.key, mimeType, sizeBytes: file.size },
            );
          } else if (removeLogo && workspace.logoUrl) {
            next = await api<Workspace>(`/workspaces/${workspace.id}/logo`, {
              method: "DELETE",
            });
          }
          onUpdated(next);
          setFile(null);
          setRemoveLogo(false);
          toast.success("Workspace updated");
        } catch (cause) {
          toast.error(message(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="panel-card-header">
        <div>
          <h2>This workspace</h2>
          <p>The name and logo appear in the sidebar for everyone here.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-6 px-6 py-6">
        <div className="workspace-icon workspace-logo" aria-hidden="true">
          {shown ? <img src={shown} alt="" /> : initials(name).slice(0, 1)}
        </div>
        <div className="min-w-56 flex-1 space-y-4">
          <div>
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              name="name"
              value={name}
              maxLength={60}
              required
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="workspace-logo" className="mb-0">
              Workspace logo
            </Label>
            <Input
              id="workspace-logo"
              name="logo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = "";
                if (!next) return;
                if (!logoMime(next) || next.size > MAX_LOGO_BYTES) {
                  toast.error("Use a JPEG, PNG, or WebP image up to 2 MB.");
                  return;
                }
                setFile(next);
                setRemoveLogo(false);
              }}
            />
            {(file || (workspace.logoUrl && !removeLogo)) && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setRemoveLogo(true);
                }}
              >
                Remove logo
              </Button>
            )}
          </div>
        </div>
        <Button type="submit" disabled={busy || !parsed.success}>
          {busy && <Loader2 className="animate-spin" />}Save workspace
        </Button>
      </div>
    </form>
  );
}
export function TeamPanel({
  members,
  workspace,
  owner,
  demo,
  onUpdated,
  onInvite,
  onCreate,
  onRemove,
}: {
  members: Member[];
  workspace: Workspace;
  owner: boolean;
  demo: boolean;
  onUpdated: (workspace: Workspace) => void;
  onInvite: () => void;
  onCreate: () => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const { data: invites = [], mutate: refreshInvites } = useSWR<
    PendingInvite[]
  >(demo || !owner ? null : `/workspaces/${workspace.id}/invitations`, api);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BETTER TOGETHER</div>
          <h1>
            Your behind-the-scenes <span>dream team.</span>
          </h1>
          <p>One shared space. A whole lot of creative possibilities.</p>
        </div>
        {owner && (
          <Button variant="dark" onClick={onInvite}>
            <Plus /> Invite editor
          </Button>
        )}
      </div>
      {owner && (
        <WorkspaceForm
          workspace={workspace}
          demo={demo}
          onUpdated={onUpdated}
        />
      )}
      <div className="panel-card">
        <div className="panel-card-header">
          <div>
            <h2>
              Workspace members{" "}
              <span className="count-pill ml-2">{members.length}</span>
            </h2>
            <p>
              Everyone here can view clips, save edits, and collaborate on
              briefs.
            </p>
          </div>
          <Users size={21} className="text-muted-foreground" />
        </div>
        <div className="divide-y divide-border">
          {members.map((member) => (
            <div
              className="flex flex-wrap items-center gap-4 px-6 py-5"
              key={member.id}
            >
              <Avatar name={member.name} className="size-10 text-xs" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{member.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {member.role === "OWNER"
                    ? "Workspace management & final approval"
                    : "Clip editing & review"}
                </p>
              </div>
              <span className="rounded-md bg-muted px-2.5 py-1 text-[11px] font-medium">
                {member.role === "OWNER" ? "Owner" : "Editor"}
              </span>
              {owner && member.role !== "OWNER" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.name}`}
                  disabled={removing === member.id}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Remove ${member.name} from this workspace? They will lose access and their assigned clips will be unassigned.`,
                      )
                    )
                      return;
                    setRemoving(member.id);
                    try {
                      await onRemove(member.id);
                      toast.success("Member removed");
                    } catch (cause) {
                      toast.error(message(cause));
                    } finally {
                      setRemoving(null);
                    }
                  }}
                >
                  {removing === member.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
      {owner && invites.length > 0 && (
        <div className="panel-card mt-5">
          <div className="panel-card-header">
            <div>
              <h2>
                Waiting for Kick sign-in{" "}
                <span className="count-pill ml-2">{invites.length}</span>
              </h2>
              <p>
                These people join as editors the next time they sign in with
                Kick.
              </p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {invites.map((invite) => {
              const label = invite.email ?? invite.username ?? "Kick account";
              return (
                <div
                  className="flex items-center gap-4 px-6 py-4"
                  key={invite.id}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold">{label}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancel invitation for ${label}`}
                    disabled={cancelling === invite.id}
                    onClick={async () => {
                      setCancelling(invite.id);
                      try {
                        await api(
                          `/workspaces/${workspace.id}/invitations/${invite.id}`,
                          { method: "DELETE" },
                        );
                        await refreshInvites();
                        toast.success("Invitation cancelled");
                      } catch (cause) {
                        toast.error(message(cause));
                      } finally {
                        setCancelling(null);
                      }
                    }}
                  >
                    {cancelling === invite.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-border p-6">
        <div>
          <h3 className="text-sm font-semibold">
            Different channel, different team?
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep clips and collaborators separate with another workspace.
          </p>
        </div>
        <Button variant="outline" onClick={onCreate}>
          <Plus /> Create workspace
        </Button>
      </div>
    </>
  );
}
export function InviteDialog({
  open,
  onOpenChange,
  workspace,
  demo,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  workspace: Workspace;
  demo: boolean;
  onInvited: () => void;
}) {
  const [identifier, setIdentifier] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setIdentifier("");
          setResult(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <span className="mb-5 inline-flex rounded-xl bg-primary/25 p-3">
          <Users size={22} />
        </span>
        <DialogTitle>Make room for great edits.</DialogTitle>
        <DialogDescription>
          Invite an editor to {workspace.name} with their Kick email or
          username. If they already use Clipstage, they join now. Otherwise they
          join the next time they sign in. No email is sent, and the invite
          expires in 7 days.
        </DialogDescription>
        {demo ? (
          <div className="mt-6 rounded-lg bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
            Invitations aren't sent from the demo. Connect the API and sign in
            with Kick to invite your real team.
          </div>
        ) : result ? (
          <p className="mt-6 text-sm leading-relaxed">
            {result.status === "joined"
              ? `${result.name} is now an editor.`
              : "They'll join the next time they sign in with Kick. This invite expires in 7 days."}
          </p>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                const created = await post<InviteResult>(
                  `/workspaces/${workspace.id}/invitations`,
                  { identifier },
                );
                setResult(created);
                onInvited();
              } catch (cause) {
                toast.error(message(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <Label htmlFor="invite-identifier">Kick email or username</Label>
              <Input
                id="invite-identifier"
                name="identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="alexplays or alex@example.com"
                autoComplete="off"
                required
                disabled={busy}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}Add editor
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function SettingsPanel({
  viewer,
  demo,
}: {
  viewer: Viewer;
  demo: boolean;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h1>
            Settings that stay <span>with you.</span>
          </h1>
          <p>
            Connections belong to your account. Clips belong to your workspace.
          </p>
        </div>
      </div>
      <section
        className="account-summary panel-card"
        aria-labelledby="account-heading"
      >
        <Avatar name={viewer.name} className="size-12 ring-0" />
        <div>
          <h2 id="account-heading">{viewer.name}</h2>
          <p>{demo ? "Demo account" : "Personal account"}</p>
        </div>
      </section>
      <section aria-labelledby="connections-heading">
        <div className="settings-kicker">
          <h2 id="connections-heading">Connections</h2>
          <p>Meet your stream where it lives.</p>
        </div>
        <ConnectionsPanel connections={viewer.connections} demo={demo} />
      </section>
    </>
  );
}
function ConnectionsPanel({
  connections,
  demo,
}: {
  connections: Connection[];
  demo: boolean;
}) {
  const kick = connections.filter(
    (connection) => connection.provider === "KICK",
  );
  return (
    <>
      <div className="connection-cards">
        <div className="panel-card p-6">
          <div className="flex items-start justify-between">
            <span className="grid size-12 place-items-center rounded-xl bg-[#e6f9d7]">
              <KickMark className="size-6" />
            </span>
            <span className="status-badge status-approved">
              <span />
              {kick.length ? "Connected" : "Available"}
            </span>
          </div>
          <h2 className="mt-5 text-xl font-semibold">Kick</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your first stage. Secure OAuth sign-in with access to your basic
            profile only.
          </p>
          <div className="my-5 space-y-2">
            {kick.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between rounded-lg bg-muted px-3 py-2.5 text-xs"
              >
                <span>@{connection.username}</span>
                <Check size={13} className="text-green-700" />
              </div>
            ))}
          </div>
          <Button asChild variant="outline" className="w-full">
            <a href={demo ? "/login" : `${API_URL}/auth/kick`}>
              <Plus />{" "}
              {kick.length ? "Connect another Kick account" : "Connect Kick"}
            </a>
          </Button>
        </div>
        {[
          {
            name: "Twitch",
            icon: Twitch,
            color: "bg-[#eee7fc] text-[#8d5cde]",
          },
          {
            name: "YouTube",
            icon: Youtube,
            color: "bg-[#fde9e6] text-[#d26255]",
          },
        ].map(({ name, icon: Icon, color }) => (
          <div className="panel-card flex flex-col p-6" key={name}>
            <div className="flex items-start justify-between">
              <span
                className={`grid size-12 place-items-center rounded-xl ${color}`}
              >
                <Icon size={25} />
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                COMING LATER
              </span>
            </div>
            <h2 className="mt-5 text-xl font-semibold">{name}</h2>
            <p className="mb-6 mt-2 text-sm leading-6 text-muted-foreground">
              More places to go live. The same shared home for your clips and
              your team.
            </p>
            <Button variant="outline" disabled className="mt-auto w-full">
              Not available yet
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-3 rounded-xl bg-[#eef2e9] p-5 text-sm">
        <ShieldCheck size={19} className="shrink-0" />
        <p className="leading-relaxed">
          Your stream key stays yours. Clipstage uploads local OBS recordings;
          it doesn't capture video through your streaming account.
        </p>
      </div>
    </>
  );
}
export function ObsPanel({
  workspace,
  demo,
}: {
  workspace: Workspace;
  demo: boolean;
}) {
  const owner = workspace.role === "OWNER";
  const path = `/workspaces/${workspace.id}/devices`;
  const {
    data: devices = [],
    mutate,
    error,
  } = useSWR<Device[]>(demo || !owner ? null : path, api, {
    refreshInterval: 15000,
  });
  const [busy, setBusy] = useState(false),
    [name, setName] = useState("Streaming PC");
  const [credential, setCredential] = useState<{
    apiUrl: string;
    workspaceId: string;
    token: string;
  } | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAPTURE. HAND OFF. KEEP STREAMING.</div>
          <h1>
            Your OBS, <span>with a backstage pass.</span>
          </h1>
          <p>A small plugin. A much shorter path from a moment to an edit.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/setup">
            Plugin setup guide <ArrowRight />
          </Link>
        </Button>
      </div>
      <div className="obs-intro panel-card">
        <div className="obs-symbol">
          <Radio size={45} strokeWidth={1.4} />
        </div>
        <div>
          <span className="eyebrow">NATIVE OBS PLUGIN · SOURCE PREVIEW</span>
          <h2>Stop recording. Start collaborating.</h2>
          <p>
            The Clipstage dock sends completed recordings or saved replay-buffer
            clips to this workspace, along with your brief. Streaming keeps
            running.
          </p>
          <p className="mt-2 !text-xs">
            Source code is included. Prebuilt installers and automatic updates
            are not available yet.
          </p>
        </div>
      </div>
      <div className="setup-steps">
        {[
          {
            title: "Build & install",
            text: "Build the native plugin for your OBS installation. Open the Clipstage dock from the Docks menu.",
          },
          {
            title: "Connect your workspace",
            text: "Create an upload credential below, then paste its connection settings into the dock.",
          },
          {
            title: "Make a moment",
            text: "Add a brief and start/stop a clip recording, or save your replay buffer. Upload happens automatically.",
          },
        ].map((step, i) => (
          <div key={step.title}>
            <span>{(i + 1).toString().padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
        ))}
      </div>
      <div className="panel-card">
        <div className="panel-card-header">
          <div>
            <h2>Connected recording devices</h2>
            <p>
              Upload-only credentials. Private to this workspace. Valid for 90
              days.
            </p>
          </div>
          <KeyRound size={20} className="text-muted-foreground" />
        </div>
        {!owner ? (
          <p className="p-6 text-sm text-muted-foreground">
            Ask your workspace owner to connect OBS or manage recording devices.
          </p>
        ) : (
          <>
            <form
              className="flex flex-wrap items-end gap-3 p-6"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  const result = await post<{
                    apiUrl: string;
                    workspaceId: string;
                    token: string;
                  }>(path, { name });
                  setCredential({
                    apiUrl: result.apiUrl,
                    workspaceId: result.workspaceId,
                    token: result.token,
                  });
                  await mutate();
                } catch (cause) {
                  toast.error(message(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="min-w-48 flex-1">
                <Label htmlFor="device-name">Device name</Label>
                <Input
                  id="device-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={2}
                  maxLength={60}
                  required
                  disabled={demo || busy}
                />
              </div>
              <Button type="submit" disabled={demo || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}Create
                credential
              </Button>
            </form>
            {demo && (
              <p className="px-6 pb-6 text-xs text-muted-foreground">
                Device pairing is disabled in the demo. A running API and
                storage are required.
              </p>
            )}
            {error && (
              <p role="alert" className="px-6 pb-4 text-sm text-red-700">
                Could not load devices.{" "}
                <button className="underline" onClick={() => void mutate()}>
                  Retry
                </button>
              </p>
            )}
            {devices.map((device) => (
              <div
                className="flex items-center gap-3 border-t border-border px-6 py-4"
                key={device.id}
              >
                <Monitor size={18} className="text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{device.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {device.lastSeenAt
                      ? "Has connected"
                      : "Waiting for first upload"}{" "}
                    · Expires{" "}
                    {new Date(device.expiresAt).toISOString().slice(0, 10)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Revoke ${device.name}? Further API upload requests will be rejected.`,
                      )
                    )
                      return;
                    try {
                      await api(`${path}/${device.id}`, { method: "DELETE" });
                      await mutate();
                      toast.success("Device revoked");
                    } catch (cause) {
                      toast.error(message(cause));
                    }
                  }}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </>
        )}
      </div>
      <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Cable size={15} className="mt-0.5 shrink-0" />
        For browser playback, use H.264/AAC MP4 in OBS. MKV and some MOV
        recordings may need to be downloaded and converted. The original
        recording is never deleted.
      </p>
      <Dialog
        open={Boolean(credential)}
        onOpenChange={(open) => {
          if (!open) setCredential(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Your device's backstage pass.</DialogTitle>
          <DialogDescription>
            Copy this configuration into OBS → Clipstage → Paste connection. The
            token is shown only once. Treat it like a password and clear your
            clipboard afterward.
          </DialogDescription>
          <textarea
            aria-label="OBS connection settings"
            readOnly
            value={credential ? JSON.stringify(credential, null, 2) : ""}
            className="my-5 min-h-44 w-full rounded-lg border border-border bg-muted p-3 font-mono text-xs"
            onFocus={(event) => event.target.select()}
          />
          <Button
            className="w-full"
            onClick={() => credential && copy(JSON.stringify(credential))}
          >
            <Copy />
            Copy connection settings
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
