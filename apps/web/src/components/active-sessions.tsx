"use client";
import { useState } from "react";
import useSWR from "swr";
import { Loader2, Monitor, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { ActiveSession } from "@clipstage/contracts";
import { api, post } from "@/lib/api";
import { demoSessions } from "@/lib/demo";
import { sessionLabel } from "@/lib/session-label";
import { message } from "@/lib/utils";
import { Button } from "./ui/button";

const date = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
export function ActiveSessions({ demo }: { demo: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<ActiveSession[]>(
    demo ? null : "/auth/sessions",
    api,
    {
      refreshInterval: 60000,
    },
  );
  const sessions = demo ? demoSessions : data;
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  async function revoke(session: ActiveSession) {
    if (demo || busy) return;
    if (
      !window.confirm(
        session.current
          ? "Sign out of this session?"
          : `Revoke ${sessionLabel(session.userAgent)}? That browser will need to sign in again.`,
      )
    )
      return;
    setBusy(session.id);
    setFailure(null);
    try {
      await api(`/auth/sessions/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
      });
      if (session.current) {
        window.location.assign("/login");
        return;
      }
      await mutate();
      toast.success("Session revoked.");
    } catch (cause) {
      setFailure(message(cause));
    } finally {
      setBusy(null);
    }
  }
  async function revokeOthers() {
    if (
      demo ||
      busy ||
      !window.confirm(
        "Sign out of all other sessions? This session and OBS device credentials will stay connected.",
      )
    )
      return;
    setBusy("others");
    setFailure(null);
    try {
      await post("/auth/sessions/revoke-others");
      await mutate();
      toast.success("Other sessions signed out.");
    } catch (cause) {
      setFailure(message(cause));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="mt-8" aria-labelledby="active-sessions-heading">
      <div className="settings-kicker">
        <h2 id="active-sessions-heading">Active sessions</h2>
        <p>
          Manage where you're signed in. OBS devices are managed separately in
          OBS integration.
        </p>
      </div>
      <div className="panel-card">
        {demo && (
          <p className="border-b border-border p-5 text-sm text-muted-foreground">
            Sample sessions only. Sign-out controls are disabled in demo mode.
          </p>
        )}
        {isLoading && !demo && (
          <p role="status" className="flex items-center gap-2 p-5 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
            Loading sessions…
          </p>
        )}
        {error && (
          <div role="alert" className="p-5 text-sm">
            <p>Couldn't load your active sessions.</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void mutate()}
            >
              Retry
            </Button>
          </div>
        )}
        {failure && (
          <p role="alert" className="px-5 pt-5 text-sm text-red-700">
            {failure}
          </p>
        )}
        <ul className="divide-y divide-border">
          {sessions?.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-4 p-5"
            >
              <Monitor
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 basis-44">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    {sessionLabel(session.userAgent)}
                  </h3>
                  {session.current && (
                    <span className="status-badge status-approved">
                      <ShieldCheck size={12} aria-hidden="true" />
                      Current session
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Last active:{" "}
                  <time dateTime={session.lastUsedAt}>
                    {date.format(new Date(session.lastUsedAt))} UTC
                  </time>
                </p>
              </div>
              <Button
                variant="outline"
                disabled={demo || busy !== null}
                aria-label={`${session.current ? "Sign out" : "Revoke"} ${sessionLabel(session.userAgent)}`}
                onClick={() => void revoke(session)}
              >
                {busy === session.id && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                {session.current ? "Sign out" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
        {sessions?.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">
            No active sessions found.
          </p>
        )}
        <div className="border-t border-border p-5">
          <p className="mb-4 text-xs leading-5 text-muted-foreground">
            Device names are inferred from browser information. Last activity is
            recorded at most once per day. Sessions end after 30 days idle or 90
            days from sign-in.
          </p>
          <Button
            variant="outline"
            disabled={
              demo ||
              busy !== null ||
              !sessions?.some((session) => !session.current)
            }
            onClick={() => void revokeOthers()}
          >
            {busy === "others" && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            Sign out of all other sessions
          </Button>
        </div>
      </div>
    </section>
  );
}
