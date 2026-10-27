---
id: OCT-37
title: Lazy-load the CodeMirror editors to recover the bundle cost
tags:
  - web
  - perf
created: 2026-10-26T14:14:05.282Z
order: a5
status: backlog
---

The body editor added about +54 KB gzip (net, after removing react-markdown and typography) and quick add about +104 KB (CodeMirror +90 KB, chrono-node +14.5 KB). Both were measured on their own branches. Both load with the workspace page. Consider a dynamic import so the editors load when task detail or the composer first opens. Measure the combined build first, then measure again after the change.
