import {
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  ThreadResourceInput,
  type ScopedThreadRef,
  type ThreadResource,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { ArrowUpRightIcon, FileIcon, LinkIcon, PlusIcon, TicketIcon, XIcon } from "lucide-react";
import { useState, type FormEvent, type MouseEvent } from "react";

import { useOpenLink } from "../../browser/useOpenLink";
import { useRightPanelStore } from "../../rightPanelStore";
import { useServerConfigs } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { showPullRequestLinkContextMenu } from "../pullRequest/pullRequestLinkContextMenu";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { resolveExternalWebLinkHost, resolveExternalWebLinkHref } from "./externalLinkContextMenu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const decodeResource = Schema.decodeSync(ThreadResourceInput);
const NO_RESOURCES: ReadonlyArray<ThreadResource> = [];

function resourceLabel(resource: ThreadResource): string {
  return (
    resource.label ??
    (resource.kind === "file"
      ? resource.target.split(/[\\/]/).pop() || resource.target
      : resource.target)
  );
}

function ThreadResources({
  threadRef,
  resources,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly resources: ReadonlyArray<ThreadResource> | null;
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"file" | "link">("link");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const canReadFiles = useEnvironmentScope(threadRef.environmentId, AuthFilesystemReadScope);
  const update = useAtomCommand(threadEnvironment.updateMetadata);
  const openLink = useOpenLink(threadRef);
  const visible = (resources ?? NO_RESOURCES).filter((resource) => !resource.dismissed);

  async function save(event: FormEvent) {
    event.preventDefault();
    let resource: ThreadResourceInput;
    try {
      resource = decodeResource({
        kind,
        target: target.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
    } catch {
      setError(
        kind === "file"
          ? "Enter a file path."
          : "Enter a valid HTTP(S) URL without embedded credentials.",
      );
      return;
    }
    setPending(true);
    try {
      const result = await update({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          resource: { type: "add", source: "manual", resource },
        },
      });
      if (result._tag === "Success") {
        setAdding(false);
        setTarget("");
        setLabel("");
        setError(null);
      }
    } finally {
      setPending(false);
    }
  }

  function open(resource: ThreadResource, href: string | null, event: MouseEvent<HTMLElement>) {
    if (event.button > 1) return;
    if (resource.kind === "file") {
      useRightPanelStore.getState().openFile(threadRef, resource.target);
      return;
    }
    if (href === null) return;
    void openLink(href, { event }).catch(() =>
      toastManager.add({ type: "error", title: "Could not open link" }),
    );
  }

  const groups = [
    { kind: "jira", title: "Tickets", icon: TicketIcon },
    { kind: "file", title: "Files & artifacts", icon: FileIcon },
    { kind: "link", title: "Links", icon: LinkIcon },
  ] as const;

  if (visible.length === 0 && !canOperate) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-resources-heading"
      title="Resources"
      data-thread-resources
      actions={
        canOperate ? (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Add file or link"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
          </Button>
        ) : null
      }
    >
      <div
        className="max-h-56 overflow-y-auto overscroll-contain"
        data-thread-details-resource-list
      >
        {visible.length === 0 ? (
          resources === null ? null : (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              Save files and links for this thread.
            </p>
          )
        ) : (
          groups.map((group) => {
            const entries = visible.filter((resource) => resource.kind === group.kind);
            if (entries.length === 0) return null;
            return (
              <div key={group.kind} className="mb-1 last:mb-0">
                <div className="px-1.5 pt-1 pb-0.5 text-2xs text-muted-foreground">
                  {group.title}
                </div>
                {(expanded ? entries : entries.slice(0, 4)).map((resource) => {
                  // Server-supplied targets: only http(s) URLs may reach a browser or the shell.
                  const href =
                    resource.kind === "file" ? null : resolveExternalWebLinkHref(resource.target);
                  return (
                    <div
                      key={resource.id}
                      className="group/resource flex min-w-0 items-center gap-0.5"
                    >
                      <ThreadDetailsControl
                        part="row"
                        className="min-w-0 flex-1"
                        title={resource.target}
                        disabled={resource.kind === "file" ? !canReadFiles : href === null}
                        onClick={(event) => open(resource, href, event)}
                        onAuxClick={(event) => open(resource, href, event)}
                        onContextMenu={
                          href === null
                            ? undefined
                            : (event) => {
                                event.preventDefault();
                                void showPullRequestLinkContextMenu({
                                  url: href,
                                  openLabel: "Open in system browser",
                                  position: { x: event.clientX, y: event.clientY },
                                });
                              }
                        }
                      >
                        <group.icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate text-xs">{resourceLabel(resource)}</span>
                        {href === null ? null : (
                          <>
                            <span className="max-w-1/2 shrink-0 truncate text-2xs text-muted-foreground">
                              {resolveExternalWebLinkHost(href)}
                            </span>
                            <ArrowUpRightIcon className="ml-auto size-3 text-muted-foreground" />
                          </>
                        )}
                      </ThreadDetailsControl>
                      {canOperate ? (
                        <span className="flex shrink-0 opacity-0 transition-opacity pointer-coarse:opacity-100 group-hover/resource:opacity-100 group-focus-within/resource:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${resourceLabel(resource)}`}
                            onClick={() =>
                              void update({
                                environmentId: threadRef.environmentId,
                                input: {
                                  threadId: threadRef.threadId,
                                  resource: { type: "remove", resourceId: resource.id },
                                },
                              })
                            }
                          >
                            <XIcon className="size-3" />
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
      {groups.some(
        (group) => visible.filter((resource) => resource.kind === group.kind).length > 4,
      ) ? (
        <ThreadDetailsControl
          part="row"
          tone="muted"
          className="w-full"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show all resources"}
        </ThreadDetailsControl>
      ) : null}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogPopup>
          <form className="contents" onSubmit={(event) => void save(event)}>
            <DialogHeader>
              <DialogTitle>Add file or link</DialogTitle>
              <DialogDescription>Keep an output or reference with this thread.</DialogDescription>
            </DialogHeader>
            <DialogPanel className="flex flex-col">
              <div className="flex gap-2" role="group" aria-label="Resource type">
                <Button
                  type="button"
                  size="sm"
                  variant={kind === "link" ? "secondary" : "ghost"}
                  aria-pressed={kind === "link"}
                  onClick={() => {
                    setKind("link");
                    setError(null);
                  }}
                >
                  Link
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={kind === "file" ? "secondary" : "ghost"}
                  aria-pressed={kind === "file"}
                  onClick={() => {
                    setKind("file");
                    setError(null);
                  }}
                >
                  File or artifact
                </Button>
              </div>
              <label className="flex flex-col gap-1.5 text-xs">
                {kind === "file" ? "File path" : "URL"}
                <Input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  required
                  autoCapitalize="none"
                  placeholder={
                    kind === "file" ? "reports/result.html" : "https://example.com/browse/PROJ-123"
                  }
                />
              </label>
              {kind === "file" ? (
                <p className="text-xs text-muted-foreground">
                  Use a path relative to the thread workspace or an absolute path on its machine.
                </p>
              ) : null}
              <label className="flex flex-col gap-1.5 text-xs">
                Label (optional)
                <Input
                  value={label}
                  maxLength={512}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Report, design notes, ticket…"
                />
              </label>
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending || !target.trim()}>
                {pending ? "Saving…" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </ThreadDetailsSection>
  );
}

export function ThreadResourcesPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const configs = useServerConfigs();
  const resources = useAtomValue(environmentThreadDetails.threadAtom(threadRef), (thread) =>
    thread === null ? null : (thread.projection.thread.resources ?? NO_RESOURCES),
  );
  if (configs.get(threadRef.environmentId)?.environment.capabilities.threadResources !== true)
    return null;
  return (
    <ThreadResources
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      resources={resources}
    />
  );
}
