import { useEffect, useLayoutEffect, useRef } from "react";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, [role=combobox]") !== null);

/** Is any modal layer (dialog, sheet, menu, popover) open? Those handle their own keys. */
const overlayOpen = () =>
  document.querySelector(
    "[role=dialog][data-state=open], [role=menu][data-state=open], [role=listbox]",
  ) !== null;

/**
 * Global single-key shortcuts. Keys are lower-case `event.key` values, optionally prefixed with
 * `mod+` (⌘ on macOS, Ctrl elsewhere). Plain keys are ignored while typing or with an overlay open.
 */
export const useHotkeys = (bindings: Record<string, (event: KeyboardEvent) => void>) => {
  const ref = useRef(bindings);
  useLayoutEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod) {
        const handler = ref.current[`mod+${key}`];
        if (handler) {
          event.preventDefault();
          handler(event);
        }
        return;
      }
      if (event.altKey || isTyping(event.target) || overlayOpen()) return;
      const handler = ref.current[key];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
};
