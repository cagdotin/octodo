/**
 * Preload for the app window. It runs sandboxed, so it is bundled to CommonJS on its own and may
 * only use Electron's renderer modules. The web app reads `window.tasksmd` to draw macOS window
 * chrome (title bar strip, room for the traffic lights) that the browser build leaves out.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("tasksmd", {
  isDesktop: true,
  platform: process.platform,
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("tasksmd:is-full-screen"),
  onFullScreenChange: (listener: (fullScreen: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, fullScreen: boolean) => listener(fullScreen);
    ipcRenderer.on("tasksmd:full-screen", handler);
    return () => {
      ipcRenderer.removeListener("tasksmd:full-screen", handler);
    };
  },
});
