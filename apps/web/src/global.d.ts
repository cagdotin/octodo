/** What the desktop app's preload (apps/desktop/src/preload.ts) exposes; absent in a browser. */
export interface TasksmdDesktopBridge {
  readonly isDesktop: true;
  /** Node's `process.platform`: "darwin", "win32", "linux", ... */
  readonly platform: string;
  isFullScreen(): Promise<boolean>;
  /** Calls `listener` when the window enters or leaves full screen; returns an unsubscribe. */
  onFullScreenChange(listener: (fullScreen: boolean) => void): () => void;
}

declare global {
  interface Window {
    readonly tasksmd?: TasksmdDesktopBridge;
  }
}
