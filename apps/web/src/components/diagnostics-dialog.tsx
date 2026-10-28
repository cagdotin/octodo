import type { Diagnostic } from "@octodo/contract";
import { CircleCheckIcon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useFixAllDiagnostics, useFixDiagnostic } from "@/lib/api";

export function DiagnosticsDialog({
  workspace,
  diagnostics,
  open,
  onOpenChange,
}: {
  workspace: string;
  diagnostics: ReadonlyArray<Diagnostic>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fixOne = useFixDiagnostic(workspace);
  const fixAll = useFixAllDiagnostics(workspace);
  const fixableFirst = diagnostics.toSorted(
    (a, b) => Number(a.fix === null) - Number(b.fix === null),
  );
  const fixable = diagnostics.filter((diagnostic) => diagnostic.fix?.inFixAll === true).length;
  const busy = fixOne.isPending || fixAll.isPending;
  const fixing = (diagnostic: Diagnostic) =>
    fixAll.isPending ||
    (fixOne.isPending &&
      fixOne.variables.path === diagnostic.path &&
      fixOne.variables.kind === diagnostic.kind);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>File problems</DialogTitle>
          <DialogDescription>
            Files under .octodo/ that octodo couldn't read cleanly. Fix what it offers here; each
            other problem says what to change by hand. This updates live.
          </DialogDescription>
        </DialogHeader>
        {diagnostics.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle>All files look good</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="flex flex-col divide-y pr-3">
              {fixableFirst.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.path}-${diagnostic.kind}-${diagnostic.field}-${index}`}
                  className="flex items-start gap-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-xs break-all">{diagnostic.path}</span>
                    <span className="text-sm text-muted-foreground">{diagnostic.message}</span>
                  </div>
                  {diagnostic.fix !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        fixOne.mutate({
                          path: diagnostic.path,
                          kind: diagnostic.kind,
                          action: diagnostic.fix!.action,
                        })
                      }
                    >
                      {fixing(diagnostic) && <Spinner data-icon="inline-start" />}
                      {diagnostic.fix.label}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
        {fixable > 1 && (
          <DialogFooter>
            <Button disabled={busy} onClick={() => fixAll.mutate(undefined)}>
              {fixAll.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <WrenchIcon data-icon="inline-start" />
              )}
              Fix all {fixable}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
