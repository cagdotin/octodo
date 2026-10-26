import { useSyncExternalStore } from "react";

/**
 * Desktop window chrome. The Electron app's preload exposes `window.octodo`; on macOS the web app
 * then draws its own title bar and keeps room for the traffic lights. `<html>` carries
 * `data-desktop="mac"` (and `data-fullscreen` while in full screen) so CSS can key off it through
 * the `desktop-mac` and `windowed-mac` variants. A browser, including a phone, gets neither.
 */
const bridge = typeof window === "undefined" ? undefined : window.octodo;

export const isDesktopMac = bridge?.isDesktop === true && bridge.platform === "darwin";

/** The desktop app's native helpers, or undefined in a browser. */
export const desktop = bridge;

let fullScreen = false;
const listeners = new Set<() => void>();

const setFullScreen = (next: boolean) => {
  fullScreen = next;
  document.documentElement.toggleAttribute("data-fullscreen", next);
  for (const listener of listeners) listener();
};

/** Marks `<html>` and follows full screen; call once before the first render. */
export function initDesktopChrome() {
  if (!bridge || !isDesktopMac) return;
  document.documentElement.dataset["desktop"] = "mac";
  bridge.onFullScreenChange(setFullScreen);
  void bridge.isFullScreen().then(setFullScreen);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** `mac`: the macOS desktop app; `windowed`: its traffic lights are showing (not full screen). */
export function useDesktopChrome() {
  const isFullScreen = useSyncExternalStore(
    subscribe,
    () => fullScreen,
    () => false,
  );
  return { mac: isDesktopMac, windowed: isDesktopMac && !isFullScreen };
}
