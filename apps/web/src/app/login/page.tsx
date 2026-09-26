import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { Brand, KickMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";
export default function Login() {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  return (
    <main className="login-page">
      <div className="login-story">
        <Brand />
        <div>
          <span className="eyebrow text-primary">FROM LIVE TO NEXT-LEVEL</span>
          <h1>
            You make
            <br />
            the moment.
            <br />
            <span className="text-primary">Make it last.</span>
          </h1>
          <p>
            Your best moments shouldn't get lost in a VOD. Give your editing
            team a front-row seat.
          </p>
        </div>
        <p className="text-xs text-white/40">
          Built for streamers. Made for the whole team.
        </p>
      </div>
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <span className="mb-6 inline-flex rounded-xl bg-primary/20 p-3">
            <KickMark className="size-7" />
          </span>
          <h2 className="text-3xl font-semibold tracking-tight">
            Welcome to your studio.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in with Kick to create a workspace or join your streamer's
            team.
          </p>
          <Button asChild size="lg" className="mt-8 w-full">
            <a href={`${API_URL}/auth/kick`}>
              <KickMark /> Continue with Kick{" "}
              <ArrowUpRight className="ml-auto" />
            </a>
          </Button>
          <ul className="my-8 space-y-4 text-sm text-muted-foreground">
            {[
              "Clips arrive straight from OBS",
              "Your briefs, right beside the footage",
              "One workspace for your whole team",
            ].map((text) => (
              <li key={text} className="flex gap-3">
                <Check size={16} className="text-foreground" />
                {text}
              </li>
            ))}
          </ul>
          <p className="border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            We only request access to your basic Kick profile. We never ask for
            your stream key. Twitch and YouTube connections are coming later.
          </p>
          {demo && (
            <Link
              href="/"
              className="mt-6 block text-center text-sm font-medium underline underline-offset-4"
            >
              Explore the interactive demo
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
