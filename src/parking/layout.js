// Car-park layout in world metres, after main.js centres the building model.
// P1 is the building's own 6-bay lot beside it (positions from the building model's parking area).
// P2, the street, the driveway and the gate are imagined for the demo.

export const SITE = {west: -23.9, east: 23.9, south: 13.1};
// site: top of the building model's car-park paving; road: the street and the imagined lot.
export const Y = {site: 0.51, road: 0.3};
// The building's covered aisle (P1) meets the driveway on a ramp across its whole mouth.
export const RAMP = {west: -22.46, east: -11.16, north: 13.07, south: 14.6};

// The driveway runs along the site's south edge and links the gate, the covered aisle and P2.
export const DRIVE = {z: 16.2, north: 13.1, south: 19.3, west: -58, east: -11.2};
// A car waiting at the entry barrier is longer than the room between the arm and the road: its rear reaches 24.1, so
// the near (eastbound) lane runs at 25.1, clear of it. The centre line sits 0.5 m south of the street's middle so that
// lane is the wider one (4 m against 3) and its cars keep half a metre off the line (at the middle they drove on it);
// the far (westbound) lane runs in the middle of its own half.
export const STREET = {north: 22.5, south: 29.5, centre: 26.5, laneEast: 25.1, laneWest: 28};
// One barrier serves both directions, as on site: entry keeps left (west half), exit the east half.
export const GATE = {z: 19.3, west: -24.9, east: -18.5, entryX: -23, exitX: -20.2, entryStopZ: 21.9, exitStopZ: 16.6};
const P1_AISLE_X = -14.16;
const P2_AISLES = {A: -34, B: -34, C: -50, D: -50};
const P2_ROWS = [
  {row: 'A', x: -28.5, nose: 1},
  {row: 'B', x: -39.5, nose: -1},
  {row: 'C', x: -44.5, nose: 1},
  {row: 'D', x: -55.5, nose: -1},
];

export function buildStalls() {
  const stalls = [];
  // P1, the row beside the building, is for VIPs only (its four staff bays only ever held VIPs: staff park in P2).
  for (let i = 0; i < 6; i++) {
    stalls.push({id: `P1-0${i + 1}`, zone: 'P1', row: 'P1', x: -19.66, z: -8.04 + 2.5 * i, nose: -1, aisleX: P1_AISLE_X, y: Y.site, reserved: 'vip'});
  }
  for (const r of P2_ROWS) {
    for (let i = 0; i < 11; i++) {
      stalls.push({id: `${r.row}${String(i + 1).padStart(2, '0')}`, zone: 'P2', row: r.row, x: r.x, z: -13.25 + 2.5 * i, nose: r.nose, aisleX: P2_AISLES[r.row], y: Y.road, reserved: r.row === 'A' ? 'guest' : null});
    }
  }
  return stalls;
}

// Ground height under a point: the site slab is 0.21 m above the street, with a short ramp at the aisle mouth.
export function groundY(x, z) {
  if (x > SITE.west && z < SITE.south) return Y.site;
  if (x > RAMP.west && x < RAMP.east && z >= RAMP.north && z < RAMP.south) return Y.site - (z - RAMP.north) / (RAMP.south - RAMP.north) * (Y.site - Y.road);
  return Y.road;
}
