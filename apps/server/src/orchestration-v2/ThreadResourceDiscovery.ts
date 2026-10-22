import {
  CommandId,
  MAX_THREAD_RESOURCES,
  ThreadResourceInput,
  type OrchestrationV2DomainEvent,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { detectJiraResources, threadResourceId } from "@t3tools/shared/threadResources";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";

const isResourceInput = Schema.is(ThreadResourceInput);

class ThreadResourceDiscovery extends Context.Service<
  ThreadResourceDiscovery,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ThreadResourceDiscovery") {}

interface DiscoveryRequest {
  readonly threadId: ThreadId | null;
  readonly text?: string;
}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const discover = Effect.fn("ThreadResourceDiscovery.discover")(function* (
    request: DiscoveryRequest,
  ) {
    const threads =
      request.threadId === null
        ? (yield* orchestrator.getShellSnapshot({ location: "active", unsettledOnly: true }))
            .threads
        : [yield* orchestrator.getThreadShell(request.threadId)];
    const settingsSnapshot = yield* settingsService.getSettings;
    // One thread failing (deleted mid-scan, cap reached by a concurrent add) must not stop the scan.
    yield* Effect.forEach(threads, (thread) =>
      Effect.gen(function* () {
        if (thread === null || thread.deletedAt !== null || thread.archivedAt !== null) return;
        const jira = resolveProjectSettings(settingsSnapshot, thread.projectId).settings.jiraLinks;
        const messages =
          request.text !== undefined
            ? [request.text]
            : (yield* orchestrator.getTimelinePage(thread.id, {
                view: "messages",
                fromEnd: true,
                limit: 20,
              })).items.flatMap(({ item }) =>
                item.type === "user_message" ||
                (item.type === "assistant_message" && !item.streaming)
                  ? [item.text]
                  : [],
              );
        const text = [
          thread.title,
          thread.branch ?? "",
          ...messages,
          ...(thread.pullRequests ?? []).map((link) => link.snapshot?.title ?? ""),
        ].join("\n");
        const resources =
          (yield* orchestrator.getThreadRecords(thread.id, [])).thread.resources ?? [];
        const ids = new Set(resources.map((resource) => resource.id));
        let visibleCount = resources.filter((resource) => !resource.dismissed).length;
        for (const resource of detectJiraResources(text, jira)) {
          const id = threadResourceId(resource);
          if (ids.has(id) || visibleCount >= MAX_THREAD_RESOURCES || !isResourceInput(resource)) {
            continue;
          }
          yield* orchestrator.dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`resource-discovery:${yield* crypto.randomUUIDv4()}`),
            threadId: thread.id,
            resource: { type: "add", source: "detected", resource },
          });
          ids.add(id);
          visibleCount += 1;
        }
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("Jira link discovery failed", cause).pipe(
              Effect.annotateLogs({ threadId: thread?.id }),
            ),
        ),
      ),
    );
  });

  const worker = yield* makeDrainableWorker(discover);

  const processEvent = (event: OrchestrationV2DomainEvent) => {
    switch (event.type) {
      case "thread.created":
      case "thread.metadata-updated":
      case "thread.unsettled":
      case "thread.unarchived":
      case "thread.pull-request-link-updated":
      case "thread.pull-request-synced":
        return worker.enqueue({ threadId: event.threadId });
      case "message.updated":
        if (!event.payload.streaming) {
          return worker.enqueue({ threadId: event.threadId, text: event.payload.text });
        }
        break;
    }
    return Effect.void;
  };

  const start: ThreadResourceDiscovery["Service"]["start"] = Effect.fn(
    "ThreadResourceDiscovery.start",
  )(function* () {
    yield* forkParked(Stream.runForEach(orchestrator.streamDomainEvents, processEvent));
    // The current settings come first, so the initial scan also waits for activation.
    yield* forkParked(
      Stream.concat(
        Stream.fromEffect(settingsService.getSettings),
        settingsService.streamChanges,
      ).pipe(
        Stream.map((settings) =>
          JSON.stringify([
            settings.jiraLinks,
            Object.entries(settings.projectSettingsOverrides).flatMap(([id, overrides]) =>
              overrides.jiraLinks === undefined ? [] : [[id, overrides.jiraLinks]],
            ),
          ]),
        ),
        Stream.changes,
        Stream.runForEach(() => worker.enqueue({ threadId: null })),
      ),
    );
  });

  return { start, drain: worker.drain } satisfies ThreadResourceDiscovery["Service"];
});
