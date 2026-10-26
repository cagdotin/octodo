import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
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
            <h2 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">
              {title}
            </h2>
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
          <span>Settings</span>
          <ChevronRightIcon className="size-3 shrink-0" />
          <span className="truncate text-foreground">{title}</span>
        </>
      }
    />
  );
}

/** A titled card of settings rows. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>
      <ItemGroup className="rounded-[14px] border bg-card px-1 shadow-card">{children}</ItemGroup>
    </section>
  );
}

/** One setting: its name and description, with the value or controls on the right. */
export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Item className="py-3.5">
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>{children}</ItemActions>
    </Item>
  );
}
