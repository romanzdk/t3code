import type {
  JiraLinkSettings,
  ThreadResource,
  ThreadResourceInput,
  ThreadResourceMutation,
} from "@t3tools/contracts";
import { MAX_THREAD_RESOURCES } from "@t3tools/contracts";

function normalizeThreadResource(input: ThreadResourceInput): ThreadResourceInput {
  if (input.kind === "file") return { ...input, target: input.target.trim() };
  const url = new URL(input.target);
  const ticket = /\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/.exec(url.pathname);
  if (ticket) {
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return { ...input, kind: "jira", target: url.href, label: input.label ?? ticket[1]! };
  }
  return { ...input, target: url.href };
}

export function threadResourceId(input: ThreadResourceInput): string {
  const resource = normalizeThreadResource(input);
  return `${resource.kind === "file" ? "file" : "url"}:${resource.target}`;
}

export function updateThreadResources(
  current: ReadonlyArray<ThreadResource> | undefined,
  mutation: ThreadResourceMutation,
  addedAt: string,
): ReadonlyArray<ThreadResource> {
  const resources = current ?? [];
  if (mutation.type === "remove") {
    return resources
      .filter((resource) => resource.id !== mutation.resourceId || resource.kind === "jira")
      .map((resource) =>
        resource.id === mutation.resourceId ? { ...resource, dismissed: true } : resource,
      );
  }
  const resource = normalizeThreadResource(mutation.resource);
  const id = threadResourceId(resource);
  const existing = resources.find((entry) => entry.id === id);
  if (existing && mutation.source === "detected") return resources;
  const updated: ThreadResource = {
    ...resource,
    id,
    source: mutation.source,
    addedAt: existing?.addedAt ?? addedAt,
  };
  if (existing) return resources.map((entry) => (entry.id === id ? updated : entry));
  // Dismissed tickets count toward the cap so add/remove loops cannot grow the list without bound.
  const pruned =
    resources.length >= MAX_THREAD_RESOURCES ? resources.findIndex((entry) => entry.dismissed) : -1;
  return [...resources.filter((_, index) => index !== pruned), updated];
}

export function detectJiraResources(
  text: string,
  settings: JiraLinkSettings | null,
): ReadonlyArray<ThreadResourceInput> {
  const found = new Map<string, ThreadResourceInput>();
  const baseUrl = settings === null ? null : new URL(settings.baseUrl).href.replace(/\/+$/, "");
  const urls = /https?:\/\/[^\s<>[\]"'`]+/g;
  for (const match of text.matchAll(urls)) {
    const target = match[0].replace(/[).,;!?]+$/, "");
    try {
      const url = new URL(target);
      if (url.username || url.password) continue;
      const resource = normalizeThreadResource({ kind: "link", target });
      // With a configured site, a ticket-shaped URL elsewhere (e.g. in a PR title) is not trusted as a ticket.
      if (
        resource.kind === "jira" &&
        (baseUrl === null || resource.target.startsWith(`${baseUrl}/`))
      ) {
        found.set(threadResourceId(resource), resource);
      }
    } catch {
      continue;
    }
  }
  if (settings !== null) {
    const allowedKeys = new Set(settings.projectKeys);
    for (const match of text.replace(urls, " ").matchAll(/\b([A-Z][A-Z0-9_]*)-(\d+)\b/g)) {
      if (!allowedKeys.has(match[1]!)) continue;
      const key = match[0];
      const resource: ThreadResourceInput = {
        kind: "jira",
        target: `${baseUrl}/browse/${key}`,
        label: key,
      };
      found.set(threadResourceId(resource), resource);
    }
  }
  return [...found.values()];
}
