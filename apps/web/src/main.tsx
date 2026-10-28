import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Toaster } from "@octodo/ui/components/sonner";
import { TooltipProvider } from "@octodo/ui/components/tooltip";
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

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-center" />;
}

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
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
