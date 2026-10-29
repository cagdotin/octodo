import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@octodo/ui/components/toast";
import { TooltipProvider } from "@octodo/ui/components/tooltip";
import { initDesktopChrome } from "@/lib/desktop";
import { routeTree } from "./routeTree.gen";
import "./index.css";

initDesktopChrome();

// POC: Shift+K (or ?kit=coss) swaps octodo's paper tokens for coss ui's stock theme.
const kit = new URLSearchParams(location.search).get("kit");
if (kit === "coss") document.documentElement.dataset["kit"] = "coss";
addEventListener("keydown", (event) => {
  if (!event.shiftKey || event.key !== "K") return;
  const root = document.documentElement;
  if (root.dataset["kit"] === "coss") delete root.dataset["kit"];
  else root.dataset["kit"] = "coss";
});

const queryClient = new QueryClient({
  defaultOptions: {
    // SSE drives freshness; refetching on focus covers missed events.
    queries: { staleTime: 30_000, refetchOnWindowFocus: true },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={400}>
          <ToastProvider position="bottom-center">
            <LazyMotion features={domMax} strict>
              <MotionConfig reducedMotion="user">
                <RouterProvider router={router} />
              </MotionConfig>
            </LazyMotion>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
