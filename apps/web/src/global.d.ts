/** What the desktop app's preload (apps/desktop/src/preload.ts) exposes; absent in a browser. */
export interface OctodoDesktopBridge {
  readonly isDesktop: true;
  /** Node's `process.platform`: "darwin", "win32", "linux", ... */
  readonly platform: string;
  isFullScreen(): Promise<boolean>;
  /** Calls `listener` when the window enters or leaves full screen; returns an unsubscribe. */
  onFullScreenChange(listener: (fullScreen: boolean) => void): () => void;
  /** The native folder picker; resolves to the chosen absolute path, or null when cancelled. */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** Opens a folder in Finder or the platform's file manager. */
  showFolder(folder: string): Promise<void>;
}

declare global {
  interface Window {
    readonly octodo?: OctodoDesktopBridge;
  }
}
