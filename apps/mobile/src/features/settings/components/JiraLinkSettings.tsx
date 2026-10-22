import {
  AuthSettingsWriteScope,
  JiraLinkSettings as JiraSettingsSchema,
  type JiraLinkSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import * as Dialog from "../../../components/ui/Dialog";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../../state/session";
import { useSettingsEnvironmentFilter } from "../settings-environment-filter";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
} from "../settings-scoped-server";
import { useSettingsWriter } from "../useSettingsWriter";
import { SettingsSection } from "./SettingsSection";

const decodeJiraSettings = Schema.decodeSync(JiraSettingsSchema);

function JiraSettingsForm({
  value,
  mixed,
  disabled,
  save,
}: {
  readonly value: JiraLinkSettings | null;
  readonly mixed: boolean;
  readonly disabled: boolean;
  readonly save: (value: JiraLinkSettings | null) => void;
}) {
  const initialBaseUrl = mixed ? "" : (value?.baseUrl ?? "");
  const initialKeys = mixed ? "" : (value?.projectKeys.join(", ") ?? "");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [keys, setKeys] = useState(initialKeys);
  // Empty fields also render for a mixed scope, so only the explicit disable action may write null.
  const canSave =
    (baseUrl !== initialBaseUrl || keys !== initialKeys) && (!!baseUrl.trim() || !!keys.trim());
  function submit() {
    try {
      save(
        decodeJiraSettings({
          baseUrl: baseUrl.trim().replace(/\/+$/, ""),
          projectKeys: [
            ...new Set(
              keys
                .toUpperCase()
                .split(/[,\s]+/)
                .filter(Boolean),
            ),
          ],
        }),
      );
    } catch {
      Dialog.alert(
        "Invalid Jira settings",
        "Enter a Jira base URL without a query or fragment, and project keys such as APP, OPS.",
      );
    }
  }
  return (
    <View className="gap-3 px-4 py-3">
      <Text className="text-sm text-foreground-muted">
        Detect ticket keys in branches and messages. Full Jira URLs work without configuration.
      </Text>
      <AppTextInput
        accessibilityLabel="Jira base URL"
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        placeholder={mixed ? "Mixed" : "https://company.atlassian.net"}
        className="min-h-11 rounded-xl px-3 py-2 text-base text-foreground"
      />
      <AppTextInput
        accessibilityLabel="Jira project keys"
        value={keys}
        onChangeText={setKeys}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!disabled}
        placeholder={mixed ? "Mixed" : "APP, OPS"}
        className="min-h-11 rounded-xl px-3 py-2 text-base text-foreground"
      />
      <View className="flex-row flex-wrap gap-2">
        <Button label="Save Jira links" disabled={disabled || !canSave} onPress={submit} />
        {value !== null || mixed ? (
          <Button
            label="Disable key detection"
            tone="text"
            disabled={disabled}
            onPress={() => save(null)}
          />
        ) : null}
      </View>
    </View>
  );
}

export function JiraLinkSettingsSection() {
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const group = projectGroups.find((entry) => entry.key === selectedProjectKey);
  const writable = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const writer = useSettingsWriter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const projectSelected = selectedProjectKey !== null;
  const environments = selectedTargets.filter(
    (target) => target.serverConfig.environment.capabilities.jiraTicketLinks === true,
  );
  const targets = resolveMobileSettingsTargets(
    environments,
    projectSelected ? (group?.members.map((member) => member.project) ?? []) : null,
  );
  if (targets.length === 0) return null;
  const value = targets[0]!.settings.jiraLinks;
  const mixed = targets.some(
    (target) => JSON.stringify(target.settings.jiraLinks) !== JSON.stringify(value),
  );
  const canWrite = targets.every((target) => writable.has(target.environment.environmentId));
  const key = targets
    .map((target) => `${target.environment.environmentId}:${target.projectId}`)
    .join(",");
  function persist(jiraLinks: JiraLinkSettings | null, inherit = false) {
    if (
      inFlight.current ||
      !targets.every((target) =>
        readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes = inherit
      ? planMobileScopedSettingsClear(targets, ["jiraLinks"])
      : planMobileScopedSettingsPatch(targets, projectSelected, { jiraLinks });
    inFlight.current = true;
    setPending(true);
    void writer(targets, writes).finally(() => {
      inFlight.current = false;
      setPending(false);
    });
  }
  return (
    <SettingsSection title="Jira ticket links">
      <JiraSettingsForm
        key={`${key}:${mixed}:${JSON.stringify(value)}`}
        value={value}
        mixed={mixed}
        disabled={!canWrite || pending}
        save={(jiraLinks) => persist(jiraLinks)}
      />
      {projectSelected && targets.some((target) => target.sources.jiraLinks === "project") ? (
        <View className="px-4 pb-3">
          <Button
            label="Use environment defaults"
            tone="text"
            disabled={!canWrite || pending}
            onPress={() => persist(null, true)}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
