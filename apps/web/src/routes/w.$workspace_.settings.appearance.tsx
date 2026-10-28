import { createFileRoute } from "@tanstack/react-router";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Row, Section, SettingsPage } from "@/components/settings-page";
import { type Theme, useTheme } from "@/components/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@octodo/ui/components/toggle-group";

export const Route = createFileRoute("/w/$workspace_/settings/appearance")({
  component: AppearanceSettings,
});

const THEMES = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const satisfies ReadonlyArray<{ value: Theme; label: string; icon: unknown }>;

const isTheme = (value: string): value is Theme => THEMES.some((theme) => theme.value === value);

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsPage title="Appearance" description="How octodo looks, in every workspace.">
      <Section title="Theme">
        <Row title="Theme" description="System follows your device's light or dark setting.">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={theme}
            onValueChange={(value) => isTheme(value) && setTheme(value)}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} aria-label={label}>
                <Icon data-icon="inline-start" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
      </Section>
    </SettingsPage>
  );
}
