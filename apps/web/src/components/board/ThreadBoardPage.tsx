import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useUiStateStore } from "../../uiStateStore";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SidebarInset } from "../ui/sidebar";
import {
  buildThreadBoard,
  THREAD_BOARD_COLUMNS,
  type ThreadBoardCard,
  type ThreadBoardColumnId,
} from "./threadBoard.logic";

const COLUMN_DESCRIPTION: Record<ThreadBoardColumnId, string> = {
  "needs-you": "Approval, input, a plan to review, or a failure",
  working: "An agent is running",
  waiting: "Blocked on another thread or a background task",
  done: "Finished, nothing waiting",
};

export function ThreadBoardPage() {
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const projects = useProjects();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const nowMinute = useNowMinute();
  const now = `${nowMinute}:00.000Z`;

  const board = buildThreadBoard({
    threads,
    delegatedUnderParent,
    now,
    lastVisitedAt: (thread) =>
      resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        lastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
  });
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
  );

  return (
    <SidebarInset
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
      {...workspaceAreaProps("thread-board", 1, "Board")}
    >
      <WorkspacePageHeader electron={isElectron} className="relative bg-background">
        <WorkspaceBreadcrumb ariaLabel="Board breadcrumb">
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">Board</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5 pt-2 sm:px-6">
        {THREAD_BOARD_COLUMNS.map((column) => {
          const cards = board.columns[column.id];
          return (
            <section
              key={column.id}
              aria-label={column.title}
              className="flex min-h-0 min-w-60 flex-1 basis-0 flex-col rounded-lg border border-border bg-muted/30"
            >
              <header className="flex flex-col gap-0.5 px-3 pb-2 pt-3">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  {column.title}
                  <span className="text-xs font-normal text-muted-foreground">{cards.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">{COLUMN_DESCRIPTION[column.id]}</p>
              </header>
              <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cards.map((card) => (
                  <li
                    key={scopedThreadKey(scopeThreadRef(card.thread.environmentId, card.thread.id))}
                  >
                    <BoardCard
                      card={card}
                      projectTitle={
                        projectTitles.get(
                          `${card.thread.environmentId}:${card.thread.projectId}`,
                        ) ?? null
                      }
                      nowMinute={nowMinute}
                    />
                  </li>
                ))}
                {column.id === "done" && board.hiddenDone > 0 ? (
                  <li className="px-1 py-1 text-xs text-muted-foreground">
                    {board.hiddenDone} older not shown
                  </li>
                ) : null}
                {cards.length === 0 ? (
                  <li className="px-1 py-1 text-xs text-muted-foreground">No threads</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </SidebarInset>
  );
}

function compactTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

const BoardCard = memo(function BoardCard(props: {
  card: ThreadBoardCard;
  projectTitle: string | null;
  nowMinute: string;
}) {
  const { thread, pill } = props.card;
  const navigate = useNavigate();
  const timestamp = resolveThreadActivityTimestamp(thread);
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
        })
      }
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-left",
        "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      <span className="line-clamp-2 text-sm">{thread.title}</span>
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{props.projectTitle ?? "Unknown project"}</span>
        <span className="flex shrink-0 items-center gap-2">
          {pill ? <ThreadStatusLabel status={pill} /> : null}
          {timestamp ? (
            <span>
              {compactTimeLabel(
                formatRelativeTimeLabel(timestamp, Date.parse(`${props.nowMinute}:00.000Z`)),
              )}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
});
