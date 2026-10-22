import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  ThreadResourceInput,
  type ThreadResource,
} from "@t3tools/contracts";
import { CommonActions, StackActions, useNavigation } from "@react-navigation/native";
import * as Schema from "effect/Schema";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import type { EnvironmentRuntimeState } from "../../state/remote-runtime-types";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectedThreadProjection } from "../../state/use-thread-detail";
import { fileRoutePathSegments } from "../files/filePath";

const decodeResource = Schema.decodeSync(ThreadResourceInput);

const KIND_LABELS = { file: "File", link: "Link", jira: "Jira" } as const;

// Targets come from the server, so a forked or compromised host could send intent:// or app schemes.
function webUrl(target: string) {
  try {
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function ThreadResourcesSection({
  thread,
  runtime,
  replace,
}: {
  readonly thread: EnvironmentThreadShell | null;
  readonly runtime: EnvironmentRuntimeState | null;
  readonly replace: boolean;
}) {
  const navigation = useNavigation();
  const detail = useSelectedThreadProjection();
  const [adding, setAdding] = useState<"file" | "link" | null>(null);
  const canOperate = useEnvironmentScope(
    thread?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canReadFiles = useEnvironmentScope(thread?.environmentId ?? null, AuthFilesystemReadScope);
  const update = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: true });
  const resources =
    detail?.projection.thread.resources?.filter((resource) => !resource.dismissed) ?? [];
  if (
    thread === null ||
    runtime?.serverConfig?.environment.capabilities.threadResources !== true ||
    (resources.length === 0 && !canOperate)
  )
    return null;

  function add(kind: "file" | "link", target: string) {
    setAdding(null);
    if (thread === null || !canOperate || !target.trim()) return;
    let resource: ThreadResourceInput;
    try {
      resource = decodeResource({ kind, target: target.trim() });
    } catch {
      Dialog.alert(
        "Invalid resource",
        kind === "file"
          ? "Enter a file path."
          : "Enter a valid HTTP(S) URL without embedded credentials.",
      );
      return;
    }
    void update({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, resource: { type: "add", source: "manual", resource } },
    });
  }

  async function open(resource: ThreadResource) {
    if (thread === null) return;
    if (resource.kind === "file") {
      if (!canReadFiles) return;
      const params = {
        environmentId: thread.environmentId,
        threadId: thread.id,
        path: fileRoutePathSegments(resource.target),
      };
      navigation.dispatch(
        replace
          ? StackActions.replace("ThreadFile", params)
          : CommonActions.navigate("ThreadFile", params),
      );
    } else if (
      webUrl(resource.target) === null ||
      !(await tryOpenExternalUrl(resource.target, "markdown-link"))
    ) {
      Dialog.alert("Could not open link", "Try opening it in your browser.");
    }
  }

  function remove(resource: ThreadResource) {
    if (thread === null || !canOperate) return;
    Dialog.confirm({
      title: "Remove resource",
      message: resource.label ?? resource.target,
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => {
        void update({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, resource: { type: "remove", resourceId: resource.id } },
        });
      },
    });
  }

  return (
    <ListSection
      title="Resources"
      footer={
        adding === "file"
          ? "Enter a workspace-relative or absolute path on the thread's machine."
          : canOperate && resources.length > 0
            ? "Touch and hold a resource to copy or remove it."
            : undefined
      }
    >
      {resources.map((resource) => {
        const url = resource.kind === "file" ? null : webUrl(resource.target);
        const openable = resource.kind === "file" ? canReadFiles : url !== null;
        const label =
          resource.label ??
          (resource.kind === "file"
            ? resource.target.split(/[\\/]/).pop() || resource.target
            : resource.target);
        const location =
          resource.kind === "file" ? resource.target : (url?.hostname ?? resource.target);
        return (
          <Menu
            key={resource.id}
            shouldOpenOnLongPress
            title={label}
            actions={[
              ...(openable
                ? [
                    {
                      id: "open",
                      title: "Open",
                      image: resource.kind === "file" ? "doc.text" : "safari",
                    },
                  ]
                : []),
              {
                id: "copy",
                title: resource.kind === "file" ? "Copy path" : "Copy link",
                image: "doc.on.doc",
              },
              ...(canOperate
                ? [
                    {
                      id: "remove",
                      title: "Remove",
                      image: "trash",
                      attributes: { destructive: true },
                    },
                  ]
                : []),
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "open") void open(resource);
              else if (nativeEvent.event === "copy") void Clipboard.setStringAsync(resource.target);
              else if (nativeEvent.event === "remove") remove(resource);
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${KIND_LABELS[resource.kind]}, ${location}`}
              accessibilityHint="Touch and hold for actions."
              accessibilityState={{ disabled: !openable }}
              accessibilityActions={canOperate ? [{ name: "remove", label: "Remove" }] : undefined}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "remove") remove(resource);
              }}
              onPress={openable ? () => void open(resource) : undefined}
              className={cn(
                "min-h-14 gap-1 border-b border-border-subtle px-4 py-3",
                openable && "active:opacity-60",
              )}
            >
              <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
                {label}
              </Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                {KIND_LABELS[resource.kind]} · {location}
              </Text>
            </Pressable>
          </Menu>
        );
      })}
      {canOperate && adding !== null ? (
        <AppTextInput
          autoFocus
          accessibilityLabel={adding === "file" ? "File path" : "Link URL"}
          placeholder={adding === "file" ? "reports/result.html" : "https://example.com"}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={adding === "link" ? "url" : "default"}
          returnKeyType="done"
          onSubmitEditing={({ nativeEvent }) => add(adding, nativeEvent.text)}
          onBlur={() => setAdding(null)}
          className="m-3"
        />
      ) : canOperate ? (
        <ListRow
          icon="plus"
          label="Add file or link"
          onPress={() =>
            Dialog.alert("Add resource", undefined, [
              { text: "Link", onPress: () => setAdding("link") },
              { text: "File or artifact", onPress: () => setAdding("file") },
              { text: "Cancel", style: "cancel" },
            ])
          }
        />
      ) : null}
    </ListSection>
  );
}
