import { describe, expect, it } from "vite-plus/test";

import { threadResourceId, updateThreadResources } from "./threadResources.ts";

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
