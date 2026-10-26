import { assign, fromCallback, setup } from "xstate";

/** Events the EventSource actor reports back to the machine. */
type SourceEvent = { type: "OPEN" } | { type: "ERROR" } | { type: "CHANGE"; workspace: string };

type SyncEvent = SourceEvent | { type: "ONLINE" } | { type: "OFFLINE" } | { type: "RETRY" };

export interface SyncInput {
  url: string;
  /** Called for every `change` event, and with `null` after (re)connecting to resync everything. */
  onChange: (workspace: string | null) => void;
}

const MAX_ATTEMPTS = 6;

const eventSource = fromCallback<SyncEvent, { url: string }>(({ sendBack, input }) => {
  const source = new EventSource(input.url, { withCredentials: true });
  source.addEventListener("open", () => sendBack({ type: "OPEN" }));
  // EventSource retries by itself; close it so the machine owns the backoff and status.
  source.addEventListener("error", () => {
    source.close();
    sendBack({ type: "ERROR" });
  });
  source.addEventListener("change", (event) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (
        typeof data === "object" &&
        data !== null &&
        "workspace" in data &&
        typeof data.workspace === "string"
      ) {
        sendBack({ type: "CHANGE", workspace: data.workspace });
      }
    } catch {
      // Ignore malformed payloads; the next change or reconnect resyncs.
    }
  });
  return () => source.close();
});

const networkStatus = fromCallback<SyncEvent>(({ sendBack }) => {
  const online = () => sendBack({ type: "ONLINE" });
  const offline = () => sendBack({ type: "OFFLINE" });
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
});

/**
 * Live sync over `/api/events`: connecting → live, and on errors reconnecting with exponential
 * backoff until it gives up (offline). Going back online or RETRY starts over.
 */
export const syncMachine = setup({
  types: {
    context: {} as SyncInput & { attempts: number },
    events: {} as SyncEvent,
    input: {} as SyncInput,
  },
  actors: { eventSource, networkStatus },
  delays: {
    backoff: ({ context }) => Math.min(30_000, 1_000 * 2 ** (context.attempts - 1)),
  },
  guards: {
    exhausted: ({ context }) => context.attempts >= MAX_ATTEMPTS,
    browserOffline: () => typeof navigator !== "undefined" && !navigator.onLine,
  },
  actions: {
    resync: ({ context }) => context.onChange(null),
    notify: ({ context, event }) => {
      if (event.type === "CHANGE") context.onChange(event.workspace);
    },
  },
}).createMachine({
  id: "sync",
  context: ({ input }) => ({ ...input, attempts: 0 }),
  invoke: { src: "networkStatus" },
  initial: "connected",
  on: {
    OFFLINE: ".offline",
  },
  states: {
    connected: {
      invoke: { src: "eventSource", input: ({ context }) => ({ url: context.url }) },
      initial: "connecting",
      on: {
        ERROR: [
          { guard: "exhausted", target: "offline" },
          {
            target: "reconnecting",
            actions: assign({ attempts: ({ context }) => context.attempts + 1 }),
          },
        ],
      },
      states: {
        connecting: {
          on: { OPEN: "live" },
        },
        live: {
          // Anything may have changed while we were away.
          entry: [assign({ attempts: 0 }), "resync"],
          on: { CHANGE: { actions: "notify" } },
        },
      },
    },
    reconnecting: {
      always: { guard: "browserOffline", target: "offline" },
      after: { backoff: "connected" },
      on: { RETRY: "connected" },
    },
    offline: {
      // Keep trying slowly in case the server comes back without a network change.
      after: { 30_000: { target: "connected", actions: assign({ attempts: 0 }) } },
      on: {
        ONLINE: { target: "connected", actions: assign({ attempts: 0 }) },
        RETRY: { target: "connected", actions: assign({ attempts: 0 }) },
      },
    },
  },
});

export type SyncStatus = "connecting" | "live" | "reconnecting" | "offline";
