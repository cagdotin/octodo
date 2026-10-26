import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initDesktopChrome } from "@/lib/desktop";
import { routeTree } from "./routeTree.gen";
import "./index.css";

initDesktopChrome();

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
        <TooltipProvider delayDuration={400}>
          <RouterProvider router={router} />
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
