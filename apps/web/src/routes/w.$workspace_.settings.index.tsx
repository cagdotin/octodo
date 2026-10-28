import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CopyIcon, FolderOpenIcon } from "lucide-react";
import { toast } from "sonner";
import { Row, Section, SettingsPage } from "@/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@octodo/ui/components/alert-dialog";
import { Button } from "@octodo/ui/components/button";
import { ItemSeparator } from "@octodo/ui/components/item";
import { snapshotQuery, useRemoveWorkspace } from "@/lib/api";
import { desktop } from "@/lib/desktop";

export const Route = createFileRoute("/w/$workspace_/settings/")({
  component: GeneralSettings,
});

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
      <Section title="Workspace">
        <Row title="Name" description="Shown in the sidebar and the workspace menu.">
          <span className="text-sm">{info.name}</span>
        </Row>
        <ItemSeparator className="my-0" />
        <Row
          title="Task ids"
          description={`New tasks are numbered ${info.key}-${next}, ${info.key}-${next + 1}, …`}
        >
          <span className="font-mono text-sm">{info.key}</span>
        </Row>
        <ItemSeparator className="my-0" />
        <Row title="Folder" description={<span className="font-mono break-all">{info.root}</span>}>
          {desktop ? (
            <Button variant="outline" size="sm" onClick={() => void desktop?.showFolder(info.root)}>
              <FolderOpenIcon data-icon="inline-start" />
              {desktop.platform === "darwin" ? "Show in Finder" : "Show"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(info.root)
                  .then(() => toast.success("Folder path copied"))
              }
            >
              <CopyIcon data-icon="inline-start" />
              Copy path
            </Button>
          )}
        </Row>
      </Section>
      <p className="-mt-6 text-xs text-muted-foreground">
        Name and id key live in <code className="font-mono">.octodo/config.json</code>; edit them
        there.
      </p>
      <Section title="Danger zone">
        <Row
          title="Remove from octodo"
          description="Forgets this workspace on this machine. Its folder and tasks stay where they are."
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Remove…
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {info.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  octodo stops listing this workspace. Nothing is deleted: add the folder again to
                  get it back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    remove.mutate(info.id, { onSuccess: () => void navigate({ to: "/" }) })
                  }
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Row>
      </Section>
    </SettingsPage>
  );
}
