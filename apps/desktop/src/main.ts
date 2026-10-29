/**
 * The desktop app: shows the web app of the octodo server it attaches to or spawns (decision 0021)
 * in a window.
 */
import { defaultHome } from "@octodo/engine";
import { DEFAULT_PORT } from "@octodo/server";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBackend, type Problem } from "./backend.ts";
import { ANSWERS, problemPage } from "./problem.ts";
import { isInstalled, linkOcto } from "./octo-link.ts";
import { startUpdates } from "./updates.ts";

const devUrl = process.env["OCTODO_DEV_URL"];
const home = defaultHome(process.env, homedir());

/** What the app window shows: nothing yet, the web app of a server, or why there is none. */
type View =
  | { readonly kind: "waiting" }
  | { readonly kind: "app"; readonly url: string }
  | {
      readonly kind: "problem";
      readonly problem: Problem;
      readonly answer: (retry: boolean) => void;
    };

let view: View = { kind: "waiting" };

const webDir = () =>
  app.isPackaged
    ? join(process.resourcesPath, "web")
    : fileURLToPath(new URL("../../web/dist", import.meta.url));

/**
 * Packaged builds take their icon from the app bundle (build/icon.icns); unpackaged runs would show
 * Electron's, so point the dock and windows at the same artwork.
 */
const devIcon = app.isPackaged
  ? undefined
  : fileURLToPath(new URL("../build/icon.png", import.meta.url));

/** In development the window loads Vite, which proxies to this server; wait until Vite is up. */
const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

/**
 * On macOS the web app draws its own title bar: a 40px strip at the top of the sidebar (and the
 * main card's header beside it) is a drag region, and the traffic lights sit centred in it. Keep
 * these numbers in step with the `desktop-mac` styles in apps/web.
 */
const trafficLightPosition = { x: 16, y: 13 };

ipcMain.handle("octodo:is-full-screen", (event) =>
  Boolean(BrowserWindow.fromWebContents(event.sender)?.isFullScreen()),
);

/** The native folder picker, as a sheet on the asking window; null when cancelled. */
ipcMain.handle("octodo:pick-folder", async (event, defaultPath: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: "Choose a workspace folder",
    buttonLabel: "Choose",
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    ...(typeof defaultPath === "string" ? { defaultPath } : {}),
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/** Shows a folder in Finder (Explorer, the file manager). Only absolute paths are accepted. */
ipcMain.handle("octodo:show-folder", async (_event, folder: unknown) => {
  if (typeof folder !== "string" || !folder.startsWith("/")) return;
  await shell.openPath(folder);
});

/**
 * Brings a window to the current view. A web app on another origin (a new server, or Vite in
 * development, which follows `server.json` itself) loads at the same route.
 */
const render = async (window: BrowserWindow) => {
  if (view.kind === "waiting") return;
  if (view.kind === "problem") return window.loadURL(problemPage(view.problem));
  const target = new URL(devUrl ?? view.url);
  const shown = URL.parse(window.webContents.getURL());
  if (shown?.origin === target.origin) return;
  if (devUrl !== undefined) await waitFor(devUrl);
  const route = shown?.protocol === "http:" ? shown.pathname + shown.search + shown.hash : "/";
  return window.loadURL(new URL(route, target).href);
};

const show = (next: View) => {
  view = next;
  for (const window of BrowserWindow.getAllWindows()) void render(window);
};

const createWindow = () => {
  const mac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    title: "octodo",
    ...(devIcon !== undefined && !mac ? { icon: devIcon } : {}),
    ...(mac ? { titleBarStyle: "hidden" as const, trafficLightPosition } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  window.once("ready-to-show", () => window.show());

  // The traffic lights disappear in full screen, so the web app drops the room it keeps for them.
  window.on("enter-full-screen", () => window.webContents.send("octodo:full-screen", true));
  window.on("leave-full-screen", () => window.webContents.send("octodo:full-screen", false));

  // Links to other sites open in the default browser, never inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (view.kind === "problem" && (url === ANSWERS.retry || url === ANSWERS.quit)) {
      event.preventDefault();
      view.answer(url === ANSWERS.retry);
      return;
    }
    if (view.kind === "app" && new URL(url).origin !== new URL(devUrl ?? view.url).origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void render(window);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  const updates = startUpdates((version) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send("octodo:update-ready", version);
  });
  ipcMain.handle("octodo:update-ready", async () => (await updates).ready());
  ipcMain.handle("octodo:install-update", async () => (await updates).install());

  const bundle = resolve(process.execPath, "../../..");
  if (app.isPackaged && isInstalled(bundle, homedir()))
    void linkOcto(bundle, homedir()).catch((error: unknown) =>
      console.error(`Linking octo failed: ${String(error)}`),
    );

  // `octo upgrade` asks a running app to quit this way before it swaps the app's folder.
  process.on("SIGTERM", () => app.quit());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  const backend = startBackend({
    home,
    port: Number(process.env["OCTODO_PORT"] ?? DEFAULT_PORT),
    webDir: webDir(),
    script: fileURLToPath(new URL("./server.mjs", import.meta.url)),
    onServer: (url) => {
      console.log(`octodo server on ${url}`);
      show({ kind: "app", url });
    },
    onProblem: (problem) => {
      console.error(`${problem.title}: ${problem.detail}`);
      return new Promise((answer) => show({ kind: "problem", problem, answer }));
    },
  });
  void backend.running.then((keepGoing) => {
    if (!keepGoing) app.quit();
  });

  let stopped = false;
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    void backend.stop().finally(() => {
      stopped = true;
      // Electron ignores a quit asked for in the same turn as the one this handler prevented.
      setTimeout(() => app.quit());
    });
  });

  void app.whenReady().then(() => {
    if (devIcon !== undefined) app.dock?.setIcon(devIcon);
    createWindow();
  });
}
