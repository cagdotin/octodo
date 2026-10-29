import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CopyIcon, FolderOpenIcon } from "lucide-react";
import { toastManager } from "@octodo/ui/components/toast";
import { Avatar } from "@/components/app-sidebar";
import { Row, Rows, Section, SettingsPage } from "@/components/settings-page";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@octodo/ui/components/alert-dialog";
import { Button } from "@octodo/ui/components/button";
import { snapshotQuery, useRemoveWorkspace } from "@/lib/api";
import { desktop } from "@/lib/desktop";

export const Route = createFileRoute("/w/$workspace_/settings/")({
  component: GeneralSettings,
});

const Code = ({ children }: { children: string }) => (
  <code className="font-mono text-[11px]">{children}</code>
);

function GeneralSettings() {
  const { workspace } = Route.useParams();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const remove = useRemoveWorkspace();
  const navigate = useNavigate();
  if (!snapshot) return null;
  const info = snapshot.workspace;
  const next =
    Math.max(0, ...snapshot.tasks.map((task) => Number(task.id.split("-").at(-1)) || 0)) + 1;

  return (
    <SettingsPage title="General" description="This workspace and the folder it lives in.">
      <Section
        title="Workspace"
        description={
          <>
            Name and id key live in <Code>.octodo/config.json</Code>. Edit them there.
          </>
        }
      >
        <Rows>
          <Row label="Name" help="Shown in the rail and the workspace menu.">
            <Avatar label={info.key} className="size-7 rounded-lg text-[11px]" />
            <span className="text-sm">{info.name}</span>
          </Row>
          <Row
            label="Task ids"
            help={`New tasks are numbered ${info.key}-${next}, ${info.key}-${next + 1}, …`}
          >
            <span className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs">
              {info.key}
            </span>
          </Row>
          <Row label="Folder" help={<span className="font-mono break-all">{info.root}</span>}>
            <RevealFolder root={info.root} />
          </Row>
        </Rows>
      </Section>

      <Section title="Danger zone">
        <Rows className="border-destructive/24">
          <Row
            label="Remove from octodo"
            help="Forgets this workspace on this machine. Its folder and tasks stay where they are."
          >
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive-outline" size="sm">
                    Remove…
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {info.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    octodo stops listing this workspace. Nothing is deleted: add the folder again to
                    get it back.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
                  <AlertDialogClose
                    render={<Button variant="destructive" />}
                    onClick={() =>
                      remove.mutate(info.id, { onSuccess: () => void navigate({ to: "/" }) })
                    }
                  >
                    Remove workspace
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Row>
        </Rows>
      </Section>
    </SettingsPage>
  );
}

/** Opens the folder in the desktop app; a browser can only copy its path. */
function RevealFolder({ root }: { root: string }) {
  if (desktop) {
    return (
      <Button variant="outline" size="sm" onClick={() => void desktop?.showFolder(root)}>
        <FolderOpenIcon data-icon="inline-start" />
        {desktop.platform === "darwin" ? "Show in Finder" : "Show"}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void navigator.clipboard
          .writeText(root)
          .then(() => toastManager.add({ type: "success", title: "Folder path copied" }))
      }
    >
      <CopyIcon data-icon="inline-start" />
      Copy path
    </Button>
  );
}
