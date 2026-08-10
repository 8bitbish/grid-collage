/* The app now opens on the projects list, so every test that wants the editor
   has to walk through it first — the same two taps a person makes. Installed
   as an init script so it also covers reloads, which the restore tests lean
   on: on a first load there is nothing in the list and it taps New, on a
   reload it taps the project that is already there.

   That second half never happened. It looked for `.project-open`, a class the
   app has never had — the cards are `.tile` — so the selector was always null
   and every reload fell through to New, quietly starting an empty project
   instead of reopening the one the test had just filled. Three tests were
   failing on it: they reloaded, waited for their own photos to come back, and
   waited out the timeout against a deck that no longer had any.

   The wait matters as much as the selector. `#btn-new` is in the static HTML
   and so is there on the first tick, while the projects list is read back
   asynchronously and its tiles are not — so a poll that takes whichever it
   finds takes New every time, however many projects there are. `#home-empty`
   is the signal to wait for: the app unhides it only after rendering the list,
   so it separates "no projects" from "the list has not arrived yet", which an
   empty grid on its own cannot. */
export async function autoEnter(p) {
  await p.addInitScript(() => {
    const go = () => {
      const since = performance.now();
      const tick = setInterval(() => {
        if (!document.body.classList.contains('on-home')) { clearInterval(tick); return; }

        const card = document.querySelector('#home-grid .tile');
        const empty = document.getElementById('home-empty');
        const listed = empty && !empty.hidden;
        // The deadline is a backstop for a homepage that renders neither, so a
        // test fails on its own assertion rather than on a spinning interval.
        const btn = card
          || (listed || performance.now() - since > 2000 ? document.getElementById('btn-new') : null);
        if (!btn) return;
        clearInterval(tick);
        btn.click();
      }, 40);
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', go);
    else go();
  });
}
