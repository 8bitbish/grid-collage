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
