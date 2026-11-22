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
    // Not while the kiosk runs: the explore page has no kiosk, and a reload loses one switched on by its checkbox.
    anchor.addEventListener('click', event => { event.preventDefault(); if (document.body.classList.contains('kiosk-on')) return; location.hash = target; location.reload(); });
  }
}
// Back and Forward between the two pages change only the hash: the page follows (the old one stayed on screen).
addEventListener('hashchange', () => { if ((location.hash === '#explore' ? 'explore' : 'showcase') !== mode) location.reload(); });

await import('osd/viewer/main.js');
