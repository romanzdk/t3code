import type {
  ThreadResource,
  ThreadResourceInput,
  ThreadResourceMutation,
} from "@t3tools/contracts";

function normalizeThreadResource(input: ThreadResourceInput): ThreadResourceInput {
  if (input.kind === "file") return { ...input, target: input.target.trim() };
  return { ...input, target: new URL(input.target).href };
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
    return resources.filter((resource) => resource.id !== mutation.resourceId);
  }
  const resource = normalizeThreadResource(mutation.resource);
  const id = threadResourceId(resource);
  const existing = resources.find((entry) => entry.id === id);
  const updated: ThreadResource = {
    ...resource,
    id,
    source: mutation.source,
    addedAt: existing?.addedAt ?? addedAt,
  };
  if (existing) return resources.map((entry) => (entry.id === id ? updated : entry));
  return [...resources, updated];
}
