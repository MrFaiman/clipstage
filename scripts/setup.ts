import { randomBytes } from "node:crypto";
const target = Bun.file(".env");
if (await target.exists()) {
  console.log(".env already exists; leaving it unchanged.");
} else {
  const template = await Bun.file(".env.example").text();
  await Bun.write(
    ".env",
    template.replace(
      "change-me-to-64-hex-characters",
      randomBytes(32).toString("hex"),
    ),
  );
  const { chmod } = await import("node:fs/promises");
  await chmod(".env", 0o600);
  console.log(
    "Created .env with a random encryption key. Demo mode is on; add Kick credentials when ready.",
  );
}
