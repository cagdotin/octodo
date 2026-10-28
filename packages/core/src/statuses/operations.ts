import { Effect } from "effect";
import { DEFAULT_STATUSES, type ReorderStatusesInput } from "../domain.ts";
import { invalid, storageError, type State } from "../state.ts";
import { reorderedStatuses, statusOrderError } from "./statuses.ts";

export const reorderStatuses = (state: State, input: ReorderStatusesInput) =>
  state.write((files) =>
    Effect.gen(function* () {
      const { snapshot } = yield* state.scan;
      const refused = statusOrderError(snapshot.statuses, input.order);
      if (refused !== null) return yield* invalid(refused);
      yield* files
        .editConfig((config) => ({
          statuses: reorderedStatuses(config.statuses ?? DEFAULT_STATUSES, input.order),
        }))
        .pipe(storageError("Could not reorder the statuses"));
      return (yield* state.scan).snapshot.statuses;
    }),
  );
