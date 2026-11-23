// The `fps` option: how many frames per second the 3D view actually draws (for checking the event laptop).
export function createFpsMeter() {
  const el = Object.assign(document.createElement('div'), {
    style:
      'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 8px;border-radius:6px;background:#0f1720cc;color:#9ff0b5;font:12px/1.4 ui-monospace,monospace;pointer-events:none',
  });
  document.body.append(el);
  let frames = 0,
    since = performance.now();
  return () => {
    frames++;
    const now = performance.now();
    if (now - since >= 1000) {
      el.textContent = `${Math.round((frames * 1000) / (now - since))} fps`;
      frames = 0;
      since = now;
    }
  };
}
