import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Row, Rows, Section, SettingsPage } from "@/components/settings-page";
import { Button } from "@octodo/ui/components/button";
import { connectionQuery } from "@/lib/api";

export const Route = createFileRoute("/w/$workspace_/settings/connections")({
  loader: ({ context }) => context.queryClient.ensureQueryData(connectionQuery),
  component: ConnectionsSettings,
});

function ConnectionsSettings() {
  const { data: connection } = useQuery(connectionQuery);
  if (!connection) return null;
  const { mcpUrl } = connection;
  const json = JSON.stringify({ mcpServers: { octodo: { type: "http", url: mcpUrl } } }, null, 2);

  return (
    <SettingsPage
      title="Connections"
      description="Connect agents on this computer to octodo. These settings cover every workspace."
    >
      <Section title="Server">
        <Rows>
          <Row
            label={
              <span className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--sync-live) opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-(--sync-live)" />
                </span>
                MCP endpoint
              </span>
            }
            help="Only this computer can reach it."
          >
            <code className="max-w-56 truncate rounded-md border bg-muted/50 px-2 py-1 font-mono text-xs">
              {mcpUrl}
            </code>
            <CopyButton text={mcpUrl} label="Copy MCP endpoint" />
          </Row>
        </Rows>
      </Section>

      <Section title="Connect an agent" description="Pick the client you use and paste this in.">
        <div className="mt-3 flex flex-col gap-3">
          <Snippet
            title="Claude Code"
            help="Run this in a terminal."
            text={`claude mcp add --transport http octodo ${mcpUrl}`}
          />
          <Snippet
            title="Other MCP clients"
            help="Cursor, Executor and other clients that take an MCP server URL."
            text={json}
          />
          <Snippet
            title="Without the app running"
            help={
              <>
                Agents start octodo themselves over stdio. Needs{" "}
                <code className="font-mono">octo</code> on your PATH.
              </>
            }
            text="claude mcp add octodo -- octo mcp"
          />
        </div>
      </Section>
    </SettingsPage>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    });
  return { copied, copy };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => copy(text)}>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={copied ? "copied" : "copy"}
          className="flex"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15 }}
        >
          {copied ? <CheckIcon className="text-(--sync-live)" /> : <CopyIcon />}
        </m.span>
      </AnimatePresence>
    </Button>
  );
}

function Snippet({ title, help, text }: { title: string; help: ReactNode; text: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <TerminalIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{help}</p>
        </div>
      </div>
      <div className="relative border-t bg-muted/40">
        <pre className="px-4 py-3 pe-12 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground/80">
          {text}
        </pre>
        <span className="absolute top-1.5 right-1.5">
          <CopyButton text={text} label={`Copy ${title}`} />
        </span>
      </div>
    </div>
  );
}
