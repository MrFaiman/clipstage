import type { Clip, Member, Viewer } from "@clipstage/contracts";
export const demoMembers: Member[] = [
  { id: "demo-owner", name: "Alex Morgan", avatarUrl: null, role: "OWNER" },
  { id: "demo-editor-1", name: "Jamie Park", avatarUrl: null, role: "EDITOR" },
  { id: "demo-editor-2", name: "Sam Rivera", avatarUrl: null, role: "EDITOR" },
];
export const demoViewer: Viewer = {
  ...demoMembers[0]!,
  connections: [{ id: "demo-kick", provider: "KICK", username: "alexplays" }],
  workspaces: [{ id: "demo-studio", name: "Alex's studio", role: "OWNER" }],
};
const seeds = [
  {
    title: "One HP. A whole lot of confidence.",
    brief:
      "Start right before the last push. Keep the reaction after the clutch — that's the hook. A tight vertical cut for socials, please.",
    status: "INBOX",
    duration: 42,
    assignee: null,
  },
  {
    title: "We probably shouldn't have gone in",
    brief:
      "The slow realization is the funny part. Let that first pause breathe, then jump-cut to the chaos. Keep team comms.",
    status: "EDITING",
    duration: 68,
    assignee: 1,
  },
  {
    title: "Chat made me do it",
    brief:
      "Open with the chat challenge, then cut to my reaction. Add the exact chat message as a caption. Aim for under 30 seconds.",
    status: "IN_REVIEW",
    duration: 36,
    assignee: 2,
  },
  {
    title: "The most peaceful five seconds",
    brief:
      "Cozy vibes until everything goes wrong. Use the quiet moment as a setup and hard-cut on the explosion.",
    status: "INBOX",
    duration: 54,
    assignee: null,
  },
  {
    title: "That wasn't in the tutorial",
    brief:
      "A quick highlight for the weekly roundup. Keep the full jump and landing. No music needed; the game audio is perfect.",
    status: "EDITING",
    duration: 27,
    assignee: 1,
  },
  {
    title: "A very normal end to the stream",
    brief:
      "End on the laugh. This one is ready for the highlight reel after the agreed trim.",
    status: "APPROVED",
    duration: 48,
    assignee: 2,
  },
] as const;
export const demoClips: Clip[] = seeds.map((seed, index) => ({
  id: `demo-clip-${index + 1}`,
  title: seed.title,
  brief: seed.brief,
  status: seed.status,
  provider: "KICK",
  fileName: `stream-highlight-${index + 1}.mp4`,
  mimeType: "video/mp4",
  sizeBytes: (48 + index * 13) * 1024 ** 2,
  durationSeconds: seed.duration,
  trim: null,
  assignee: seed.assignee === null ? null : demoMembers[seed.assignee]!,
  uploadedBy: "Alex Morgan",
  createdAt: `2026-09-26T${(14 - index).toString().padStart(2, "0")}:24:00.000Z`,
  updatedAt: "2026-09-26T14:24:00.000Z",
  version: 0,
}));
