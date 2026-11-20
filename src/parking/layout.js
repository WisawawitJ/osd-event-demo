// Car-park layout in world metres, after main.js centres the building model.
// P1 is the building's own 6-stall covered lot (from model/parking-layout.json).
// P2, the street, the driveway and the gate are imagined for the demo.

export const SITE = {west: -23.9, south: 13.1};
export const Y = {site: 0.56, road: 0.3};

// The driveway runs along the site's south edge and links the gate, the covered aisle and P2.
export const DRIVE = {z: 16.2, north: 13.1, south: 19.3, west: -58, east: -11.2};
export const STREET = {north: 22.5, south: 29.5, laneEast: 24.5, laneWest: 27.5};
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
  for (let i = 0; i < 6; i++) {
    stalls.push({id: `P1-0${i + 1}`, zone: 'P1', row: 'P1', x: -19.66, z: -8.04 + 2.5 * i, nose: -1, aisleX: P1_AISLE_X, y: Y.site, reserved: i < 2 ? 'vip' : 'staff'});
  }
  for (const r of P2_ROWS) {
    for (let i = 0; i < 11; i++) {
      stalls.push({id: `${r.row}${String(i + 1).padStart(2, '0')}`, zone: 'P2', row: r.row, x: r.x, z: -13.25 + 2.5 * i, nose: r.nose, aisleX: P2_AISLES[r.row], y: Y.road, reserved: r.row === 'A' ? 'guest' : null});
    }
  }
  return stalls;
}

// Ground height under a point: the site slab is 0.26 m above the street, with a short ramp at the aisle mouth.
export function groundY(x, z) {
  if (x > SITE.west && z < SITE.south) return Y.site;
  if (x > -17.4 && x < -10.9 && z >= SITE.south && z < SITE.south + 1.6) return Y.site - (z - SITE.south) / 1.6 * (Y.site - Y.road);
  return Y.road;
}
