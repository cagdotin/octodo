/**
 * Preload for the app window. It runs sandboxed, so it is bundled to CommonJS on its own and may
 * only use Electron's renderer modules. The web app reads `window.octodo` to draw macOS window
 * chrome (title bar strip, room for the traffic lights) that the browser build leaves out, to use
 * native dialogs where a browser has none (picking a folder), and to offer the update the app
 * downloaded.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("octodo", {
  isDesktop: true,
  platform: process.platform,
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("octodo:is-full-screen"),
  pickFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke("octodo:pick-folder", defaultPath),
  showFolder: (folder: string): Promise<void> => ipcRenderer.invoke("octodo:show-folder", folder),
  onFullScreenChange: (listener: (fullScreen: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, fullScreen: boolean) => listener(fullScreen);
    ipcRenderer.on("octodo:full-screen", handler);
    return () => {
      ipcRenderer.removeListener("octodo:full-screen", handler);
    };
  },
  updateReady: (): Promise<string | null> => ipcRenderer.invoke("octodo:update-ready"),
  onUpdateReady: (listener: (version: string) => void) => {
    const handler = (_event: IpcRendererEvent, version: string) => listener(version);
    ipcRenderer.on("octodo:update-ready", handler);
    return () => {
      ipcRenderer.removeListener("octodo:update-ready", handler);
    };
  },
  installUpdate: (): Promise<void> => ipcRenderer.invoke("octodo:install-update"),
});
