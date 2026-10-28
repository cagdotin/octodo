import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The SQLite file in the octodo home whose exclusive transaction a server holds while it runs, as
 * the owner lock does for a workspace (decision 0003): the OS releases it when the server dies,
 * even on SIGKILL, so a `server.json` left by a dead server never blocks the next one.
 */
const SERVER_LOCK_FILE = ".server-lock";

const SQLITE_BUSY = 5;

/** Another server holds the home; `code` is what the desktop app's child reports. */
export class HomeTaken extends Error {
  readonly code = "OCTODO_HOME_TAKEN";
  constructor(home: string) {
    super(`Another octodo server runs for ${home}. Use it, or stop it first.`);
  }
}

/**
 * Claims `home` for this server, at once or not at all, so two servers started together cannot
 * both run there. Returns the release.
 */
export const claimHome = (home: string): (() => void) => {
  mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(join(home, SERVER_LOCK_FILE), { timeout: 0 });
  try {
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if ((error as { readonly errcode?: unknown }).errcode === SQLITE_BUSY)
      throw new HomeTaken(home);
    throw error;
  }
  return () => db.close();
};
