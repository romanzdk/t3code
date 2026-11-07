import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadStatusPill } from "../Sidebar.logic";
import { resolveThreadBoardColumn, type ThreadBoardColumnId } from "./threadBoard.logic";

const idleThread = {
  hasActionableProposedPlan: false,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  interactionMode: "default" as const,
  latestRun: null,
  lastVisitedAt: undefined,
  runtime: null,
};

const runningRuntime = {
  status: "running" as const,
  providerName: "Codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  activeRunId: "turn-1" as never,
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
};

const completedRun = {
  runId: "turn-1" as never,
  status: "completed" as const,
  assistantMessageId: null,
  requestedAt: "2026-03-09T10:00:00.000Z",
  startedAt: "2026-03-09T10:00:01.000Z",
  completedAt: "2026-03-09T10:00:10.000Z",
  stopRequested: false,
};

describe("resolveThreadBoardColumn", () => {
  const cases: ReadonlyArray<readonly [string, object, ThreadBoardColumnId]> = [
    ["a pending approval", { hasPendingApprovals: true }, "needs-you"],
    ["a pending question", { hasPendingUserInput: true }, "needs-you"],
    ["a guest request", { pendingGuestMessageCount: 1 }, "needs-you"],
    [
      "a plan ready for review",
      {
        interactionMode: "plan",
        hasActionableProposedPlan: true,
        latestRun: completedRun,
        runtime: { ...runningRuntime, status: "completed", activeRunId: null },
      },
      "needs-you",
    ],
    ["a running turn", { runtime: runningRuntime }, "working"],
    [
      "a thread blocked on another thread",
      { runtime: runningRuntime, blockedOnThreadWait: true },
      "waiting",
    ],
    ["an unseen completion", { latestRun: completedRun }, "done"],
    ["a thread with nothing to report", {}, "done"],
  ];

  it.each(cases)("puts %s in its column", (_name, overrides, column) => {
    const pill = resolveThreadStatusPill({ thread: { ...idleThread, ...overrides } });
    expect(resolveThreadBoardColumn(pill)).toBe(column);
  });
});
