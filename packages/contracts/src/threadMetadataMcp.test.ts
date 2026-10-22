import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ThreadMetadataMcpUpdateInput } from "./threadMetadataMcp.ts";

const decodeUpdate = Schema.decodeUnknownSync(ThreadMetadataMcpUpdateInput);

describe("ThreadMetadataMcpUpdateInput", () => {
  it("accepts resource mutations and rejects unsafe links or mixed actions", () => {
    assert.deepEqual(
      decodeUpdate({
        action: "add_resource",
        resource: { kind: "file", target: "/tmp/report.html" },
      }).resource,
      { kind: "file", target: "/tmp/report.html" },
    );
    assert.equal(
      decodeUpdate({ action: "remove_resource", resourceId: "file:/tmp/report.html" }).resourceId,
      "file:/tmp/report.html",
    );
    for (const target of [
      "javascript:alert(1)",
      "file:///tmp/report.html",
      "https://user:secret@example.com",
      "invalid",
      // Percent-encoding grows this past the stored target limit.
      `https://example.com/${"é".repeat(400)}`,
    ]) {
      assert.throws(() =>
        decodeUpdate({ action: "add_resource", resource: { kind: "link", target } }),
      );
    }
    for (const target of ["\\\\host\\share\\x.png", "//host/share/x.png"]) {
      assert.throws(() =>
        decodeUpdate({ action: "add_resource", resource: { kind: "file", target } }),
      );
    }
    assert.throws(() => decodeUpdate({ action: "add_resource" }));
    assert.throws(() => decodeUpdate({ action: "remove_resource" }));
    assert.throws(() =>
      decodeUpdate({
        action: "rename",
        title: "Title",
        resource: { kind: "file", target: "report.html" },
      }),
    );
  });
  it("rejects malformed client request ids without normalizing valid keys", () => {
    const validKey = "metadata-\ud83d\ude80-1";
    assert.equal(
      decodeUpdate({ action: "regenerate_title", clientRequestId: validKey }).clientRequestId,
      validKey,
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\ud800" }),
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\udc00" }),
    );
  });

  it("accepts HTTP(S) pull request URLs and rejects other or malformed URLs", () => {
    assert.deepEqual(
      decodeUpdate({
        action: "link_pull_request",
        pullRequest: {
          repository: "engineering/t3code",
          number: 42,
          url: "https://git.corp.example/engineering/t3code/pulls/42",
        },
      }).pullRequest,
      {
        repository: "engineering/t3code",
        number: 42,
        url: "https://git.corp.example/engineering/t3code/pulls/42",
      },
    );

    for (const url of ["not a URL", "javascript:alert(1)", "file:///tmp/pull-request"]) {
      assert.throws(() =>
        decodeUpdate({
          action: "link_pull_request",
          pullRequest: { repository: "pingdotgg/t3code", number: 8690, url },
        }),
      );
    }
  });
});
