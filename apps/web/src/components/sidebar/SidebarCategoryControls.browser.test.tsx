import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { useState } from "react";
import "~/index.css";
import { render } from "../../../test/render";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  DEFAULT_SIDEBAR_CATEGORIES,
  SidebarCategoriesSchema,
  deleteSidebarCategory,
} from "../Sidebar.categories";
import { SidebarCategoryDialog, SidebarCategoryHeader } from "./SidebarCategoryControls";

const storageKey = "test:sidebar-category-controls";

function Categories() {
  const [state, setState] = useLocalStorage(
    storageKey,
    DEFAULT_SIDEBAR_CATEGORIES,
    SidebarCategoriesSchema,
  );
  const [editing, setEditing] = useState<string | null | undefined>();
  return (
    <>
      <button onClick={() => setEditing(null)}>New section</button>
      {state.categories.map((category) => (
        <SidebarCategoryHeader
          key={category.id}
          category={category}
          count={0}
          onToggle={() =>
            setState((current) => ({
              ...current,
              categories: current.categories.map((item) =>
                item.id === category.id ? { ...item, collapsed: !item.collapsed } : item,
              ),
            }))
          }
          onRename={() => setEditing(category.id)}
          onDelete={() => setState((current) => deleteSidebarCategory(current, category.id))}
        />
      ))}
      {editing !== undefined && (
        <SidebarCategoryDialog
          categories={state.categories}
          category={state.categories.find((category) => category.id === editing) ?? null}
          onClose={() => setEditing(undefined)}
          onSave={(name) => {
            return setState((current) => ({
              ...current,
              categories:
                editing === null
                  ? [...current.categories, { id: "created", name, collapsed: false }]
                  : current.categories.map((category) =>
                      category.id === editing ? { ...category, name } : category,
                    ),
            }));
          }}
        />
      )}
    </>
  );
}

it("creates, validates, renames, collapses and deletes sections across remounts", async () => {
  localStorage.removeItem(storageKey);
  using _cleanup = { [Symbol.dispose]: () => localStorage.removeItem(storageKey) };
  await using screen = await render(<Categories />);
  await screen.getByRole("button", { name: "New section", exact: true }).click();
  await page.getByRole("textbox", { name: "Section name" }).fill(" waiting ");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("A section with this name already exists.");
  await page.getByRole("textbox", { name: "Section name" }).fill(" Review ");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await screen.getByRole("button", { name: "Review 0", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Review 0", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
  await screen.getByRole("button", { name: "Section options for Review" }).click();
  await page.getByRole("menuitem", { name: "Rename section" }).click();
  await page.getByRole("textbox", { name: "Section name" }).fill("Ready");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await screen.rerender(<Categories key="remounted" />);
  await expect
    .element(screen.getByRole("button", { name: "Ready 0", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
  await screen.getByRole("button", { name: "Section options for Ready" }).click();
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Ready 0", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Waiting 0", exact: true }))
    .toBeInTheDocument();
});

it("keeps the entered name when saving a section fails", async () => {
  const onClose = vi.fn();
  await using screen = await render(
    <SidebarCategoryDialog
      categories={DEFAULT_SIDEBAR_CATEGORIES.categories}
      category={null}
      onSave={() => false}
      onClose={onClose}
    />,
  );
  await screen.getByRole("textbox", { name: "Section name" }).fill("Review");
  await screen.getByRole("button", { name: "Create", exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Could not save the section. Check that local storage is available and try again.",
    );
  await expect.element(screen.getByRole("textbox", { name: "Section name" })).toHaveValue("Review");
  expect(onClose).not.toHaveBeenCalled();
});
