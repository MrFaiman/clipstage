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
  await page.getByRole("button", { name: "Account settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Kick", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Not available yet" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: /OBS integration/ }).click();
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
