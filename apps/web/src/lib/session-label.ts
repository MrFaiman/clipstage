/** A best-effort display label, not verified device identity. Never render raw UA markup. */
export function sessionLabel(userAgent: string | null): string {
  if (!userAgent?.trim()) return "Unknown device";
  const ua = userAgent.slice(0, 256);
  const browser = /Edg(?:e|A|iOS)?\//i.test(ua)
    ? "Edge"
    : /(?:OPR|Opera)\//i.test(ua)
      ? "Opera"
      : /SamsungBrowser\//i.test(ua)
        ? "Samsung Internet"
        : /(?:Firefox|FxiOS)\//i.test(ua)
          ? "Firefox"
          : /(?:Chrome|CriOS)\//i.test(ua)
            ? "Chrome"
            : /Safari\//i.test(ua) && /Version\//i.test(ua)
              ? "Safari"
              : "Unknown browser";
  const os = /(?:iPhone|iPad|iPod)/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
      ? "Android"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS X/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}
