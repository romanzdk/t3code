import {
  JiraLinkSettings as JiraLinkSettingsSchema,
  type JiraLinkSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useId, useState, type FormEvent } from "react";

import { useServerConfigs } from "../../state/entities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { scopedSettingsAreMixed } from "./scopedSettings";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { useUpdateScopedSettings } from "./useScopedSettings";

const decodeJiraSettings = Schema.decodeSync(JiraLinkSettingsSchema);

function JiraSettingsForm({
  value,
  mixed,
  onSave,
}: {
  readonly value: JiraLinkSettings | null;
  readonly mixed: boolean;
  readonly onSave: (value: JiraLinkSettings | null) => void;
}) {
  const id = useId();
  const initialBaseUrl = mixed ? "" : (value?.baseUrl ?? "");
  const initialKeys = mixed ? "" : (value?.projectKeys.join(", ") ?? "");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [keys, setKeys] = useState(initialKeys);
  const [error, setError] = useState<string | null>(null);

  // Empty fields never save as "disabled": in a mixed scope they are blank placeholders, and
  // writing null there would wipe every environment's configuration.
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const settings = decodeJiraSettings({
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        projectKeys: [
          ...new Set(
            keys
              .toUpperCase()
              .split(/[,\s]+/)
              .filter(Boolean),
          ),
        ],
      });
      onSave(settings);
      setError(null);
    } catch {
      setError(
        "Enter a valid Jira base URL without a query or fragment, and project keys such as APP, OPS.",
      );
    }
  }

  return (
    <form onSubmit={save} className="mt-3 grid max-w-2xl gap-3 pb-3.5">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-base-url`}>Jira base URL</Label>
          <Input
            id={`${id}-base-url`}
            size="sm"
            value={baseUrl}
            autoCapitalize="none"
            maxLength={4096}
            placeholder={mixed ? "Mixed" : "https://company.atlassian.net"}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-keys`}>Project keys</Label>
          <Input
            id={`${id}-keys`}
            size="sm"
            value={keys}
            autoCapitalize="characters"
            placeholder={mixed ? "Mixed" : "APP, OPS"}
            onChange={(event) => setKeys(event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {error ? (
          <p role="alert" className="me-auto text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {value !== null || mixed ? (
          <Button type="button" size="xs" variant="outline" onClick={() => onSave(null)}>
            Disable key detection
          </Button>
        ) : null}
        <Button
          type="submit"
          size="xs"
          disabled={baseUrl === initialBaseUrl && keys === initialKeys}
        >
          Save Jira links
        </Button>
      </div>
    </form>
  );
}

export function JiraLinkSettingsSection() {
  const update = useUpdateScopedSettings();
  const { targets } = useSettingsScope();
  const configs = useServerConfigs();
  const supported = targets.filter(
    (target) =>
      configs.get(target.environmentId)?.environment.capabilities.jiraTicketLinks === true,
  );
  const first = supported[0];
  if (first === undefined) return null;
  const mixed = scopedSettingsAreMixed(supported, ["jiraLinks"]);
  const scopeKey = supported
    .map((target) => `${target.environmentId}:${target.projectId}`)
    .join(",");
  return (
    <SettingsSection title="Issue links">
      <SettingsRow
        serverScoped
        settingKeys={["jiraLinks"]}
        mixed={mixed}
        {...searchableSetting("jira-ticket-links")}
        description="Detect ticket keys in thread titles, branches, messages, and linked review titles. Full Jira URLs are detected without configuration."
      >
        <JiraSettingsForm
          key={`${scopeKey}:${mixed}:${JSON.stringify(first.settings.jiraLinks)}`}
          value={first.settings.jiraLinks}
          mixed={mixed}
          onSave={(jiraLinks) => update({ jiraLinks })}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
