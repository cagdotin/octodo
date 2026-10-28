import { Context, Data, Duration, Effect, Scope, Semaphore } from "effect";
import { DatabaseSync } from "node:sqlite";

/**
 * The SQLite file in `.octodo/` whose exclusive transaction is the workspace's owner lock. The OS
 * releases the lock when its holder dies, even on SIGKILL. Its one row names the last holder.
 */
export const OWNER_LOCK_FILE = ".owner-lock";

/** Another octodo process held the owner lock for longer than this one waits. */
export class OwnerLockBusy extends Data.TaggedError("OwnerLockBusy")<{
  readonly waited: Duration.Duration;
}> {}

export class OwnerLockFailed extends Data.TaggedError("OwnerLockFailed")<{
  readonly cause: unknown;
}> {}

export interface OwnerLock {
  /**
   * Runs `effect` holding the owner lock, after `onNewHolder` when another holder had the lock
   * since this one, or this one never had it. A hold inside a hold runs in the outer one.
   */
  readonly hold: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | OwnerLockBusy | OwnerLockFailed, R>;
}

/** The holders of the locks the current fiber holds, so a hold inside a hold runs in the outer one. */
const Held = Context.Reference<ReadonlySet<string>>("octodo/OwnerLock/Held", {
  defaultValue: () => new Set(),
});

const SQLITE_BUSY = 5;

const isBusy = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly errcode?: unknown }).errcode === SQLITE_BUSY;

type Attempt = "held" | "busy" | "taken-over";

/**
 * One try at the lock as `holder`. Taking it from another holder writes `holder` into the row and
 * releases the lock again, so a crash during the hold that follows still tells the next holder.
 */
const attempt = (db: DatabaseSync, holder: string): Attempt => {
  try {
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    if (isBusy(error)) return "busy";
    throw error;
  }
  try {
    db.exec("CREATE TABLE IF NOT EXISTS holder (token TEXT NOT NULL)");
    const last = db.prepare("SELECT token FROM holder").get()?.["token"];
    if (last === holder) return "held";
    db.exec("DELETE FROM holder");
    db.prepare("INSERT INTO holder (token) VALUES (?)").run(holder);
    db.exec("COMMIT");
    return "taken-over";
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

/** The owner lock in `file`, opened on the first hold and closed with the scope. */
export const makeOwnerLock = (
  file: string,
  options: { readonly wait: Duration.Input; readonly onNewHolder: Effect.Effect<void> },
): Effect.Effect<OwnerLock, never, Scope.Scope> =>
  Effect.gen(function* () {
    const holder = crypto.randomUUID();
    const wait = Duration.fromInputUnsafe(options.wait);
    let db: DatabaseSync | undefined;
    /** Fibers of this process take turns: one connection holds one transaction at a time. */
    const turn = yield* Semaphore.make(1);
    yield* Effect.addFinalizer(() => Effect.sync(() => db?.close()));

    const tryOnce = Effect.try({
      try: () => attempt((db ??= new DatabaseSync(file, { timeout: 0 })), holder),
      catch: (cause) => new OwnerLockFailed({ cause }),
    });

    const release = Effect.sync(() => {
      try {
        db?.exec("COMMIT");
      } catch {
        db?.close();
        db = undefined;
      }
    });

    /** Takes the lock, waiting only in `restore`; returns whether another holder had it since. */
    const take = (restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const deadline = Date.now() + Duration.toMillis(wait);
        let newHolder = false;
        for (let pause = 1; ; pause = Math.min(pause * 2, 50)) {
          const result = yield* tryOnce;
          if (result === "held") return newHolder;
          if (result === "taken-over") {
            newHolder = true;
            continue;
          }
          if (Date.now() >= deadline) return yield* new OwnerLockBusy({ waited: wait });
          yield* restore(Effect.sleep(Duration.millis(pause)));
        }
      });

    const hold: OwnerLock["hold"] = (effect) =>
      Effect.gen(function* () {
        const held = yield* Held;
        if (held.has(holder)) return yield* effect;
        const inside = Effect.provideService(Held, new Set([...held, holder]));
        return yield* turn.withPermits(1)(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const newHolder = yield* take(restore);
              const run = newHolder ? Effect.andThen(options.onNewHolder, effect) : effect;
              return yield* restore(inside(run)).pipe(Effect.ensuring(release));
            }),
          ),
        );
      });

    return { hold };
  });
