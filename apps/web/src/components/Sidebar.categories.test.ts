import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveAdjacentThreadId,
  searchSidebarThreads,
  sidebarMarkerId,
  type SidebarListItem,
} from "./Sidebar.logic";
import {
  assignSidebarCategory,
  resolveSidebarCategoryDrop,
  sidebarCategoryMoveActions,
  deleteSidebarCategory,
  groupSidebarCategoryThreads,
  sidebarCategoryNameError,
  SidebarCategoriesSchema,
  DEFAULT_SIDEBAR_CATEGORIES,
} from "./Sidebar.categories";

const decodeCategories = Schema.decodeUnknownSync(SidebarCategoriesSchema);

const key = (environment: string) =>
  scopedThreadKey(scopeThreadRef(EnvironmentId.make(environment), ThreadId.make("same-thread")));
const waiting = DEFAULT_SIDEBAR_CATEGORIES.categories[0]!;
const initial = {
  categories: [waiting, { id: "review", name: "Review", collapsed: false }],
  assignments: {},
};

describe("device-local sidebar categories", () => {
  it("moves a scoped thread to exactly one section without changing another environment", () => {
    const assigned = assignSidebarCategory(initial, [key("local"), key("remote")], waiting.id);
    const moved = assignSidebarCategory(assigned, [key("local")], "review");
    expect(moved.assignments).toEqual({ [key("local")]: "review", [key("remote")]: waiting.id });
    expect(assignSidebarCategory(moved, [key("local")], null).assignments).toEqual({
      [key("remote")]: waiting.id,
    });
    expect(assignSidebarCategory(moved, [key("local")], "missing")).toEqual(moved);
  });

  it("deletes only the category and its assignments, including disconnected members", () => {
    const assigned = assignSidebarCategory(
      initial,
      [key("local"), key("disconnected")],
      waiting.id,
    );
    const other = assignSidebarCategory(assigned, [key("remote")], "review");
    expect(deleteSidebarCategory(other, waiting.id)).toEqual({
      categories: [initial.categories[1]],
      assignments: { [key("remote")]: "review" },
    });
  });

  it("round-trips names, collapse and disconnected assignments and rejects malformed storage", () => {
    const state = assignSidebarCategory(
      { ...initial, categories: [{ ...waiting, name: "Later", collapsed: true }] },
      [key("disconnected")],
      waiting.id,
    );
    const codec = Schema.fromJsonString(SidebarCategoriesSchema);
    expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(state))).toEqual(state);
    for (const malformed of [
      { categories: "Waiting", assignments: {} },
      { categories: [{ ...waiting, collapsed: "yes" }], assignments: {} },
      { categories: [{ ...waiting, name: " " }], assignments: {} },
      { categories: [waiting, waiting], assignments: {} },
      { categories: [waiting, { ...waiting, id: "other", name: "waiting" }], assignments: {} },
      { categories: [waiting], assignments: { [key("local")]: "missing" } },
    ])
      expect(() => decodeCategories(malformed)).toThrow();
  });

  it("rejects empty, duplicate and reserved names while allowing a category's current name", () => {
    expect(sidebarCategoryNameError(initial.categories, "  ")).toBeTruthy();
    expect(sidebarCategoryNameError(initial.categories, " waiting ")).toBeTruthy();
    expect(sidebarCategoryNameError(initial.categories, "Active")).toBeTruthy();
    expect(sidebarCategoryNameError(initial.categories, "Waiting", waiting.id)).toBeNull();
    expect(sidebarCategoryNameError(initial.categories, "New work")).toBeNull();
  });

  it("groups only supplied main rows in category order and keeps collapsed rows searchable", () => {
    const state = assignSidebarCategory(
      { ...initial, categories: [{ ...waiting, collapsed: true }, initial.categories[1]!] },
      [key("local"), key("disconnected")],
      waiting.id,
    );
    const threads = [{ key: key("remote") }, { key: key("local") }];
    const groups = groupSidebarCategoryThreads(threads, state, (thread) => thread.key, null);
    expect(groups.map((group) => group.threads)).toEqual([[threads[1]], []]);
    expect(groups.flatMap((group) => group.visibleThreads)).toEqual([]);
    expect(
      groupSidebarCategoryThreads(threads, state, (thread) => thread.key, key("local"))[0]!
        .visibleThreads,
    ).toEqual([threads[1]]);
    expect(state.assignments[key("disconnected")]).toBe(waiting.id);
  });

  it("uses category order for traversal and searches collapsed members", () => {
    const state = assignSidebarCategory(
      assignSidebarCategory(initial, [key("local")], waiting.id),
      [key("remote")],
      "review",
    );
    const threads = ["remote", "local"].map((environment) => ({
      environmentId: EnvironmentId.make(environment),
      id: ThreadId.make("same-thread"),
      title: "Fix sidebar",
      branch: null,
      opens: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      latestUserMessageAt: null,
    }));
    const threadKey = (thread: (typeof threads)[number]) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const groups = groupSidebarCategoryThreads(threads, state, threadKey, null);
    const visibleKeys = groups.flatMap((group) => group.visibleThreads.map(threadKey));
    expect(visibleKeys).toEqual([key("local"), key("remote")]);
    expect(
      resolveAdjacentThreadId({
        threadIds: visibleKeys,
        currentThreadId: key("local"),
        direction: "next",
      }),
    ).toBe(key("remote"));
    const collapsed = groupSidebarCategoryThreads(
      threads,
      {
        ...state,
        categories: state.categories.map((category) => ({ ...category, collapsed: true })),
      },
      threadKey,
      null,
    );
    expect(collapsed.flatMap((group) => group.visibleThreads)).toEqual([]);
    expect(
      searchSidebarThreads(
        collapsed.flatMap((group) => group.threads),
        "sidebar",
      ).titleMatches,
    ).toHaveLength(2);
  });
});

describe("category drag destinations", () => {
  const items: readonly SidebarListItem[] = [
    { kind: "marker", marker: "pinned-header" },
    { kind: "thread", key: "pinned", section: "pinned" },
    { kind: "marker", marker: "pinned-divider" },
    { kind: "thread", key: "active", section: "active" },
    { kind: "marker", marker: "custom-header:waiting" },
    { kind: "thread", key: "waiting-thread", section: "custom" },
    { kind: "marker", marker: "custom-header:empty" },
    { kind: "marker", marker: "custom-create" },
    { kind: "marker", marker: "settled-header" },
    { kind: "thread", key: "settled", section: "settled" },
  ];

  it("accepts empty/collapsed category headers and category members", () => {
    expect(
      resolveSidebarCategoryDrop(items, "active", sidebarMarkerId("custom-header:empty")),
    ).toEqual({ categoryId: "empty" });
    expect(resolveSidebarCategoryDrop(items, "active", "waiting-thread")).toEqual({
      categoryId: "waiting",
    });
    expect(
      resolveSidebarCategoryDrop(items, "waiting-thread", sidebarMarkerId("custom-header:empty")),
    ).toEqual({ categoryId: "empty" });
    expect(
      resolveSidebarCategoryDrop(items, "pinned", sidebarMarkerId("custom-header:empty")),
    ).toEqual({ categoryId: "empty" });
  });

  it("lets categorized threads return to Active, including an empty Active section", () => {
    expect(resolveSidebarCategoryDrop(items, "waiting-thread", "active")).toEqual({
      categoryId: null,
    });
    expect(
      resolveSidebarCategoryDrop(
        [...items.slice(0, 3), { kind: "marker", marker: "active-placeholder" }, ...items.slice(4)],
        "waiting-thread",
        sidebarMarkerId("active-placeholder"),
      ),
    ).toEqual({ categoryId: null });
  });

  it("leaves standard shelves, create controls, self drops and unknown items alone", () => {
    for (const target of ["pinned", "settled", "unknown", sidebarMarkerId("custom-create")])
      expect(resolveSidebarCategoryDrop(items, "active", target)).toBeNull();
    expect(resolveSidebarCategoryDrop(items, "waiting-thread", "waiting-thread")).toBeNull();
    expect(
      resolveSidebarCategoryDrop(items, "unknown", sidebarMarkerId("custom-header:empty")),
    ).toBeNull();
  });
});

it("clears stored settlement hidden by snoozing when moving to a category", () => {
  const thread = {
    pinnedAt: null,
    settledOverride: "settled" as const,
    snoozedUntil: "2026-11-01T10:00:00Z",
  };
  expect(
    sidebarCategoryMoveActions(thread, {
      threadPinning: true,
      threadSettlement: true,
      threadSnooze: true,
    }),
  ).toEqual(["unsettle", "unsnooze"]);
  expect(
    sidebarCategoryMoveActions(
      { ...thread, pinnedAt: "2026-10-28T10:00:00Z" },
      { threadPinning: true, threadSettlement: true, threadSnooze: true },
    ),
  ).toEqual(["unpin", "unsettle", "unsnooze"]);
  expect(
    sidebarCategoryMoveActions(thread, {
      threadPinning: false,
      threadSettlement: false,
      threadSnooze: false,
    }),
  ).toEqual([]);
});
