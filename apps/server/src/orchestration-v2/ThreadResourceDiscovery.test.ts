import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ServerCommand,
  type ThreadResource,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadResourceDiscovery from "./ThreadResourceDiscovery.ts";

const now = DateTime.makeUnsafe("2026-10-21T00:00:00.000Z");
const threadId = ThreadId.make("thread:discovery");
const projectId = ProjectId.make("project:discovery");
const instanceId = ProviderInstanceId.make("codex");

function thread(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: threadId,
    projectId,
    title: "Investigate",
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function dependencies(input: {
  readonly shells: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly commands: OrchestrationV2ServerCommand[];
  readonly events?: Stream.Stream<OrchestrationV2DomainEvent>;
  readonly resources?: ReadonlyArray<ThreadResource>;
  readonly scanStarted?: Deferred.Deferred<void>;
  readonly failingThreadId?: ThreadId;
}) {
  return Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: input.events ?? Stream.never,
      getShellSnapshot: () =>
        Effect.succeed({
          schemaVersion: 2,
          snapshotSequence: 0,
          threads: input.shells,
          archivedThreads: [],
        }).pipe(
          Effect.tap(() =>
            input.scanStarted ? Deferred.succeed(input.scanStarted, undefined) : Effect.void,
          ),
        ),
      getThreadShell: (id) => Effect.succeed(input.shells.find((shell) => shell.id === id) ?? null),
      getThreadRecords: (id) =>
        id === input.failingThreadId
          ? Effect.die("projection unavailable")
          : Effect.succeed({ thread: { resources: input.resources ?? [] } } as never),
      getTimelinePage: () => Effect.succeed({ items: [], totalItems: 0, hasMore: false }),
      dispatch: (command) =>
        Effect.sync(() => {
          input.commands.push(command);
          return { sequence: 1, storedEvents: [] };
        }),
    }),
    ServerSettings.layerTest({
      jiraLinks: { baseUrl: "https://wrong.example", projectKeys: ["OTHER"] },
      projectSettingsOverrides: {
        [projectId]: { jiraLinks: { baseUrl: "https://jira.example", projectKeys: ["APP"] } },
      },
    }),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size).fill(1),
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
  );
}

it.effect(
  "discovers a saved branch at startup using its project's Jira settings and retains dismissals",
  () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    const resources: ThreadResource[] = [
      {
        id: "url:https://jira.example/browse/APP-8",
        kind: "jira",
        target: "https://jira.example/browse/APP-8",
        label: "APP-8",
        source: "detected",
        addedAt: DateTime.formatIso(now),
        dismissed: true,
      },
    ];
    const shell = thread({ branch: "fix/APP-12-latency", title: "APP-8 and OTHER-10" });
    return Effect.scoped(
      Effect.gen(function* () {
        const scanStarted = yield* Deferred.make<void>();
        yield* Effect.gen(function* () {
          const service = yield* ThreadResourceDiscovery.make;
          yield* service.start();
          yield* Deferred.await(scanStarted);
          yield* service.drain;
        }).pipe(
          Effect.provide(dependencies({ shells: [shell], commands, resources, scanStarted })),
        );
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          type: "thread.metadata.update",
          threadId,
          resource: {
            type: "add",
            source: "detected",
            resource: { target: "https://jira.example/browse/APP-12" },
          },
        });
      }),
    );
  },
);

it.effect("keeps scanning other threads when one thread fails", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  const broken = thread({ id: ThreadId.make("thread:broken"), branch: "fix/APP-1" });
  const healthy = thread({ branch: "fix/APP-2" });
  return Effect.scoped(
    Effect.gen(function* () {
      const scanStarted = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const service = yield* ThreadResourceDiscovery.make;
        yield* service.start();
        yield* Deferred.await(scanStarted);
        yield* service.drain;
      }).pipe(
        Effect.provide(
          dependencies({
            shells: [broken, healthy],
            commands,
            scanStarted,
            failingThreadId: broken.id,
          }),
        ),
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({ threadId, resource: { resource: { label: "APP-2" } } });
    }),
  );
});

it.effect(
  "indexes completed messages without waiting for a UI and skips partial streaming text",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed = yield* Deferred.make<void>();
        const event = (text: string, streaming: boolean): OrchestrationV2DomainEvent => ({
          id: EventId.make(`event:${streaming}`),
          type: "message.updated",
          threadId,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: MessageId.make(`message:${streaming}`),
            threadId,
            runId: null,
            nodeId: null,
            role: "assistant",
            text,
            attachments: [],
            streaming,
            createdAt: now,
            updatedAt: now,
            createdBy: "agent",
            creationSource: "provider",
          },
        });
        const events = Stream.make(event("APP-1", true), event("See APP-2", false)).pipe(
          Stream.ensuring(Deferred.succeed(processed, undefined)),
        );
        const commands: OrchestrationV2ServerCommand[] = [];
        yield* Effect.gen(function* () {
          const service = yield* ThreadResourceDiscovery.make;
          yield* service.start();
          yield* Deferred.await(processed);
          yield* service.drain;
          expect(commands).toHaveLength(1);
          expect(commands[0]).toMatchObject({ resource: { resource: { label: "APP-2" } } });
        }).pipe(Effect.provide(dependencies({ shells: [thread()], commands, events })));
      }),
    ),
);
