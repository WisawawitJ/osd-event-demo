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
// The street is set back from the gate: a short two-way entrance road links them, meeting the street at a T. A car
// waiting at the entry barrier stands wholly on it (its rear reaches 24.1; the street starts at 28), and each lane's
// cars drive down its middle (with the street right at the gate, the near lane ran close to the centre line to clear
// such a car's rear).
export const STREET = {north: 28, south: 35, centre: 31.5, laneEast: 29.75, laneWest: 33.25};
// The pavement along the street's kerb on the site's side; between it and the hedge, grass.
export const PAVEMENT = 3.2;
// Turns between the street and the entrance road: in from the near lane (left), in from the far lane (right, across the
// near lane; wider, so a car leaving for the far lane passes in front of one waiting there).
export const ENTRY_TURN = 4, FAR_TURN = 7;
// One barrier serves both directions, as on site: entry keeps left (west half), exit the east half.
export const GATE = {z: 19.3, west: -24.9, east: -18.5, entryX: -23, exitX: -20.2, entryStopZ: 21.9, exitStopZ: 16.6};
const P1_AISLE_X = -14.16;
const P2_ROWS = [
  {row: 'A', x: -28.5, nose: 1, aisleX: -34},
  {row: 'B', x: -39.5, nose: -1, aisleX: -34},
  {row: 'C', x: -44.5, nose: 1, aisleX: -50},
  {row: 'D', x: -55.5, nose: -1, aisleX: -50},
];

export function buildStalls() {
  const stalls = [];
  // P1, the row beside the building, is for VIPs only (its four staff bays only ever held VIPs: staff park in P2).
  for (let i = 0; i < 6; i++) {
    stalls.push({id: `P1-0${i + 1}`, zone: 'P1', row: 'P1', x: -19.66, z: -8.04 + 2.5 * i, nose: -1, aisleX: P1_AISLE_X, y: Y.site, reserved: 'vip'});
  }
  for (const r of P2_ROWS) {
    for (let i = 0; i < 11; i++) {
      stalls.push({id: `${r.row}${String(i + 1).padStart(2, '0')}`, zone: 'P2', row: r.row, x: r.x, z: -13.25 + 2.5 * i, nose: r.nose, aisleX: r.aisleX, y: Y.road, reserved: r.row === 'A' ? 'guest' : null});
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
