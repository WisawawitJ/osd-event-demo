// How finely the 3D view is drawn, by what the computer manages. Only ever coarser: stepping back up made the picture go
// sharp and soft while orbiting. Down to 1× of the page's pixels it goes while frames take longer than SLOW_MS; while
// they still do, what moves slowly is drawn less often (`light`); after that, below 1× only while frames take longer than
// CRAWL_MS (a screen that itself runs at 30 Hz is not slow, nor are light's 30 frames a second).
const SLOW_MS = 26,
  CRAWL_MS = 41,
  // How many slow frames before a step (a very slow one counts for up to MOST).
  FRAMES = 45,
  MOST = 6,
  STEPS = [0.8, 0.65, 0.5];

// `light`: the light page (the `light` option), or no graphics card in use: no smoothing of edges, 0.85×, at most 30 frames
// a second. `scale`: the test harness's own (its pages never step).
export function createQuality({devicePixels = 1, light = false, scale = 1, fixed = false}) {
  let ratio = light ? Math.min(devicePixels, 0.85) : Math.min(devicePixels, 1.5) * scale,
    isLight = light,
    slow = 0;
  function next() {
    if (ratio > 1) ratio = Math.max(1, ratio - 0.25);
    else if (!isLight) isLight = true;
    else ratio = STEPS.find((step) => step < ratio) ?? ratio;
  }
  return {
    get ratio() {
      return ratio;
    },
    // While the camera flies (motion hides the softness).
    get motionRatio() {
      return Math.max(Math.min(0.6 * scale, ratio), ratio * 0.7);
    },
    get light() {
      return isLight;
    },
    // A frame came `ms` after it was asked for (not after the last one: an idle pause is not a slow frame, and a computer
    // that takes 300 ms a frame is slow). Returns whether it was one slow frame too many: draw by what is said here now.
    frame(ms) {
      if (fixed) return false;
      const limit = ratio > 1 || !isLight ? SLOW_MS : CRAWL_MS;
      slow = ms > limit ? slow + Math.min(MOST, ms / limit) : Math.max(0, slow - 1);
      if (slow <= FRAMES) return false;
      slow = 0;
      const before = ratio,
        was = isLight;
      next();
      return ratio !== before || isLight !== was;
    },
  };
}

// The browser draws WebGL on the processor (no graphics card, or hardware acceleration off).
export function drawsInSoftware() {
  const gl = document.createElement('canvas').getContext('webgl2', {failIfMajorPerformanceCaveat: true});
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return !gl;
}
