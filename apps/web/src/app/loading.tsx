export default function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center" role="status">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none" />
        Opening your studio…
      </div>
    </main>
  );
}
