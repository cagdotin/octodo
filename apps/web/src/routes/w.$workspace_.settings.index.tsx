import type { WorkspaceInfo } from "@octodo/contract";
import { WORKSPACE_KEY } from "@octodo/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { Input } from "@octodo/ui/components/input";
import { Textarea } from "@octodo/ui/components/textarea";
import { snapshotQuery, useRemoveWorkspace, useUpdateWorkspace } from "@/lib/api";
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
        <Rows>
          <Row label="Name" help="Shown in the rail and the workspace menu.">
            <Avatar label={info.key} className="size-7 rounded-lg text-[11px]" />
            <NameInput key={info.name} info={info} />
          </Row>
          <Row label="Description" help="What this workspace is for, for you and for agents.">
            <DescriptionInput key={info.description ?? ""} info={info} />
          </Row>
          <Row
            label="Task ids"
            help={`New tasks are numbered ${info.key}-${next}, ${info.key}-${next + 1}, …`}
          >
            <KeyInput info={info} ids={snapshot.tasks.length} />
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

/** Enter or leaving the field saves it; Escape puts the saved text back. */
const saveKeys =
  (saved: string) => (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.currentTarget.value = saved;
      event.currentTarget.blur();
    }
  };

function NameInput({ info }: { info: WorkspaceInfo }) {
  const update = useUpdateWorkspace(info.id);
  return (
    <Input
      size="sm"
      aria-label="Workspace name"
      className="w-48"
      defaultValue={info.name}
      onBlur={(event) => {
        const name = event.currentTarget.value.trim();
        if (name === "") event.currentTarget.value = info.name;
        else if (name !== info.name) update.mutate({ name });
      }}
      onKeyDown={saveKeys(info.name)}
    />
  );
}

function DescriptionInput({ info }: { info: WorkspaceInfo }) {
  const update = useUpdateWorkspace(info.id);
  const saved = info.description ?? "";
  return (
    <Textarea
      size="sm"
      aria-label="Workspace description"
      className="w-64"
      placeholder="Add a description"
      defaultValue={saved}
      onBlur={(event) => {
        const description = event.currentTarget.value.trim();
        if (description !== saved) update.mutate({ description: description || null });
      }}
      onKeyDown={saveKeys(saved)}
    />
  );
}

/** A new key applies only on confirm, since every id that has the old one is rewritten. */
function KeyInput({ info, ids }: { info: WorkspaceInfo; ids: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const change = useUpdateWorkspace(info.id);
  const key = (draft ?? info.key).trim();
  const changed = key !== info.key && WORKSPACE_KEY.test(key);
  return (
    <>
      <Input
        size="sm"
        aria-label="Id key"
        className="w-24 font-mono"
        maxLength={8}
        value={draft ?? info.key}
        onChange={(event) => setDraft(event.target.value.toUpperCase())}
      />
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="outline" size="sm" disabled={!changed || change.isPending}>
              Change…
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change {info.key} ids to {key}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {`Every id that starts with ${info.key} keeps its number and takes the new key: ${info.key}-1 becomes ${key}-1. octodo rewrites ${ids === 1 ? "the 1 task" : `all ${ids} tasks`}, their blockers, their [[${info.key}-1]] mentions and their folder names. Mentions inside code stay as written, and so does anything outside octodo that names the old ids.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button />}
              onClick={() =>
                change.mutate(
                  { key },
                  {
                    onSuccess: () => {
                      setDraft(null);
                      toastManager.add({
                        type: "success",
                        title: `Task ids now start with ${key}`,
                      });
                    },
                  },
                )
              }
            >
              Change ids
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
