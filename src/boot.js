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

// The explore page is Thai; its way back follows the saved language.
let english = false;
try { english = localStorage.getItem('osd-demo-language') === 'en'; } catch {}
if (english) for (const el of document.querySelectorAll('[data-en]')) el.querySelector('span').textContent = el.dataset.en;

for (const anchor of document.querySelectorAll('a[href]')) {
  const href = anchor.getAttribute('href');
  if (href === '/' || href === '/explore') {
    const target = href === '/' ? '#showcase' : '#explore';
    anchor.href = target;
    anchor.addEventListener('click', event => { event.preventDefault(); location.hash = target; location.reload(); });
  }
}

await import('osd/viewer/main.js');
