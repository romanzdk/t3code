import { useId, useState } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { sidebarCategoryNameError, type SidebarCategory } from "../Sidebar.categories";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";

export function SidebarCategoryHeader(props: {
  category: SidebarCategory;
  count: number;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center">
      <div className="min-w-0 flex-1 overflow-hidden">
        <CollapsibleSectionHeader
          expanded={!props.category.collapsed}
          onClick={props.onToggle}
          accessory={<span className="font-normal tabular-nums">{props.count}</span>}
        >
          <span className="inline-block max-w-40 truncate align-bottom">{props.category.name}</span>
        </CollapsibleSectionHeader>
      </div>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`Section options for ${props.category.name}`}
            />
          }
        >
          <MoreHorizontalIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={props.onRename}>Rename section</MenuItem>
          <MenuItem onClick={props.onDelete}>Delete section</MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

export function SidebarCategoryDialog(props: {
  categories: readonly SidebarCategory[];
  category: SidebarCategory | null;
  onSave: (name: string) => boolean;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(props.category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const message = sidebarCategoryNameError(props.categories, name, props.category?.id);
            setError(message);
            if (message !== null) return;
            if (props.onSave(name.trim())) props.onClose();
            else
              setError(
                "Could not save the section. Check that local storage is available and try again.",
              );
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.category ? "Rename section" : "New section"}</DialogTitle>
            <DialogDescription>Sections are saved only on this device.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label htmlFor={id}>Section name</Label>
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error !== null}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            {error && (
              <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit">{props.category ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
