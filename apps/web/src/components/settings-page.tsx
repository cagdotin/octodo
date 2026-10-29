import { ChevronRightIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { cn } from "@octodo/ui/lib/utils";
import { PageToolbar } from "@/components/app-frame";

/** A settings page: its title in the toolbar, then the content in a centred, readable column. */
export function SettingsPage({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageToolbar
        icon={<SettingsIcon />}
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-muted-foreground">Settings</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </span>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl px-6 pt-10 pb-16 md:px-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description && (
                <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p>
              )}
            </div>
            {action && <div className="flex shrink-0 items-center gap-1 pt-1">{action}</div>}
          </div>
          {children}
        </div>
      </ScrollArea>
    </>
  );
}

/** A titled group of settings, with an action beside the title. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The bordered card a section's rows sit in, one hairline between each. */
export function Rows({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mt-3 divide-y overflow-hidden rounded-xl border bg-card", className)}>
      {children}
    </div>
  );
}

/** One setting: its label and help, with the value or controls on the right. */
export function Row({
  label,
  help,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-44">
        <p className="text-sm font-medium">{label}</p>
        {help && <div className="mt-0.5 text-xs text-pretty text-muted-foreground">{help}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
