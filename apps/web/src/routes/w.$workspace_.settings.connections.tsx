import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Row, Section, SettingsPage } from "@/components/settings-page";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { connectionQuery } from "@/lib/api";

export const Route = createFileRoute("/w/$workspace_/settings/connections")({
  loader: ({ context }) => context.queryClient.ensureQueryData(connectionQuery),
  component: ConnectionsSettings,
});

const MASK = "•".repeat(24);
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/;

function ConnectionsSettings() {
  const { data: connection } = useQuery(connectionQuery);
  const [revealed, setRevealed] = useState(false);
  if (!connection) return null;
  const { mcpUrl, pairUrl, token } = connection;
  // Snippets show the token masked until revealed; copying always gives the real one.
  const shown = revealed ? token : MASK;
  const claude = (t: string) =>
    `claude mcp add --transport http octodo ${mcpUrl} --header "Authorization: Bearer ${t}"`;
  const json = (t: string) =>
    JSON.stringify(
      {
        mcpServers: {
          octodo: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${t}` } },
        },
      },
      null,
      2,
    );

  return (
    <SettingsPage
      title="Connections"
      description="Connect agents and other devices to this octodo. These settings cover every workspace."
    >
      <Section title="Server">
        <Row
          title="MCP endpoint"
          description={<span className="font-mono break-all">{mcpUrl}</span>}
        >
          <CopyButton text={mcpUrl} label="MCP endpoint" />
        </Row>
        <ItemSeparator className="my-0" />
        <Snippet
          title="Access token"
          description="Agents send it as a bearer token. Anyone with it can read and change your tasks."
          shown={shown}
          copy={token}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevealed((value) => !value)}
            aria-pressed={revealed}
          >
            {revealed ? (
              <EyeOffIcon data-icon="inline-start" />
            ) : (
              <EyeIcon data-icon="inline-start" />
            )}
            {revealed ? "Hide" : "Reveal"}
          </Button>
        </Snippet>
      </Section>

      <Section title="Connect an agent">
        <Snippet
          title="Claude Code"
          description="Run this in a terminal."
          shown={claude(shown)}
          copy={claude(token)}
        />
        <ItemSeparator className="my-0" />
        <Snippet
          title="Other MCP clients"
          description="Cursor, Executor and other clients that take an MCP server URL and headers."
          shown={json(shown)}
          copy={json(token)}
        />
        <ItemSeparator className="my-0" />
        <Snippet
          title="Without the app running"
          description={
            <>
              Agents can start octodo themselves over stdio. Needs <code>octo</code> on your PATH.
            </>
          }
          shown="claude mcp add octodo -- octo mcp"
          copy="claude mcp add octodo -- octo mcp"
        />
      </Section>

      <Section title="Other devices">
        <Snippet
          title="Pairing link"
          description={
            LOOPBACK.test(pairUrl) ? (
              <>
                Signs in another browser on this machine. For your phone, start the server with{" "}
                <code className="font-mono">octo serve --host &lt;tailscale-ip&gt;</code>.
              </>
            ) : (
              "Open it on your phone or another computer to sign that browser in."
            )
          }
          shown={pairUrl.replace(encodeURIComponent(token), shown)}
          copy={pairUrl}
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
  shown,
  copy,
  children,
}: {
  title: string;
  description: ReactNode;
  /** What the block shows; `copy` is what the button copies, so secrets can stay masked. */
  shown: string;
  copy: string;
  /** More actions beside the copy button. */
  children?: ReactNode;
}) {
  return (
    <Item className="flex-col items-stretch gap-3 py-3.5">
      <div className="flex items-start gap-4">
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {children}
          <CopyButton text={copy} label={title} />
        </ItemActions>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-muted-foreground">
        {shown}
      </pre>
    </Item>
  );
}
