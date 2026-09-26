import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ClipPage, Member, Viewer } from "@clipstage/contracts";
import { Dashboard } from "@/components/dashboard";
import { demoClips, demoMembers, demoViewer } from "@/lib/demo";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  if (demo)
    return (
      <Dashboard
        key="demo"
        demo
        viewer={demoViewer}
        workspace={demoViewer.workspaces[0]!}
        initialClips={{ items: demoClips, nextCursor: null }}
        initialMembers={demoMembers}
      />
    );
  const cookie = (await cookies()).toString();
  const base =
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000/v1";
  async function load<T>(path: string): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      headers: { Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) redirect("/login");
    if (!response.ok)
      throw new Error(
        "Your workspace could not be loaded. Check that the API is running.",
      );
    return response.json() as Promise<T>;
  }
  const [viewer, query] = await Promise.all([
    load<Viewer>("/auth/me"),
    searchParams,
  ]);
  const workspace =
    viewer.workspaces.find((item) => item.id === query.workspace) ??
    viewer.workspaces[0];
  if (!workspace)
    throw new Error("No workspace is available for this account.");
  const [clips, members] = await Promise.all([
    load<ClipPage>(`/workspaces/${workspace.id}/clips`),
    load<Member[]>(`/workspaces/${workspace.id}/members`),
  ]);
  return (
    <Dashboard
      key={workspace.id}
      demo={false}
      viewer={viewer}
      workspace={workspace}
      initialClips={clips}
      initialMembers={members}
    />
  );
}
