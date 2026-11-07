import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import type { SidebarThreadSummary } from "../../types";
import {
  filterSidebarV2VisibleThreads,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

export const THREAD_BOARD_COLUMNS = [
  { id: "needs-you", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "waiting", title: "Waiting" },
  { id: "done", title: "Done" },
] as const;

export type ThreadBoardColumnId = (typeof THREAD_BOARD_COLUMNS)[number]["id"];

const THREAD_BOARD_DONE_LIMIT = 30;

export interface ThreadBoardCard {
  readonly thread: SidebarThreadSummary;
  readonly pill: ThreadStatusPill | null;
}

export interface ThreadBoard {
  readonly columns: Record<ThreadBoardColumnId, readonly ThreadBoardCard[]>;
  readonly hiddenDone: number;
}

export function resolveThreadBoardColumn(pill: ThreadStatusPill | null): ThreadBoardColumnId {
  switch (pill?.label) {
    case "Pending Approval":
    case "Awaiting Input":
    case "Guest Request":
    case "Plan Ready":
    case "Failed":
      return "needs-you";
    case "Working":
    case "Connecting":
      return "working";
    case "Waiting":
      return "waiting";
    case "Completed":
    case undefined:
      return "done";
  }
}

export function buildThreadBoard(input: {
  readonly threads: readonly SidebarThreadSummary[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly lastVisitedAt: (thread: SidebarThreadSummary) => string | undefined;
  readonly now: string;
}): ThreadBoard {
  const columns: Record<ThreadBoardColumnId, ThreadBoardCard[]> = {
    "needs-you": [],
    working: [],
    waiting: [],
    done: [],
  };
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  for (const thread of visible) {
    if (thread.settledOverride === "settled" || effectiveSnoozed(thread, { now: input.now })) {
      continue;
    }
    const pill = resolveThreadStatusPill({
      thread: { ...thread, lastVisitedAt: input.lastVisitedAt(thread) },
    });
    columns[resolveThreadBoardColumn(pill)].push({ thread, pill });
  }
  for (const cards of Object.values(columns)) {
    cards.sort((a, b) => activityMs(b.thread) - activityMs(a.thread));
  }
  const hiddenDone = Math.max(0, columns.done.length - THREAD_BOARD_DONE_LIMIT);
  columns.done.length -= hiddenDone;
  return { columns, hiddenDone };
}

function activityMs(thread: SidebarThreadSummary): number {
  const timestamp = resolveThreadActivityTimestamp(thread);
  const ms = timestamp === null ? Number.NaN : Date.parse(timestamp);
  return Number.isNaN(ms) ? 0 : ms;
}
