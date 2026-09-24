/* Where things are, worked out rather than written down.
 *
 * All 37 tests hardcoded three paths belonging to the container they were
 * written in: a Chromium build number, this repository's checkout location, and
 * a screenshot directory in a scratch space that no longer exists. That is why
 * the suite could not run from a clone, and why moving it here was not enough
 * on its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// One level up from this file, whatever the person cloning called the
// directory they cloned into.
export const ROOT = path.resolve(import.meta.dirname, '..');

// Screenshots land inside the suite, and tests/.gitignore already keeps them
// out. Worth knowing why the old path was worse than a wrong path: Playwright
// creates a screenshot's parent directory on demand, so writing to a dead
// scratch directory failed silently rather than loudly. The tests passed and
// quietly littered another session's disk.
export const SHOTS = path.join(import.meta.dirname, 'shots');

// Chromium, in the order worth trying.
//
// The build number is searched for rather than pinned because the two halves
// disagree: this container ships chromium-1194, while the npm package expects
// 1234 and refuses the browser sitting right next to it. Pinning either number
// breaks the other machine, so neither is written down.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(base)) {
    // Highest build first, so a container with two of them uses the newer.
    const builds = fs.readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of builds) {
      const exe = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }

  // Nothing preinstalled to point at. Undefined is not a failure: it hands the
  // question back to Playwright, which is the right answer on a machine where
  // `npx playwright install` has been run and the wrong one nowhere.
  return undefined;
}

export const CHROME = findChrome();

// An old build of the app, checked out of the history into tests/.oldver/<sha>
// the first time it is asked for and kept after, for the tests that install one
// and then deploy over it. Both of those read /tmp/oldver/<sha> once, a
// directory nothing created: the old build 404'd, nothing was ever installed,
// and the upgrade each one checks then passed against a fresh install of the
// new build — update-path was fixed for it first and freshness went on doing
// it, which is why this is in one place now.
//
// Unpacked beside the target and renamed into place, so two tests asking for
// the same build at once never read one half-written.
export function oldBuild(sha) {
  const dir = path.join(import.meta.dirname, '.oldver', sha);
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  // A shallow clone — which is what CI checks out unless told otherwise — has
  // none of these, and git archive's own error does not say so.
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    throw new Error(`${sha} is not in this clone's history — a shallow clone? `
      + 'CI needs fetch-depth: 0 on its checkout');
  }
  const tmp = `${dir}.${process.pid}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // Two processes rather than a shell pipeline, so a failure names itself.
  const tar = execFileSync('git', ['archive', '--format=tar', sha], { cwd: ROOT, maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', tmp], { input: tar, maxBuffer: 1 << 28 });
  try { fs.renameSync(tmp, dir); } catch { fs.rmSync(tmp, { recursive: true, force: true }); }
  return dir;
}
