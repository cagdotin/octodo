import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Row, Section, SettingsPage } from "@/components/settings-page";
import { Button } from "@octodo/ui/components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemSeparator,
  ItemTitle,
} from "@octodo/ui/components/item";
import { connectionQuery } from "@/lib/api";

export const Route = createFileRoute("/w/$workspace_/settings/connections")({
  loader: ({ context }) => context.queryClient.ensureQueryData(connectionQuery),
  component: ConnectionsSettings,
});

function ConnectionsSettings() {
  const { data: connection } = useQuery(connectionQuery);
  if (!connection) return null;
  const { mcpUrl } = connection;
  const claude = `claude mcp add --transport http octodo ${mcpUrl}`;
  const json = JSON.stringify({ mcpServers: { octodo: { type: "http", url: mcpUrl } } }, null, 2);

  return (
    <SettingsPage
      title="Connections"
      description="Connect agents on this computer to octodo. These settings cover every workspace."
    >
      <Section title="Server">
        <Row
          title="MCP endpoint"
          description={<span className="font-mono break-all">{mcpUrl}</span>}
        >
          <CopyButton text={mcpUrl} label="MCP endpoint" />
        </Row>
      </Section>

      <Section title="Connect an agent">
        <Snippet title="Claude Code" description="Run this in a terminal." text={claude} />
        <ItemSeparator className="my-0" />
        <Snippet
          title="Other MCP clients"
          description="Cursor, Executor and other clients that take an MCP server URL."
          text={json}
        />
        <ItemSeparator className="my-0" />
        <Snippet
          title="Without the app running"
          description={
            <>
              Agents can start octodo themselves over stdio. Needs <code>octo</code> on your PATH.
            </>
          }
          text="claude mcp add octodo -- octo mcp"
        />
      </Section>
    </SettingsPage>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          toast.success(`${label} copied`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      Copy
    </Button>
  );
}

function Snippet({
  title,
  description,
  text,
}: {
  title: string;
  description: ReactNode;
  text: string;
}) {
  return (
    <Item className="flex-col items-stretch gap-3 py-3.5">
      <div className="flex items-start gap-4">
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <CopyButton text={text} label={title} />
        </ItemActions>
      </div>
      <pre className="rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    </Item>
  );
}
