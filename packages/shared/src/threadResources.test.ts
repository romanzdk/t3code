import { MAX_THREAD_RESOURCES } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { detectJiraResources, threadResourceId, updateThreadResources } from "./threadResources.ts";

const addedAt = "2026-10-21T12:00:00.000Z";

describe("thread resources", () => {
  it("deduplicates equivalent links and keeps the first added time", () => {
    const first = updateThreadResources(
      [],
      { type: "add", source: "agent", resource: { kind: "link", target: "https://EXAMPLE.com" } },
      addedAt,
    );
    const second = updateThreadResources(
      first,
      {
        type: "add",
        source: "manual",
        resource: { kind: "link", target: "https://example.com/", label: "Example" },
      },
      "2026-10-22T12:00:00.000Z",
    );
    expect(second).toEqual([
      {
        id: "url:https://example.com/",
        kind: "link",
        target: "https://example.com/",
        label: "Example",
        source: "manual",
        addedAt,
      },
    ]);
  });

  it("removes only the resource with the given id", () => {
    const file = { kind: "file" as const, target: "reports/result.html" };
    const link = { kind: "link" as const, target: "https://example.com/docs" };
    const resources = [file, link].reduce<ReturnType<typeof updateThreadResources>>(
      (current, resource) =>
        updateThreadResources(current, { type: "add", source: "agent", resource }, addedAt),
      [],
    );
    expect(
      updateThreadResources(
        resources,
        { type: "remove", resourceId: threadResourceId(file) },
        addedAt,
      ).map((entry) => entry.target),
    ).toEqual(["https://example.com/docs"]);
  });

  it("deduplicates ticket links and preserves explicit labels during detection", () => {
    const resource = { kind: "link" as const, target: "https://jira.example/browse/APP-12" };
    const first = updateThreadResources(
      [],
      {
        type: "add",
        source: "manual",
        resource: { ...resource, label: "Investigate latency" },
      },
      addedAt,
    );
    const second = updateThreadResources(
      first,
      {
        type: "add",
        source: "detected",
        resource: { ...resource, target: `${resource.target}?focusedCommentId=5#comment` },
      },
      addedAt,
    );
    expect(second).toEqual(first);
    expect(second[0]).toMatchObject({ kind: "jira", label: "Investigate latency" });
  });

  it("keeps dismissed tickets hidden when detected again and permits explicit restoration", () => {
    const resource = { kind: "jira" as const, target: "https://jira.example/browse/APP-12" };
    const added = updateThreadResources([], { type: "add", source: "detected", resource }, addedAt);
    const removed = updateThreadResources(
      added,
      { type: "remove", resourceId: threadResourceId(resource) },
      addedAt,
    );
    expect(
      updateThreadResources(removed, { type: "add", source: "detected", resource }, addedAt)[0]
        ?.dismissed,
    ).toBe(true);
    expect(
      updateThreadResources(removed, { type: "add", source: "manual", resource }, addedAt)[0]
        ?.dismissed,
    ).toBeUndefined();
  });

  it("counts dismissed tickets toward the cap and drops the oldest to make room", () => {
    let resources = updateThreadResources(
      [],
      {
        type: "add",
        source: "detected",
        resource: { kind: "jira", target: "https://j.example/browse/A-0" },
      },
      addedAt,
    );
    resources = updateThreadResources(
      resources,
      { type: "remove", resourceId: "url:https://j.example/browse/A-0" },
      addedAt,
    );
    for (let index = 1; index < MAX_THREAD_RESOURCES; index++) {
      resources = updateThreadResources(
        resources,
        { type: "add", source: "manual", resource: { kind: "file", target: `out/${index}.txt` } },
        addedAt,
      );
    }
    expect(resources).toHaveLength(MAX_THREAD_RESOURCES);
    const next = updateThreadResources(
      resources,
      { type: "add", source: "manual", resource: { kind: "file", target: "out/new.txt" } },
      addedAt,
    );
    expect(next).toHaveLength(MAX_THREAD_RESOURCES);
    expect(next.some((entry) => entry.dismissed)).toBe(false);
    expect(next.at(-1)?.target).toBe("out/new.txt");
  });

  it("preserves other resources when additions use an older client snapshot", () => {
    const file = { kind: "file" as const, target: "reports/result.html" };
    const resources = updateThreadResources(
      [],
      { type: "add", source: "agent", resource: file },
      addedAt,
    );
    const next = updateThreadResources(
      resources,
      {
        type: "add",
        source: "manual",
        resource: { kind: "link", target: "https://example.com/docs#usage" },
      },
      addedAt,
    );
    expect(next.map((entry) => entry.target)).toEqual([
      "reports/result.html",
      "https://example.com/docs#usage",
    ]);
  });
});

describe("Jira detection", () => {
  it("finds full Cloud and self-hosted URLs without configuration", () => {
    expect(
      detectJiraResources(
        "See [ticket](https://team.atlassian.net/browse/APP-12?x=1). Also https://jira.example/jira/browse/OPS-8#details",
        null,
      ),
    ).toEqual([
      { kind: "jira", target: "https://team.atlassian.net/browse/APP-12", label: "APP-12" },
      { kind: "jira", target: "https://jira.example/jira/browse/OPS-8", label: "OPS-8" },
    ]);
  });

  it("resolves only configured project keys in branch names and messages", () => {
    expect(
      detectJiraResources("fix/APP-12-latency; APP-12 and OTHER-5; APP-120", {
        baseUrl: "https://jira.example/jira/",
        projectKeys: ["APP"],
      }),
    ).toEqual([
      { kind: "jira", target: "https://jira.example/jira/browse/APP-12", label: "APP-12" },
      { kind: "jira", target: "https://jira.example/jira/browse/APP-120", label: "APP-120" },
    ]);
  });

  it("trusts ticket URLs only on the configured Jira site", () => {
    expect(
      detectJiraResources(
        "Fix login (https://jira.evil.example/browse/APP-42) see https://JIRA.example/jira/browse/APP-7",
        { baseUrl: "https://jira.example/jira", projectKeys: [] },
      ),
    ).toEqual([{ kind: "jira", target: "https://jira.example/jira/browse/APP-7", label: "APP-7" }]);
  });

  it("ignores unconfigured bare keys, unsafe URLs, and ordinary web links", () => {
    expect(
      detectJiraResources(
        "APP-12 https://user:secret@jira.example/browse/APP-12 https://example.com/docs",
        null,
      ),
    ).toEqual([]);
  });
});
