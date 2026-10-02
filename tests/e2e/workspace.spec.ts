import { expect, test } from "@playwright/test";

test("library filters, search, views, and non-destructive editing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your best moments, all here." }),
  ).toBeVisible();
  await expect(page.locator(".clip-card")).toHaveCount(6);
  if (process.env.CAPTURE_SCREENSHOTS)
    await page.screenshot({
      path: "/tmp/clipstage-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
  await page.getByRole("button", { name: /^In review/ }).click();
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await page.getByRole("button", { name: /^All clips/ }).click();
  await page
    .getByRole("textbox", { name: "Search loaded clips" })
    .fill("confidence");
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.locator(".clips-list")).toBeVisible();
  await page
    .getByRole("button", { name: "Open One HP. A whole lot of confidence." })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("vf-editor")).toBeVisible();
  await page.locator("vf-titlebar-name input").fill("Saved timeline project");
  await page
    .getByLabel("The streamer's brief")
    .fill("Start at the clutch. Keep the reaction.");
  await page.getByLabel("Workflow status").selectOption("EDITING");
  await page.getByLabel("Assigned editor").selectOption("demo-editor-1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Open One HP. A whole lot of confidence." })
    .click();
  await expect(page.getByLabel("The streamer's brief")).toHaveValue(
    "Start at the clutch. Keep the reaction.",
  );
  await expect(page.getByLabel("Workflow status")).toHaveValue("EDITING");
  await expect(page.getByLabel("Assigned editor")).toHaveValue("demo-editor-1");
  await expect(page.locator("vf-editor")).toBeVisible();
  await expect(page.locator("vf-titlebar-name input")).toHaveValue(
    "Saved timeline project",
  );
  expect(errors).toEqual([]);
});

test("production stages filter real loaded clip counts", async ({ page }) => {
  await page.goto("/");
  const stages = page.getByRole("group", { name: "Production stages" });
  await expect(stages.getByRole("button")).toHaveCount(4);
  await expect(
    page.getByText("Counts reflect loaded clips, not the entire workspace."),
  ).toBeVisible();
  const review = stages.getByRole("button", { name: /03 \/ In review/ });
  await review.click();
  await expect(review).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await page.getByRole("button", { name: /^All clips/ }).click();
  await expect(review).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".clip-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Connect OBS", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create credential" }),
  ).toBeDisabled();
});

test("studio layout stays within small and medium viewports", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".pipeline-stage")).toHaveCount(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("a manual demo upload stays local and can be previewed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Upload clip", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("apps/web/public/demo-reel.mp4");
  await page.getByLabel("Give it a name").fill("My local recording");
  await page
    .getByLabel("The brief", { exact: false })
    .fill("A local sample upload for the team.");
  await page.getByRole("button", { name: "Add to demo workspace" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".clip-card")).toHaveCount(7);
  await page.getByRole("button", { name: "Open My local recording" }).click();
  await expect(page.locator("vf-editor")).toBeVisible();
});

test("team and integration panels are honest about demo and upcoming providers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Your team" }).click();
  await expect(page.getByRole("heading", { name: "Jamie Park" })).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Invite editor" })
    .click();
  await expect(
    page.getByText("Invitations aren't sent from the demo.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Workspace name").fill("Morgan studio");
  await page.getByLabel("Workspace logo").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Save workspace" }).click();
  await expect(page.locator("#workspace")).toContainText("Morgan studio");
  await expect(page.locator(".sidebar .workspace-icon img")).toBeVisible();
  await page.getByRole("button", { name: "Account settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Kick", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("One connection per platform: Kick, Twitch, and YouTube."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^(Connect|Reconnect) Kick$/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Connect another Kick account")).toHaveCount(0);
  const sessions = page.getByRole("region", { name: "Active sessions" });
  await expect(
    sessions.getByRole("heading", { name: "Chrome on macOS" }),
  ).toBeVisible();
  await expect(
    sessions.getByText("Current session", { exact: true }),
  ).toBeVisible();
  await expect(
    sessions.getByRole("button", { name: "Revoke Safari on iOS" }),
  ).toBeDisabled();
  await expect(
    sessions.getByRole("button", { name: "Sign out of all other sessions" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Not available yet" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: /OBS integration/ }).click();
  await expect(
    page.getByRole("heading", { name: "Stop recording. Start collaborating." }),
  ).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator(".obs-intro .eyebrow")).toHaveCSS(
    "color",
    "rgb(225, 214, 255)",
  );
  await expect(
    page.getByRole("button", { name: "Create credential" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Prebuilt installers and automatic updates are not available yet.",
      { exact: false },
    ),
  ).toBeVisible();
});

test("mobile navigation and layout work without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "From live moment to final cut." }),
  ).toBeVisible();
  await expect(page.locator(".clip-card")).toHaveCount(6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (process.env.CAPTURE_SCREENSHOTS)
    await page.screenshot({
      path: "/tmp/clipstage-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Your team" }).click();
  await expect(
    page.getByRole("heading", { name: "Your behind-the-scenes dream team." }),
  ).toBeVisible();
  await expect(page.locator(".sidebar-open")).toHaveCount(0);
});
