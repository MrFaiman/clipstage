import { expect, test } from "bun:test";
import { sessionLabel } from "./session-label";

test.each([
  [null, "Unknown device"],
  ["", "Unknown device"],
  ["curl/8.0", "Unknown browser"],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130.0 Safari/537.36",
    "Chrome on macOS",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0",
    "Edge on Windows",
  ],
  [
    "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Safari/537.36",
    "Chrome on Android",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1",
    "Safari on iOS",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/130.0 Safari/604.1",
    "Chrome on iOS",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) FxiOS/130.0 Safari/604.1",
    "Firefox on iOS",
  ],
  ["Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0", "Firefox on Linux"],
  ["Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 OPR/100.0", "Opera on Windows"],
  [
    "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 SamsungBrowser/24.0",
    "Samsung Internet on Android",
  ],
] as const)("labels %p", (ua, expected) => {
  expect(sessionLabel(ua)).toBe(expected);
});
