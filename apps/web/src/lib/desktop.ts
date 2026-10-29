import { useEffect, useState } from "react";

/**
 * Desktop window chrome. The Electron app's preload exposes `window.octodo`; on macOS the web app
 * then draws its own title bar and keeps room for the traffic lights. `<html>` carries
 * `data-desktop="mac"` (and `data-fullscreen` while in full screen) so CSS can key off it through
 * the `desktop-mac` and `windowed-mac` variants. A browser, including a phone, gets neither.
 */
const bridge = typeof window === "undefined" ? undefined : window.octodo;

const isDesktopMac = bridge?.isDesktop === true && bridge.platform === "darwin";

/** The desktop app's native helpers, or undefined in a browser. */
export const desktop = bridge;

const setFullScreen = (on: boolean) =>
  document.documentElement.toggleAttribute("data-fullscreen", on);

/** Marks `<html>` and follows full screen; call once before the first render. */
export function initDesktopChrome() {
  if (!bridge || !isDesktopMac) return;
  document.documentElement.dataset["desktop"] = "mac";
  bridge.onFullScreenChange(setFullScreen);
  void bridge.isFullScreen().then(setFullScreen);
}

/** The version the desktop app downloaded and installs on restart; null in a browser or until then. */
export function useUpdateReady() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge) return;
    void bridge.updateReady().then(setVersion);
    return bridge.onUpdateReady(setVersion);
  }, []);
  return version;
}
