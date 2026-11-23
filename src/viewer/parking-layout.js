// The car park's layout (a wider panel, a taller view, no timeline) changes as one short animation, a view transition:
// the 3D view, the dock and the panel move to their new size and place while the rest cross-fades. Switched in one
// frame, the whole page jumped and the 3D picture zoomed by about 8% just as the camera set off. A switch asked for
// while one is still running waits for it, then goes to the layout wanted last: cutting one short made the page
// jump to its end and flash.
export function createParkingLayout({parking, instant, disposed}) {
  let layoutWanted = false,
    layoutChange = null;
  return function setParkingLayout(on) {
    if (!parking) return;
    layoutWanted = on;
    if (!on) parking.stopStory(); // leaving: the story drives the camera, so it stops at once; the layout follows
    if (layoutChange || parking.active === on) return;
    const apply = () => {
      if (parking.active !== layoutWanted) {
        if (layoutWanted) parking.enter();
        else parking.exit();
      }
    };
    if (!document.startViewTransition || instant()) {
      apply();
      return;
    }
    let done = false;
    const transition = (layoutChange = document.startViewTransition(() => {
      done = true;
      apply();
    }));
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => {
        layoutChange = null;
        if (!disposed() && parking.active !== layoutWanted) setParkingLayout(layoutWanted);
      });
    // The animation starts at the browser's next frame; if that is slow to come, the layout changes without it.
    setTimeout(() => {
      if (!done) transition.skipTransition();
    }, 250);
  };
}
