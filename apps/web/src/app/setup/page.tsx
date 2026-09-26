import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
export default function SetupPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-12 flex items-center justify-between">
        <Brand />
        <Button asChild variant="outline" size="sm">
          <Link href="/">
            <ArrowLeft />
            Back to studio
          </Link>
        </Button>
      </div>
      <span className="eyebrow">OBS INTEGRATION · DEVELOPER PREVIEW</span>
      <h1 className="mb-4 mt-3 text-4xl font-semibold tracking-[-1.5px]">
        One less thing between
        <br />a moment and an edit.
      </h1>
      <p className="mb-10 text-sm leading-7 text-muted-foreground">
        The native Clipstage dock uploads completed recordings and replay-buffer
        captures to your workspace. It is provided as C++ source, not a signed
        installer. Building requires OBS Studio 30+ development libraries, Qt 6,
        CMake 3.28+, and a C++17 compiler.
      </p>
      <div className="space-y-6">
        {[
          {
            title: "1. Start the connected application",
            body: "Configure PostgreSQL, S3-compatible storage, and Kick OAuth using the repository README. Turn demo mode off, sign in, and open OBS integration in your workspace.",
          },
          {
            title: "2. Build the plugin",
            body: "Follow plugins/obs/README.md in the repository for your platform. Build against the same OBS and Qt versions as your OBS installation. Copy the built plugin into OBS's plugin directory and restart OBS.",
          },
          {
            title: "3. Pair your recording device",
            body: "Create an upload credential in the app. In OBS, open Docks → Clipstage, click Paste connection, and paste the copied configuration. Credentials last 90 days and can be revoked in the app. They are not saved to disk by this preview plugin; paste them again after restarting OBS.",
          },
          {
            title: "4. Capture without stopping your stream",
            body: "Use H.264/AAC MP4 in OBS's recording settings for browser playback. Add a clip title and brief in the dock, then start and stop recording using its buttons. The plugin uploads when OBS closes the recording file. Alternatively, start the OBS replay buffer and click Save replay clip.",
          },
          {
            title: "5. Hand it off",
            body: "Your editor's workspace refreshes every five seconds. They can preview or download the original, update the brief, set trim points, and send it for review. Saved trim points are editing decisions, not a rendered export. The streamer gives final approval.",
          },
        ].map((step) => (
          <section key={step.title} className="panel-card p-6">
            <h2 className="mb-3 text-base font-semibold">{step.title}</h2>
            <p className="text-sm leading-7 text-muted-foreground">
              {step.body}
            </p>
          </section>
        ))}
      </div>
      <div className="mt-8 rounded-xl bg-[#edf2e6] p-6 text-sm leading-7 text-[#728360]">
        <strong className="block text-foreground">Keep your originals.</strong>
        Upload failures can be retried while OBS remains open. The source files
        are never deleted. This preview doesn't persist its upload queue across
        restarts, watch recording-file splits, upload in chunks, or render
        finished edits. Full implementation notes and rollout limitations are in{" "}
        <code>docs/architecture.md</code>.
      </div>
    </main>
  );
}
