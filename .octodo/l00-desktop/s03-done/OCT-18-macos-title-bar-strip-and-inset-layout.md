---
id: OCT-18
title: macOS title bar strip and inset layout
priority: none
tags: []
created: 2026-10-25T18:34:38.618Z
updated: 2026-10-25T18:34:44.260Z
order: a0
---

The Electron window uses titleBarStyle hidden with trafficLightPosition {x:16,y:18}. A sandboxed preload (dist/preload.cjs) exposes window.octodo (platform, isDesktop, isFullScreen, onFullScreenChange), and the web app sets data-desktop="mac" and data-fullscreen on <html>. On macOS the sidebar starts with a 52px drag strip that holds the traffic lights and the sidebar toggle; the workspace switcher sits below it. The sidebar uses variant="inset", and the main card's header is a drag region whose middle lines up with the traffic lights. Controls inside drag regions are no-drag. In full screen the room kept for the traffic lights goes away. App chrome is select-none. The browser and phone builds get the inset layout but no strip.
