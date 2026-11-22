// Picks the page from the URL hash, puts its markup in place, then starts the viewer.
// #explore → free exploration; anything else → the guided showcase.
const pages = {
  showcase: {file: './pages/showcase.html', bodyClass: 'showcase-page'},
  explore: {file: './pages/explore.html', bodyClass: ''},
};

const mode = location.hash === '#explore' ? 'explore' : 'showcase';
const page = pages[mode];
document.body.className = page.bodyClass;
document.getElementById('app').innerHTML = await (await fetch(new URL(page.file, import.meta.url))).text();

for (const anchor of document.querySelectorAll('a[href]')) {
  const href = anchor.getAttribute('href');
  if (href === '/' || href === '/explore') {
    const target = href === '/' ? '#showcase' : '#explore';
    anchor.href = target;
    anchor.addEventListener('click', event => { event.preventDefault(); location.hash = target; location.reload(); });
  }
}
// Back and Forward between the two pages change only the hash: the page follows (the old one stayed on screen).
addEventListener('hashchange', () => { if ((location.hash === '#explore' ? 'explore' : 'showcase') !== mode) location.reload(); });

// The explore page has no story or idle return of its own: left alone for the showcase's quiet minute, it goes back to
// the showcase, so a booth screen never stays on it. (Not on stepped pages, the screenshots: real time means nothing there.)
if (mode === 'explore') {
  const [{IDLE_MS}, {options}] = await Promise.all([import('osd/viewer/director.js'), import('osd/parking/options.js')]);
  if (!('manual' in options)) {
    let idle = 0;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { location.hash = '#showcase'; }, IDLE_MS); };
    for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, arm, {capture: true});
    arm();
  }
}
await import('osd/viewer/main.js');
