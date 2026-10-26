### Visual parity

**You own pixel-exact equivalence. The baseline is the spec. You do not touch it.** Equivalence is verified by image diff, not by eye.

1. Establish the baseline first, before any migration: a script that screenshots the current component or view across its states (empty, populated, selected, dark and light theme), plus the target when matching two implementations. Drive the web app with your harness's browser tool or a scripted Playwright run against `pnpm dev:web`. No baseline, no parity claim.
2. Anti-shortcut clauses, stated and held: no harness modifications, no baseline tampering, no component restructuring to make a diff pass. If the baseline looks wrong, stop and ask, don't edit it.
3. Migrate one component at a time. Shared primitives (`apps/web/src/components/ui/`, theme tokens) migrate first as a blocking phase. Follow the **shadcn** skill for component work.
4. Verify each component against its baseline via image diff. A nonzero diff is a fail. Investigate the pixel delta. Repeat per component until the diff is zero.
5. Run **Opening a PR** per component or per safe batch, when the task asks for one.

**Reply:** components migrated, the diff result for each, the baseline harness location, what's left.
