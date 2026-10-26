import type { Diagnostic } from "@octodo/core";
import { CircleCheckIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";

export function DiagnosticsDialog({
  diagnostics,
  open,
  onOpenChange,
}: {
  diagnostics: ReadonlyArray<Diagnostic>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>File problems</DialogTitle>
          <DialogDescription>
            Files under .octodo/ that octodo couldn't read. Fix them in your editor; this updates
            live.
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
            <ul className="flex flex-col divide-y">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.path}-${index}`} className="flex flex-col gap-0.5 py-2">
                  <span className="font-mono text-xs break-all">{diagnostic.path}</span>
                  <span className="text-sm text-muted-foreground">{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
