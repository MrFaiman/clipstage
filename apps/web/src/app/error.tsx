"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md space-y-5">
        <Brand />
        <h1 className="text-2xl font-semibold">A small interruption.</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We couldn't load your workspace. Check your connection and make sure
          the API is running, then try again.
        </p>
        <div className="flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/login">Back to sign-in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
