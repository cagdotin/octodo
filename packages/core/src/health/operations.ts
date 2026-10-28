import { Cause, Effect } from "effect";
import type { Diagnostic, FixRequest } from "../domain.ts";
import { nextId, type State } from "../state.ts";
import { applyFix } from "./fixes.ts";

/**
 * Fixes, one at a time and each against a fresh scan, the problems `wanted` picks, trying each
 * problem once so a fix that does not take cannot loop.
 */
const fixWhere = (state: State, wanted: (diagnostic: Diagnostic) => boolean) =>
  state.write((files, ids) =>
    Effect.gen(function* () {
      const fixed: Array<Diagnostic> = [];
      const failed: Array<{ diagnostic: Diagnostic; error: string }> = [];
      const tried = new Set<string>();
      const key = (diagnostic: Diagnostic) =>
        JSON.stringify([diagnostic.kind, diagnostic.path, diagnostic.field]);
      while (true) {
        yield* state.storage.forget;
        const scan = yield* state.scan;
        const next = scan.snapshot.diagnostics.find(
          (diagnostic) =>
            diagnostic.fix !== null && wanted(diagnostic) && !tried.has(key(diagnostic)),
        );
        if (next === undefined) return { fixed, failed, diagnostics: scan.snapshot.diagnostics };
        tried.add(key(next));
        const exit = yield* Effect.exit(applyFix(files, scan, next, () => nextId(ids, scan)));
        if (exit._tag === "Success") fixed.push(next);
        else failed.push({ diagnostic: next, error: String(Cause.squash(exit.cause)) });
      }
    }),
  );

export const fixDiagnostic = (state: State, request: FixRequest) =>
  fixWhere(
    state,
    (diagnostic) =>
      diagnostic.path === request.path &&
      diagnostic.kind === request.kind &&
      diagnostic.fix?.action === request.action,
  );

export const fixAll = (state: State) =>
  fixWhere(state, (diagnostic) => diagnostic.fix?.inFixAll === true);
