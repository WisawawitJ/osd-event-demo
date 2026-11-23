// The building's facts that more than one module needs.

// The meeting room the demo tells of ("Meeting room 2, floor 4"), by its device-map id, and how many people meet there.
export const MEETING_ROOM = 'f4_meeting_2';
// Its chairs, as the model has them, in the floor's own space: three on each side of the table, facing it.
export const SEATS = [10.41, 9.32, 8.23].flatMap((z) => [
  {x: -5.06, z, yaw: Math.PI / 2},
  {x: -2.95, z, yaw: -Math.PI / 2},
]);
export const MEETING_PEOPLE = SEATS.length;
export const peopleIn = (occupied) => (occupied ? MEETING_PEOPLE : 0);
// The pond's water, in %: as it should be, run low, and the level under which an alert goes up.
export const WATER = {normal: 82, low: 58, alert: 65};
// The meeting room's air, in °C: as a meeting starts, and what its AC has brought it to when the demo's cooling ends.
export const COOLING = {from: 27.4, to: 24.8, seconds: 12};
// The solar panels, in kW: under a clear sky and a clouded one; under `low` the energy stop's button brings the sun back.
export const SOLAR = {clear: 8.4, cloudy: 3.1, low: 5};
// The building draws at least this much more than the panels make (it takes all they make).
export const loadFor = (load, solar) => Math.max(load, solar + 0.5);
// Room colours: below `warm` a room's air is comfortable, below `cool` cold.
export const AIR = {cool: 25, warm: 27};
// Night and Day (the header's button): the minutes of the day they move the clock on to.
export const NIGHT_AT = 20 * 60,
  DAY_AT = 7 * 60 + 30;
