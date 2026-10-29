import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { AppFrame, PageToolbar } from "@/components/app-frame";
import { Button } from "@octodo/ui/components/button";
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
import { useToday } from "@octodo/ui/hooks/use-today";
import { snapshotQuery } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";

export interface SectionSearch {
  /** The open entry's id. */
  entry?: string | undefined;
  /** The id of one of the section's `views`; all its entries when absent. */
  show?: string | undefined;
}

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * A plugin's section (decision 0027): its view, and the panel of the open entry. It is there only
 * while the workspace enables the plugin; otherwise, and the moment a disable reaches the snapshot,
 * the URL lands on the workspace's Tasks.
 */
export const Route = createFileRoute("/w/$workspace_/$section")({
  validateSearch: (search: Record<string, unknown>): SectionSearch => {
    const entry = text(search["entry"]);
    const show = text(search["show"]);
    return { ...(entry && { entry }), ...(show && { show }) };
  },
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
  const today = useToday();
  const [composing, setComposing] = useState(false);
  const { web } = section;
  const all = (snapshot.entries ?? []).filter((entry) => entry.section === section.id);
  const view = web.views.find((candidate) => candidate.id === search.show);
  const entries =
    view === undefined ? all : all.filter((entry) => view.matches(entry.fields, today));
  const selected =
    search.entry === undefined ? undefined : all.find((entry) => entry.id === search.entry);

  const open = (entry: string | undefined) =>
    void navigate({ search: (prev) => ({ ...prev, entry }) });
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
    <AppFrame workspace={workspace} panel={isMobile ? null : detail}>
      <SectionSidebar snapshot={snapshot} section={section} entries={all} active={view?.id} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <PageToolbar
          icon={<web.Icon />}
          title={
            <h1 className="flex min-w-0 items-center gap-1.5 truncate">
              {view === undefined ? (
                web.label
              ) : (
                <>
                  <span className="text-muted-foreground">{web.label}</span>
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{view.label}</span>
                </>
              )}
            </h1>
          }
        >
          <Button size="sm" onClick={compose}>
            <PlusIcon data-icon="inline-start" />
            New {web.noun}
          </Button>
        </PageToolbar>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <web.View
              workspace={workspace}
              entries={entries}
              view={view}
              selected={search.entry}
              onOpen={open}
              composing={composing}
              onCompose={setComposing}
            />
          </div>
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
