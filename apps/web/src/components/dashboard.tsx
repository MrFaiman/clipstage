"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate as revalidate } from "swr";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Command,
  ExternalLink,
  Film,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  Menu,
  Monitor,
  Plus,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  Clip,
  ClipPage,
  ClipStatus,
  Member,
  Viewer,
  Workspace,
} from "@clipstage/contracts";
import { toast } from "sonner";
import { api, post } from "@/lib/api";
import { cn, initials, message } from "@/lib/utils";
import { useUiStore, type Section } from "@/lib/store";
import { Avatar } from "./avatar";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input, Label } from "./ui/fields";
import { ClipCard } from "./clip-card";
import { StudioOverview } from "./studio-overview";
import {
  TeamPanel,
  SettingsPanel,
  ObsPanel,
  InviteDialog,
} from "./workspace-panels";

const ClipEditor = dynamic(
  () => import("./clip-editor").then((module) => module.ClipEditor),
  { ssr: false },
);
const UploadDialog = dynamic(
  () => import("./upload-dialog").then((module) => module.UploadDialog),
  { ssr: false },
);
const sections: { id: Section; label: string; icon: typeof Film }[] = [
  { id: "library", label: "Clip library", icon: Clapperboard },
  { id: "team", label: "Your team", icon: Users },
  { id: "obs", label: "OBS integration", icon: Monitor },
];
const tabs: { status: ClipStatus | "ALL"; label: string }[] = [
  { status: "ALL", label: "All clips" },
  { status: "INBOX", label: "New clips" },
  { status: "EDITING", label: "In progress" },
  { status: "IN_REVIEW", label: "In review" },
  { status: "APPROVED", label: "Approved" },
];

export function Dashboard({
  viewer,
  workspace: loadedWorkspace,
  initialClips,
  initialMembers,
  demo,
}: {
  viewer: Viewer;
  workspace: Workspace;
  initialClips: ClipPage;
  initialMembers: Member[];
  demo: boolean;
}) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(loadedWorkspace);
  useEffect(() => {
    setWorkspace(loadedWorkspace);
  }, [loadedWorkspace]);
  const section = useUiStore((state) => state.section),
    setSection = useUiStore((state) => state.setSection);
  const query = useUiStore((state) => state.query),
    setQuery = useUiStore((state) => state.setQuery);
  const status = useUiStore((state) => state.status),
    setStatus = useUiStore((state) => state.setStatus);
  const view = useUiStore((state) => state.view),
    setView = useUiStore((state) => state.setView);
  const [demoClips, setDemoClips] = useState(initialClips.items),
    [demoMembers, setDemoMembers] = useState(initialMembers);
  const [selected, setSelected] = useState<string | null>(null),
    [uploadOpen, setUploadOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false);
  const [extraClips, setExtraClips] = useState<Clip[]>([]),
    [extraCursor, setExtraCursor] = useState<string | null | undefined>();
  const [loadingMore, setLoadingMore] = useState(false),
    [creating, setCreating] = useState(false);
  const media = useRef<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const base = `/workspaces/${workspace.id}`;
  const {
    data: page = initialClips,
    mutate,
    error,
  } = useSWR<ClipPage>(demo ? null : `${base}/clips`, api, {
    fallbackData: initialClips,
    revalidateOnMount: true, // Browser request renews the session cookie; SSR cannot.
    refreshInterval: 5000,
    keepPreviousData: true,
  });
  const { data: members = initialMembers, mutate: refreshMembers } = useSWR<
    Member[]
  >(demo ? null : `${base}/members`, api, {
    fallbackData: initialMembers,
    refreshInterval: 15000,
  });
  const team = demo ? demoMembers : members;
  const clips = demo
    ? demoClips
    : [
        ...new Map(
          [...extraClips, ...page.items].map((clip) => [clip.id, clip]),
        ).values(),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cursor = extraCursor === undefined ? page.nextCursor : extraCursor;
  const filtered = clips.filter(
    (clip) =>
      (status === "ALL" || clip.status === status) &&
      `${clip.title} ${clip.brief} ${clip.assignee?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selectedClip = clips.find((clip) => clip.id === selected);
  const activeLabel =
    section === "settings"
      ? "Account settings"
      : sections.find((item) => item.id === section)!.label;
  const owner = workspace.role === "OWNER";
  useEffect(() => {
    const urls = media.current;
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSection("library");
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setSection]);
  function navigate(next: Section) {
    setSection(next);
    setMobileOpen(false);
  }
  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const next = await api<ClipPage>(
        `${base}/clips?cursor=${encodeURIComponent(cursor)}`,
      );
      setExtraClips((previous) => [...previous, ...next.items]);
      setExtraCursor(next.nextCursor);
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setLoadingMore(false);
    }
  }
  function saved(clip: Clip) {
    if (demo)
      setDemoClips((previous) =>
        previous.map((item) => (item.id === clip.id ? clip : item)),
      );
    else {
      setExtraClips((previous) =>
        previous.map((item) => (item.id === clip.id ? clip : item)),
      );
      void mutate();
    }
  }
  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) return;
    const name = String(new FormData(event.currentTarget).get("name"));
    setCreating(true);
    try {
      const created = await post<Workspace>("/workspaces", { name });
      setCreateOpen(false);
      router.push(`/?workspace=${created.id}`);
      router.refresh();
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setCreating(false);
    }
  }
  function applyWorkspace(next: Workspace) {
    setWorkspace((current) => {
      if (
        current.logoUrl?.startsWith("blob:") &&
        current.logoUrl !== next.logoUrl
      )
        URL.revokeObjectURL(current.logoUrl);
      return next;
    });
    if (!demo) router.refresh();
  }
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={cn("sidebar", mobileOpen && "sidebar-open")}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-icon">
            {workspace.logoUrl ? (
              <img src={workspace.logoUrl} alt="" />
            ) : (
              initials(workspace.name).slice(0, 1)
            )}
            <span />
          </div>
          <div className="min-w-0 flex-1">
            <label
              htmlFor="workspace"
              className="mb-0.5 block text-[10px] text-white/40"
            >
              WORKSPACE
            </label>
            <div className="relative">
              <select
                id="workspace"
                aria-label="Current workspace"
                value={workspace.id}
                onChange={(event) => {
                  router.push(`/?workspace=${event.target.value}`);
                  router.refresh();
                }}
                className="w-full appearance-none truncate bg-transparent pr-5 text-[12px] font-semibold text-white outline-offset-4"
              >
                {viewer.workspaces.map((item) => (
                  <option
                    value={item.id}
                    key={item.id}
                    className="bg-[#232626]"
                  >
                    {item.id === workspace.id ? workspace.name : item.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-0 top-1 text-white/40"
                size={12}
              />
            </div>
          </div>
        </div>
        <p className="nav-label">THE STUDIO</p>
        <nav aria-label="Main navigation" className="sidebar-nav">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={cn("nav-item", section === id && "nav-item-active")}
              onClick={() => navigate(id)}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{label}</span>
              {id === "library" && (
                <span className="nav-count">{clips.length}</span>
              )}
              {id === "obs" && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="capture-prompt">
            <div className="flex items-center justify-between">
              <span className="capture-icon">
                <Radio size={17} />
              </span>
              <span className="text-[9px] font-semibold tracking-[1.1px] text-white/40">
                LESS BUSYWORK
              </span>
            </div>
            <h3>Your stream. On repeat.</h3>
            <p>Send moments from OBS straight to your editing team.</p>
            <button onClick={() => navigate("obs")}>
              Set up OBS <ArrowUpRightIcon />
            </button>
          </div>
          <button className="sidebar-help" onClick={() => navigate("obs")}>
            <CircleHelp size={16} /> Getting started{" "}
            <ExternalLink size={12} className="ml-auto" />
          </button>
          <div
            className={cn(
              "sidebar-profile",
              section === "settings" && "sidebar-profile-active",
            )}
          >
            <button
              className="sidebar-account"
              onClick={() => navigate("settings")}
              aria-current={section === "settings" ? "page" : undefined}
            >
              <Avatar
                name={viewer.name}
                avatarUrl={viewer.avatarUrl}
                className="size-8 ring-0"
              />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs font-semibold text-white/90">
                  {viewer.name}
                </span>
                <span className="mt-1 block text-[10px] text-white/40">
                  Account settings
                </span>
              </span>
              <Settings size={15} className="shrink-0 text-white/45" />
            </button>
            {!demo && (
              <button
                aria-label="Sign out"
                className="p-1 text-white/50 hover:text-white"
                onClick={async () => {
                  try {
                    await post("/auth/logout");
                    window.location.assign("/login");
                  } catch (cause) {
                    toast.error(message(cause));
                  }
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Workspace
            </span>
            <ChevronRight
              size={13}
              className="hidden text-muted-foreground/50 sm:block"
            />
            <span className="text-xs font-medium">{activeLabel}</span>
          </div>
          <div className="flex items-center gap-5">
            <span className={cn("sync-indicator", error && "text-amber-700")}>
              <span className={cn(error && "!bg-amber-500")} />
              {demo
                ? "Demo workspace"
                : error
                  ? "Reconnecting…"
                  : "Auto-sync on"}
            </span>
            <span className="topbar-divider" />
            <div className="flex -space-x-2">
              {team.slice(0, 3).map((member) => (
                <Avatar
                  key={member.id}
                  name={member.name}
                  avatarUrl={member.avatarUrl}
                  className="size-7 text-[9px]"
                />
              ))}
            </div>
            {owner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInviteOpen(true)}
              >
                <Plus /> <span className="hidden sm:inline">Invite editor</span>
              </Button>
            )}
          </div>
        </header>
        <main id="main-content" className="workspace-main">
          {demo && (
            <div className="demo-banner">
              <Sparkles size={13} />
              <span>You're exploring the demo. Changes stay in this tab.</span>
              <Link href="/login">
                Make it yours <ArrowRight size={12} />
              </Link>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              Live updates are paused. Your last loaded clips are still here.{" "}
              <button onClick={() => void mutate()} className="underline">
                Retry connection
              </button>
            </div>
          )}
          {section === "library" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    YOUR WORKSPACE / YOUR NEXT GREAT EDIT
                  </div>
                  <h1>
                    Your best moments, <span>all here.</span>
                  </h1>
                  <p>The footage, the brief, the team. One creative home.</p>
                </div>
                <Button variant="dark" onClick={() => setUploadOpen(true)}>
                  <Upload size={15} /> Upload clip
                </Button>
              </div>
              <StudioOverview
                clips={clips}
                status={status}
                onStatus={setStatus}
                onConnect={() => navigate("obs")}
              />
              <div className="library-heading">
                <div className="flex items-center gap-3">
                  <h2>Clip library</h2>
                  <span className="count-pill">{clips.length}</span>
                </div>
                <span className="library-note">
                  <span />{" "}
                  {demo ? "Sample captures" : "Refreshes every 5 seconds"}
                </span>
              </div>
              <div className="library-toolbar">
                <div
                  className="status-tabs"
                  role="group"
                  aria-label="Filter clips by status"
                >
                  {tabs.map((tab) => {
                    const count =
                      tab.status === "ALL"
                        ? clips.length
                        : clips.filter((clip) => clip.status === tab.status)
                            .length;
                    return (
                      <button
                        key={tab.status}
                        onClick={() => setStatus(tab.status)}
                        aria-pressed={status === tab.status}
                        className={cn(status === tab.status && "active")}
                      >
                        {tab.label}
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div
                  className="view-switch"
                  role="group"
                  aria-label="Clip view"
                >
                  <button
                    aria-label="Grid view"
                    aria-pressed={view === "grid"}
                    onClick={() => setView("grid")}
                    className={cn(view === "grid" && "active")}
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    aria-label="List view"
                    aria-pressed={view === "list"}
                    onClick={() => setView("list")}
                    className={cn(view === "list" && "active")}
                  >
                    <List size={17} />
                  </button>
                </div>
              </div>
              <div className="library-search-row">
                <div className="clip-search">
                  <Search size={15} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search loaded clips"
                    placeholder="Search clips, briefs, or editors…"
                  />
                  {query ? (
                    <button
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <kbd>
                      <Command size={10} /> K
                    </kbd>
                  )}
                </div>
                <span className="sort-label">
                  <SlidersHorizontal size={13} /> Newest first
                </span>
              </div>
              {filtered.length ? (
                <div
                  className={cn("clips-grid", view === "list" && "clips-list")}
                >
                  {filtered.map((clip, index) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      demo={demo}
                      index={index}
                      view={view}
                      onOpen={() => setSelected(clip.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Film size={32} strokeWidth={1.25} />
                  <h3>
                    {clips.length
                      ? "No moments match just yet."
                      : "Your next great clip starts here."}
                  </h3>
                  <p>
                    {clips.length
                      ? "Try another search or filter to find your clip."
                      : "Upload a clip or connect OBS to get your team rolling."}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (clips.length) {
                        setQuery("");
                        setStatus("ALL");
                      } else setUploadOpen(true);
                    }}
                  >
                    {clips.length ? "Clear filters" : "Upload your first clip"}
                  </Button>
                </div>
              )}
              <div className="library-footer">
                <span>
                  {filtered.length} of {clips.length} loaded clips
                  {cursor
                    ? " · Search covers loaded clips"
                    : " · All caught up"}
                </span>
                {cursor ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {loadingMore && <Loader2 className="animate-spin" />}Load
                    older clips
                  </Button>
                ) : (
                  <span>
                    <Check size={12} /> A little less work. A lot more creating.
                  </span>
                )}
              </div>
            </>
          ) : section === "team" ? (
            <TeamPanel
              members={team}
              workspace={workspace}
              owner={owner}
              demo={demo}
              onUpdated={applyWorkspace}
              onInvite={() => setInviteOpen(true)}
              onCreate={() => setCreateOpen(true)}
              onRemove={async (id) => {
                if (demo)
                  setDemoMembers((previous) =>
                    previous.filter((member) => member.id !== id),
                  );
                else {
                  await api(`${base}/members/${id}`, { method: "DELETE" });
                  await refreshMembers();
                }
              }}
            />
          ) : section === "settings" ? (
            <SettingsPanel viewer={viewer} demo={demo} />
          ) : (
            <ObsPanel workspace={workspace} demo={demo} />
          )}
        </main>
        <footer className="app-footer">
          <Brand compact />
          <span>A home for your best moments.</span>
          <span className="ml-auto">Clipstage · Early access</span>
        </footer>
      </div>
      {selectedClip && (
        <ClipEditor
          key={selectedClip.id}
          clip={selectedClip}
          workspace={workspace}
          members={team}
          demo={demo}
          demoUrl={media.current[selectedClip.id]}
          onClose={() => setSelected(null)}
          onSaved={saved}
        />
      )}
      {uploadOpen && (
        <UploadDialog
          workspace={workspace}
          viewer={viewer}
          demo={demo}
          onClose={() => setUploadOpen(false)}
          onUploaded={(clip, url) => {
            if (demo) {
              setDemoClips((previous) => [clip, ...previous]);
              if (url) media.current[clip.id] = url;
            } else void mutate();
            setStatus("ALL");
            setQuery("");
          }}
        />
      )}
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspace={workspace}
        demo={demo}
        onInvited={() => {
          void refreshMembers();
          void revalidate(`/workspaces/${workspace.id}/invitations`);
        }}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogTitle>A fresh space to create.</DialogTitle>
          <DialogDescription>
            Each workspace has its own clips, editors, and OBS credentials.
          </DialogDescription>
          <form onSubmit={createWorkspace} className="mt-6 space-y-5">
            <div>
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                name="name"
                placeholder="The highlight factory"
                minLength={2}
                maxLength={60}
                required
                disabled={creating}
              />
            </div>
            {demo && (
              <p className="text-sm text-muted-foreground">
                Workspace creation needs a live API and a signed-in account.
                This preview uses sample data.
              </p>
            )}
            <Button
              type="submit"
              disabled={demo || creating}
              className="w-full"
            >
              {creating && <Loader2 className="animate-spin" />}Create workspace
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowDownToLine size={13} className="-rotate-90" />;
}
