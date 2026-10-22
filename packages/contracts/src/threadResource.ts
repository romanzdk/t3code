import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MAX_THREAD_RESOURCES = 100;

const MAX_RESOURCE_TARGET_LENGTH = 2048;

const ResourceTarget = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_RESOURCE_TARGET_LENGTH),
  Schema.makeFilter(
    (value) =>
      [...value].every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ) || "Resource targets must not contain control characters.",
  ),
);

const HttpUrl = ResourceTarget.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      if (url.href.length > MAX_RESOURCE_TARGET_LENGTH) return "This URL is too long.";
      return (
        ((url.protocol === "https:" || url.protocol === "http:") &&
          url.username === "" &&
          url.password === "") ||
        "Enter an HTTP(S) URL without embedded credentials."
      );
    } catch {
      return "Enter a valid HTTP(S) URL.";
    }
  }),
);

export const ThreadResourceInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("file"),
    // UNC and `//` paths make the host connect out (and send credentials) when the file is read.
    target: ResourceTarget.check(
      Schema.makeFilter(
        (value) => !/^[\\/]{2}/.test(value) || "Network paths are not supported. Use a local path.",
      ),
    ),
    label: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  }),
  Schema.Struct({
    kind: Schema.Literal("link"),
    target: HttpUrl,
    label: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  }),
]);
export type ThreadResourceInput = typeof ThreadResourceInput.Type;

const ResourceSource = Schema.Literals(["manual", "agent"]);
export const ThreadResourceId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_RESOURCE_TARGET_LENGTH + 8),
);

export const ThreadResource = Schema.Struct({
  id: ThreadResourceId,
  kind: Schema.Literals(["file", "link"]),
  target: ResourceTarget,
  label: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  source: ResourceSource,
  addedAt: IsoDateTime,
});
export type ThreadResource = typeof ThreadResource.Type;

export const ThreadResourceMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    resource: ThreadResourceInput,
    source: ResourceSource,
  }),
  Schema.Struct({
    type: Schema.Literal("remove"),
    resourceId: ThreadResourceId,
  }),
]);
export type ThreadResourceMutation = typeof ThreadResourceMutation.Type;
