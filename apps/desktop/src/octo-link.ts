/**
 * Puts the `octo` the app ships on the PATH (decision 0029): an app installed in an Applications
 * folder links `~/.local/bin/octo` to it, unless an octo that works is already there.
 */
import { access, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Whether `bundle` is installed, rather than run from a download or a test folder. */
export const isInstalled = (bundle: string, home: string) =>
  [join(home, "Applications"), "/Applications"].includes(dirname(bundle));

/**
 * Links `<home>/.local/bin/octo` to the app's `octo` when no octo is there, or the one there is a
 * link to an app that is gone. Any other octo (a checkout's `bin/octo`, a file) is left alone.
 */
export const linkOcto = async (bundle: string, home: string) => {
  const link = join(home, ".local/bin/octo");
  const present = await lstat(link).then(
    () => true,
    () => false,
  );
  const works = await access(link).then(
    () => true,
    () => false,
  );
  if (works) return;
  if (present) await rm(link);
  await mkdir(dirname(link), { recursive: true });
  await symlink(join(bundle, "Contents/Resources/bin/octo"), link);
};
