// The car park's plate camera card sits in the view's top-right corner, under what the corner shows (the room colours
// bar, the flight's status) or, when it shows nothing, level with the stop's title card (it waited below an empty gap),
// or below that card in a view too narrow for both side by side (on a phone it covered the title). The card's width:
// its own when shown, else what parking.css gives it.
export function placeCornerCard({stage, corner, titleCard, signal}) {
  // A title card hidden (the car park with the visitor's phone open) leaves the corner free: the card went below it
  // all the same, half-way down a narrow view.
  const place = () => {
    const v = stage.getBoundingClientRect(),
      c = corner.getBoundingClientRect(),
      t = titleCard.getBoundingClientRect();
    const card =
        document.querySelector('.pk-feed')?.offsetWidth || (innerWidth <= 1280 ? 270 : Math.min(330, v.width * 0.4)),
      beside = document.body.matches('.parking-active.phone-open') || t.right + 8 <= c.right - card;
    stage.style.setProperty(
      '--corner-free',
      `${Math.round((c.height >= 1 ? c.bottom + 8 : beside ? t.top : t.bottom + 8) - v.top)}px`,
    );
    stage.style.setProperty('--corner-right', `${Math.round(v.right - c.right)}px`);
  };
  const cornerSize = new ResizeObserver(place);
  cornerSize.observe(corner);
  cornerSize.observe(stage);
  cornerSize.observe(titleCard);
  signal.addEventListener('abort', () => cornerSize.disconnect(), {once: true});
  const bodyClass = new MutationObserver(place);
  bodyClass.observe(document.body, {attributes: true, attributeFilter: ['class']});
  signal.addEventListener('abort', () => bodyClass.disconnect(), {once: true});
}
