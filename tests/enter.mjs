/* The app now opens on the projects list, so every test that wants the editor
   has to walk through it first — the same two taps a person makes. Installed
   as an init script so it also covers reloads, which the restore tests lean
   on: on a first load there is nothing in the list and it taps New, on a
   reload it taps the project that is already there. */
export async function autoEnter(p) {
  await p.addInitScript(() => {
    const go = () => {
      const tick = setInterval(() => {
        if (!document.body.classList.contains('on-home')) { clearInterval(tick); return; }
        const card = document.querySelector('.project-open');
        const btn = card || document.getElementById('btn-new');
        if (!btn) return;
        clearInterval(tick);
        btn.click();
      }, 40);
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', go);
    else go();
  });
}
