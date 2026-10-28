import * as Schema from "effect/Schema";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ExecutionEnvironmentCapabilities, ContextMenuItem } from "@t3tools/contracts";
import { sidebarListItemId, type SidebarListItem } from "./Sidebar.logic";
import type { SidebarThreadSummary } from "../types";

const SidebarCategorySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  collapsed: Schema.Boolean,
});
export type SidebarCategory = typeof SidebarCategorySchema.Type;

export function sidebarCategoryNameError(
  categories: readonly SidebarCategory[],
  name: string,
  editingId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a section name.";
  const folded = trimmed.toLowerCase();
  if (["active", "pinned", "working", "snoozed", "settled"].includes(folded))
    return "This name is used by a built-in section.";
  return categories.some(
    (category) => category.id !== editingId && category.name.toLowerCase() === folded,
  )
    ? "A section with this name already exists."
    : null;
}

export const SidebarCategoriesSchema = Schema.Struct({
  categories: Schema.Array(SidebarCategorySchema),
  assignments: Schema.Record(Schema.String, Schema.String),
}).check(
  Schema.makeFilter((state) => {
    const ids = new Set(state.categories.map((category) => category.id));
    return (
      ids.size === state.categories.length &&
      state.categories.every(
        (category) =>
          category.id.length > 0 &&
          category.name === category.name.trim() &&
          sidebarCategoryNameError(state.categories, category.name, category.id) === null,
      ) &&
      Object.entries(state.assignments).every(
        ([key, id]) => parseScopedThreadKey(key) !== null && ids.has(id),
      )
    );
  }),
);
export type SidebarCategories = typeof SidebarCategoriesSchema.Type;
export const DEFAULT_SIDEBAR_CATEGORIES: SidebarCategories = {
  categories: [{ id: "waiting", name: "Waiting", collapsed: false }],
  assignments: {},
};
export const SIDEBAR_CATEGORIES_STORAGE_KEY = "t3code:sidebar:custom-sections";

export function assignSidebarCategory(
  state: SidebarCategories,
  keys: readonly string[],
  categoryId: string | null,
): SidebarCategories {
  if (categoryId !== null && !state.categories.some((category) => category.id === categoryId))
    return state;
  const assignments = { ...state.assignments };
  for (const key of keys) {
    if (parseScopedThreadKey(key) === null) continue;
    if (categoryId === null) delete assignments[key];
    else assignments[key] = categoryId;
  }
  return { ...state, assignments };
}

export function deleteSidebarCategory(
  state: SidebarCategories,
  categoryId: string,
): SidebarCategories {
  return {
    categories: state.categories.filter((category) => category.id !== categoryId),
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(([, id]) => id !== categoryId),
    ),
  };
}

export function groupSidebarCategoryThreads<T>(
  threads: readonly T[],
  state: SidebarCategories,
  getKey: (thread: T) => string,
  routeKey: string | null,
) {
  const byCategory = new Map<string, T[]>();
  for (const thread of threads) {
    const id = state.assignments[getKey(thread)];
    if (id === undefined) continue;
    const list = byCategory.get(id) ?? [];
    list.push(thread);
    byCategory.set(id, list);
  }
  return state.categories.map((category) => {
    const members = byCategory.get(category.id) ?? [];
    return {
      category,
      threads: members,
      visibleThreads: category.collapsed
        ? members.filter((thread) => getKey(thread) === routeKey)
        : members,
    };
  });
}

export function sidebarCategoryMenuItem(
  state: SidebarCategories,
  keys: readonly string[],
): ContextMenuItem {
  return {
    id: "section",
    label: "Move to section",
    children: [
      {
        id: "section:active",
        label: "Active",
        checked: keys.every((key) => state.assignments[key] === undefined),
      },
      ...state.categories.map((category) => ({
        id: `section:custom:${category.id}`,
        label: category.name,
        checked: keys.every((key) => state.assignments[key] === category.id),
      })),
    ],
  };
}

export function resolveSidebarCategoryDrop(
  items: readonly SidebarListItem[],
  activeKey: string,
  overId: string,
): { readonly categoryId: string | null } | null {
  const active = items.find((item) => item.kind === "thread" && item.key === activeKey);
  const overIndex = items.findIndex((item) => sidebarListItemId(item) === overId);
  const over = items[overIndex];
  if (!active || activeKey === overId || !over) return null;
  if (over.kind === "marker" && over.marker.startsWith("custom-header:"))
    return { categoryId: over.marker.slice("custom-header:".length) };
  if (over.kind === "thread" && over.section === "custom") {
    for (let index = overIndex - 1; index >= 0; index--) {
      const item = items[index]!;
      if (item.kind === "marker" && item.marker.startsWith("custom-header:"))
        return { categoryId: item.marker.slice("custom-header:".length) };
    }
  }
  if (
    active.kind === "thread" &&
    active.section === "custom" &&
    ((over.kind === "thread" && over.section === "active") ||
      (over.kind === "marker" &&
        (over.marker === "active-placeholder" || over.marker === "pinned-divider")))
  )
    return { categoryId: null };
  return null;
}

export function sidebarCategoryMoveActions(
  thread: Pick<SidebarThreadSummary, "pinnedAt" | "settledOverride" | "snoozedUntil">,
  capabilities:
    | Pick<ExecutionEnvironmentCapabilities, "threadPinning" | "threadSettlement" | "threadSnooze">
    | undefined,
) {
  return [
    ...(capabilities?.threadPinning && thread.pinnedAt != null ? ["unpin" as const] : []),
    ...(capabilities?.threadSettlement && thread.settledOverride === "settled"
      ? ["unsettle" as const]
      : []),
    ...(capabilities?.threadSnooze && thread.snoozedUntil != null ? ["unsnooze" as const] : []),
  ];
}
