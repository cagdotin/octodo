import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/workspace-header";

/** A settings page: the inset header, then the content in a centred, readable column. */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <SettingsHeader title={title} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10 md:px-8 md:py-16">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {children}
        </div>
      </ScrollArea>
    </>
  );
}

function SettingsHeader({ title }: { title: string }) {
  return (
    <PageHeader
      title={
        <>
          <span className="text-muted-foreground">Settings</span>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </>
      }
    />
  );
}
