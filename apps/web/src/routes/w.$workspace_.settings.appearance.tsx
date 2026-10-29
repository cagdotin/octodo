import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { Section, SettingsPage } from "@/components/settings-page";
import { type Theme, useTheme } from "@/components/theme-provider";
import { RadioGroupPrimitive, RadioPrimitive } from "@octodo/ui/components/radio-group";
import { cn } from "@octodo/ui/lib/utils";

export const Route = createFileRoute("/w/$workspace_/settings/appearance")({
  component: AppearanceSettings,
});

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>;

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme.value === value);

/**
 * The miniatures paint each theme's own colours, whichever theme the page is in, so they repeat
 * the tokens of `styles.css` rather than read them.
 */
const PALETTES = {
  light: {
    "--t-desk": "#f0f0f0",
    "--t-paper": "#ffffff",
    "--t-ink": "#22211f",
    "--t-line": "rgb(34 33 31 / 9%)",
    "--t-accent": "#22211f",
  },
  dark: {
    "--t-desk": "#0e0e0d",
    "--t-paper": "#1b1b1a",
    "--t-ink": "#f0ece5",
    "--t-line": "rgb(240 236 229 / 8%)",
    "--t-accent": "oklch(0.9 0.19 124)",
  },
} as const satisfies Record<"light" | "dark", Record<string, string>>;

function AppearanceSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <SettingsPage title="Appearance" description="How octodo looks on this computer.">
      <Section
        title="Theme"
        description={
          theme === "system"
            ? `Follows your device setting, currently ${resolvedTheme}.`
            : "Pick a theme, or follow your device setting."
        }
      >
        <RadioGroupPrimitive
          aria-label="Theme"
          className="mt-4 grid grid-cols-3 gap-3 sm:gap-4"
          value={theme}
          onValueChange={(value) => isTheme(value) && setTheme(value)}
        >
          {THEMES.map((option) => (
            <ThemeCard key={option.value} value={option.value} label={option.label} />
          ))}
        </RadioGroupPrimitive>
      </Section>
    </SettingsPage>
  );
}

function ThemeCard({ value, label }: { value: Theme; label: string }) {
  return (
    <RadioPrimitive.Root
      value={value}
      className="group flex min-w-0 cursor-pointer flex-col items-center gap-2 outline-none"
    >
      <span className="relative block aspect-[16/11] w-full overflow-hidden rounded-lg border ring-offset-2 ring-offset-background transition-[box-shadow,scale] duration-150 ease-out group-focus-visible:ring-2 group-focus-visible:ring-ring group-active:scale-[0.98] group-data-checked:ring-2 group-data-checked:ring-foreground [@media(hover:hover)]:group-hover:not-group-data-checked:border-foreground/24">
        {value === "system" ? (
          <>
            <span className="absolute inset-0">
              <Miniature variant="light" />
            </span>
            <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
              <Miniature variant="dark" />
            </span>
          </>
        ) : (
          <Miniature variant={value} />
        )}
        <RadioPrimitive.Indicator
          keepMounted={false}
          className="absolute top-1.5 right-1.5 flex size-4.5 items-center justify-center rounded-full bg-foreground text-background shadow-xs/5 transition-[opacity,scale] duration-150 ease-out data-starting-style:scale-75 data-starting-style:opacity-0"
        >
          <CheckIcon className="size-3" strokeWidth={3} />
        </RadioPrimitive.Indicator>
      </span>
      <span className="text-sm text-muted-foreground transition-colors group-data-checked:font-medium group-data-checked:text-foreground">
        {label}
      </span>
    </RadioPrimitive.Root>
  );
}

/** octodo in small: the rail on the desk, the sidebar and a list of tasks on one paper card. */
function Miniature({ variant }: { variant: "light" | "dark" }) {
  return (
    <span
      className="flex size-full gap-[3%] bg-(--t-desk) py-[4%] pr-[4%] pl-[2%]"
      style={PALETTES[variant] as CSSProperties}
    >
      <span className="flex w-[7%] flex-col items-center gap-[10%] pt-[2%]">
        <span className="aspect-square w-full rounded-[2px] bg-(--t-accent)" />
        <span className="aspect-square w-3/4 rounded-full bg-(--t-ink) opacity-20" />
        <span className="aspect-square w-3/4 rounded-full bg-(--t-ink) opacity-20" />
      </span>
      <span className="flex flex-1 overflow-hidden rounded-[4px] border border-(--t-line) bg-(--t-paper)">
        <span className="flex w-[30%] flex-col gap-[7%] border-r border-(--t-line) px-[5%] pt-[8%]">
          <span className="h-1 w-4/5 rounded-full bg-(--t-ink) opacity-40" />
          <span className="h-1 w-3/5 rounded-full bg-(--t-ink) opacity-15" />
          <span className="h-1 w-4/5 rounded-full bg-(--t-ink) opacity-15" />
          <span className="h-1 w-1/2 rounded-full bg-(--t-ink) opacity-15" />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="flex h-[16%] items-center justify-between border-b border-(--t-line) px-[6%]">
            <span className="h-1 w-2/5 rounded-full bg-(--t-ink) opacity-55" />
            <span className="h-[45%] w-1/5 rounded-[2px] bg-(--t-accent)" />
          </span>
          {[0, 1, 2, 3, 4].map((row) => (
            <span
              key={row}
              className="flex h-[13%] items-center gap-[5%] border-b border-(--t-line) px-[6%]"
            >
              <span
                className={cn(
                  "aspect-square h-[38%] shrink-0 rounded-full border border-(--t-ink) opacity-40",
                  row === 1 && "bg-(--t-ink)",
                )}
              />
              <span
                className={cn(
                  "h-1 rounded-full bg-(--t-ink) opacity-20",
                  row % 2 ? "w-1/2" : "w-3/4",
                )}
              />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
