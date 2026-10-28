// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Launches a packaged desktop app against a seeded T3 home, opens a thread, and checks its
// messages render. Release jobs run it so a build whose backend or bundle cannot start fails
// before it is published.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeUtil from "node:util";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { _electron, type ElectronApplication } from "playwright-core";

// A snapshot from an older build on purpose: the packaged server must migrate it forward, as it
// does for every upgrading user. It holds one project and two threads, nothing else.
const FIXTURE_DB = NodePath.join(import.meta.dirname, "fixtures/desktop-launch/statev2.sqlite");
const THREAD_TITLE = "Release launch check";
const THREAD_MESSAGE = "The release opens and shows this thread.";
const STEP_TIMEOUT_MS = 60_000;

const { values } = NodeUtil.parseArgs({
  options: {
    executable: { type: "string" },
    "artifacts-dir": { type: "string" },
  },
});
const executable = values.executable;
if (!executable)
  throw new Error("Usage: smoke-desktop-app.ts --executable <app> [--artifacts-dir <dir>]");
const artifactsDir = NodePath.resolve(values["artifacts-dir"] ?? "desktop-launch-check");

const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-launch-"));
const t3Home = NodePath.join(home, "t3");
NodeFS.mkdirSync(NodePath.join(t3Home, "userdata"), { recursive: true });
NodeFS.copyFileSync(FIXTURE_DB, NodePath.join(t3Home, "userdata/statev2.sqlite"));

let step = "launching the app";
let app: ElectronApplication | undefined;
try {
  app = await _electron.launch({
    executablePath: executable,
    // Linux CI runners do not allow the Chromium sandbox's user namespaces.
    args: ["--no-sandbox"],
    // HOME isolates Electron's profile and instance lock from the installed app.
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: NodePath.join(home, ".config"),
      XDG_DATA_HOME: NodePath.join(home, ".local/share"),
      T3CODE_HOME: t3Home,
      T3CODE_TELEMETRY_ENABLED: "false",
      T3CODE_DISABLE_AUTO_UPDATE: "true",
    },
    timeout: STEP_TIMEOUT_MS,
  });
  // A backend that never starts leaves no window, or only the "could not start" window, so the
  // thread wait below fails either way and its screenshot shows the startup error.
  step = "waiting for the first window";
  const page = await app.firstWindow({ timeout: STEP_TIMEOUT_MS });
  try {
    step = `finding "${THREAD_TITLE}" in the sidebar`;
    const thread = page.locator("li[data-thread-item]", { hasText: THREAD_TITLE });
    await thread.waitFor({ timeout: STEP_TIMEOUT_MS });
    step = "opening the thread";
    await thread.click();
    await page.getByText(THREAD_MESSAGE).waitFor({ timeout: STEP_TIMEOUT_MS });
    const chooseNativeMenuItem = async (labels: string[]) => {
      await app!.evaluate(({ Menu }, labels) => {
        Menu.prototype.popup = function (options) {
          let entries = this.items;
          let selected;
          for (const label of labels) {
            selected = entries.find(
              (item) => item.label === label || item.label.startsWith(`${label} (`),
            );
            if (!selected) throw new Error(`Missing native menu item: ${label}`);
            entries = selected.submenu?.items ?? [];
          }
          selected?.click(selected, options?.window, {});
          options?.callback?.();
        };
      }, labels);
    };
    const waiting = (count: number) =>
      page.getByRole("button", { name: `Waiting ${count}`, exact: true });
    step = "moving a thread through the whole-card native context menu";
    await chooseNativeMenuItem(["Move to section", "Waiting"]);
    await thread.click({ button: "right", position: { x: 1, y: 1 } });
    await waiting(1).waitFor();
    step = "moving a thread through its visible actions button";
    await chooseNativeMenuItem(["Move to section", "Active"]);
    await thread.getByRole("button", { name: "Thread actions", exact: true }).click();
    await waiting(0).waitFor();
    const second = page.locator("li[data-thread-item]", { hasText: "Second thread" });
    let dragNumber = 0;
    const dragThreadTo = async (target: ReturnType<typeof page.locator>, cancel = false) => {
      await second.hover();
      const sourceBounds = await second.boundingBox();
      if (!sourceBounds) throw new Error("Missing drag bounds");
      const x = sourceBounds.x + 70;
      const y = sourceBounds.y + sourceBounds.height - 12;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y, { steps: 3 });
      await target.hover({ trial: true, position: { x: 70, y: 5 } });
      const targetBounds = await target.boundingBox();
      if (!targetBounds) throw new Error("Missing drop bounds");
      await page.mouse.move(targetBounds.x + 70, targetBounds.y + 5, { steps: 12 });
      const hoveredBounds = await target.boundingBox();
      if (!hoveredBounds || Math.abs(hoveredBounds.y - targetBounds.y) > 1)
        throw new Error(
          `Drop target moved away from the pointer during hover: ${targetBounds.y} -> ${hoveredBounds?.y}`,
        );
      NodeFS.mkdirSync(artifactsDir, { recursive: true });
      await page.screenshot({ path: NodePath.join(artifactsDir, `drag-${++dragNumber}.png`) });
      if (cancel) await page.keyboard.press("Escape");
      await page.mouse.up();
    };
    step = "dropping a thread onto an empty category";
    await dragThreadTo(waiting(0));
    await waiting(1).waitFor();
    step = "dropping a categorized thread onto a collapsed category";
    await page.getByRole("button", { name: "New section", exact: true }).click();
    await page.getByRole("textbox", { name: "Section name" }).fill("Review");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const review = (count: number) =>
      page.getByRole("button", { name: `Review ${count}`, exact: true });
    await review(0).click();
    step = "canceling a category drag";
    await dragThreadTo(review(0), true);
    await waiting(1).waitFor();
    await review(0).waitFor();
    step = "dropping a categorized thread onto a collapsed category";
    await dragThreadTo(review(0));
    await review(1).waitFor();
    if ((await review(1).getAttribute("aria-expanded")) !== "true")
      throw new Error("Category did not expand after drop");
    step = "returning a categorized thread to Active";
    await dragThreadTo(page.getByTestId("sidebar-pinned-divider"));
    await review(0).waitFor();
    step = "moving a pinned thread to a category";
    await chooseNativeMenuItem(["Pin thread"]);
    await thread.getByRole("button", { name: "Thread actions", exact: true }).click();
    await thread.getByRole("button", { name: "Unpin thread" }).waitFor();
    await chooseNativeMenuItem(["Move to section", "Waiting"]);
    await thread.getByRole("button", { name: "Thread actions", exact: true }).click();
    await waiting(1).waitFor();
    if ((await thread.getByRole("button", { name: "Unpin thread" }).count()) !== 0)
      throw new Error("Moving to a category left the thread pinned");
    step = "moving a settled and snoozed thread to a category";
    await chooseNativeMenuItem(["Settle thread"]);
    await thread.getByRole("button", { name: "Thread actions", exact: true }).click();
    const settled = page.getByRole("button", { name: /^Settled \d+$/ });
    await settled.waitFor();
    if ((await settled.getAttribute("aria-expanded")) !== "true") await settled.click();
    await thread.getByRole("button", { name: "Un-settle thread", exact: true }).waitFor();
    await chooseNativeMenuItem(["Snooze", "In 1 hour"]);
    await thread.getByRole("button", { name: "Thread actions", exact: true }).click();
    const snoozed = page.getByRole("button", { name: /^Snoozed \d+$/ });
    await snoozed.waitFor();
    if ((await snoozed.getAttribute("aria-expanded")) !== "true") await snoozed.click();
    await thread.getByRole("button", { name: "Wake thread now", exact: true }).waitFor();
    await chooseNativeMenuItem(["Move to section", "Waiting"]);
    await thread.getByRole("button", { name: "Thread actions", exact: true }).click();
    await waiting(1).waitFor();
    await thread.getByRole("button", { name: "Settle thread", exact: true }).waitFor();
    step = "moving multiple selected threads through the native menu";
    const modifier = HostProcess.Platform.defaultValue() === "darwin" ? "Meta" : "Control";
    await thread
      .locator('[role="button"]')
      .first()
      .click({ modifiers: [modifier], position: { x: 70, y: 30 } });
    await second
      .locator('[role="button"]')
      .first()
      .click({ modifiers: [modifier], position: { x: 70, y: 30 } });
    await chooseNativeMenuItem(["Move to section", "Waiting"]);
    await second.getByRole("button", { name: "Thread actions", exact: true }).click();
    await waiting(2).waitFor();
    step = "returning a thread to an empty Active section";
    await dragThreadTo(page.getByTestId("sidebar-pinned-divider"));
    await waiting(1).waitFor();
    step = "checking category persistence";
    await page.reload();
    await waiting(1).waitFor();
    NodeFS.mkdirSync(artifactsDir, { recursive: true });
    await page.screenshot({ path: NodePath.join(artifactsDir, "categories.png") });
  } catch (error) {
    NodeFS.mkdirSync(artifactsDir, { recursive: true });
    await page
      .screenshot({ path: NodePath.join(artifactsDir, "window.png"), timeout: 10_000 })
      .catch(() => {});
    throw error;
  }
  console.log(
    "Desktop launch and category checks passed: menus, drops, persistence and saved conversation display.",
  );
} catch (error) {
  console.error(`Desktop launch check failed while ${step}.`);
  NodeFS.mkdirSync(artifactsDir, { recursive: true });
  console.error(error instanceof Error ? error.message : error);
  const logs = NodePath.join(t3Home, "userdata/logs");
  if (NodeFS.existsSync(logs)) {
    NodeFS.cpSync(logs, NodePath.join(artifactsDir, "logs"), { recursive: true });
    const serverLog = NodePath.join(logs, "server-child.log");
    if (NodeFS.existsSync(serverLog)) {
      console.error("\nLast backend output (server-child.log):");
      console.error(NodeFS.readFileSync(serverLog, "utf8").split("\n").slice(-20).join("\n"));
    }
  }
  process.exitCode = 1;
} finally {
  if (app) {
    // A hung app never finishes closing; kill it so the job does not wait for its timeout.
    // Playwright drops the process handle once the app closes, so read it first.
    const child = app.process();
    const closed = app.close().catch(() => {});
    await Promise.race([closed, NodeTimersPromises.setTimeout(10_000, undefined, { ref: false })]);
    child.kill("SIGKILL");
  }
  NodeFS.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
