import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppFrame, PageToolbar } from "@/components/app-frame";
import { EntryDetail } from "@/components/entry-detail";
import { enabledSection, type EnabledSection } from "@/components/section";
import { SectionSidebar } from "@/components/section-sidebar";
import type { WorkspaceSnapshot } from "@octodo/contract";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@octodo/ui/components/sheet";
import { SidebarInset } from "@octodo/ui/components/sidebar";
import { useIsMobile } from "@octodo/ui/hooks/use-mobile";
import { snapshotQuery } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";

export interface SectionSearch {
  /** The open entry's id. */
  entry?: string | undefined;
}

/**
 * A plugin's section (decision 0027): its view, and the panel of the open entry. It is there only
 * while the workspace enables the plugin; otherwise, and the moment a disable reaches the snapshot,
 * the URL lands on the workspace's Tasks.
 */
export const Route = createFileRoute("/w/$workspace_/$section")({
  validateSearch: (search: Record<string, unknown>): SectionSearch =>
    typeof search["entry"] === "string" && search["entry"] !== "" ? { entry: search["entry"] } : {},
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(snapshotQuery(params.workspace)),
  component: SectionPage,
});

function SectionPage() {
  const { workspace, section: id } = Route.useParams();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  if (!snapshot) return null;
  const section = enabledSection(snapshot, id);
  if (section === undefined) return <Navigate to="/w/$workspace" params={{ workspace }} replace />;
  return <SectionLayout key={id} snapshot={snapshot} section={section} />;
}

function SectionLayout({
  snapshot,
  section,
}: {
  snapshot: WorkspaceSnapshot;
  section: EnabledSection;
}) {
  const workspace = snapshot.workspace.id;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const isMobile = useIsMobile();
  const [composing, setComposing] = useState(false);
  const { web } = section;
  const entries = (snapshot.entries ?? []).filter((entry) => entry.section === section.id);
  const selected =
    search.entry === undefined ? undefined : entries.find((entry) => entry.id === search.entry);

  const open = (entry: string | undefined) => void navigate({ search: { entry } });
  const compose = () => setComposing(true);

  useHotkeys({
    "mod+,": () => void navigate({ to: "/w/$workspace/settings", params: { workspace } }),
    "mod+n": compose,
    n: compose,
    c: compose,
    escape: () => {
      if (composing) setComposing(false);
      else if (search.entry !== undefined) open(undefined);
    },
  });

  const detail = selected ? (
    <EntryDetail
      key={selected.id}
      workspace={workspace}
      snapshot={snapshot}
      section={section}
      entry={selected}
      onClose={() => open(undefined)}
    />
  ) : null;

  return (
    <AppFrame workspace={workspace}>
      <SectionSidebar
        snapshot={snapshot}
        section={section}
        count={entries.length}
        onNew={compose}
      />
      <SidebarInset className="min-w-0 overflow-hidden">
        <PageToolbar icon={<web.Icon />} title={<h1 className="truncate">{web.label}</h1>} />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <web.View
              workspace={workspace}
              entries={entries}
              selected={search.entry}
              onOpen={open}
              composing={composing}
              onCompose={setComposing}
            />
          </div>
          {!isMobile && detail && (
            <aside className="flex w-[400px] shrink-0 flex-col border-l bg-background lg:w-[440px]">
              {detail}
            </aside>
          )}
        </div>
      </SidebarInset>
      {isMobile && (
        <Sheet open={detail !== null} onOpenChange={(value) => !value && open(undefined)}>
          <SheetContent
            side="right"
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none [&>button]:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{selected?.title ?? web.label}</SheetTitle>
              <SheetDescription>{web.label} details</SheetDescription>
            </SheetHeader>
            {detail}
          </SheetContent>
        </Sheet>
      )}
    </AppFrame>
  );
}
