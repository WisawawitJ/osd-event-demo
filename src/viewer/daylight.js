// Sky and sun for a time of day, read from the world clock (src/parking/clock.js). Bangkok in late November:
// sunrise about 06:20, sunset about 17:55. Daylight fades in and out over 40 minutes either side of them, with a
// warm low sun near the horizon, and a dim blue moonlight at night.
// The one shadow-casting light moves on a single closed path through the 24 hours, so shadows never jump (not at
// dusk, dawn or midnight): its heading turns a full circle a day, and its height is the sun's, mirrored above the
// horizon at night (the moon), never lower than LOWEST so shadows stay a sensible length.
import * as THREE from 'osd/node_modules/three/build/three.module.js';

export const SUNRISE = 380, SUNSET = 1075;
// Room lights, car-park lamps and the page's night styling come on shortly after sunset and go off before sunrise.
export const isDark = minute => minute < SUNRISE - 10 || minute >= SUNSET + 10;

const TWILIGHT = 40;
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const NOON = new THREE.Vector3(-18, 35, 28), NOON_LENGTH = NOON.length();
const NOON_HEADING = Math.atan2(NOON.z, NOON.x), NOON_ELEVATION = Math.asin(NOON.y / NOON_LENGTH);
const SOLAR_NOON = (SUNRISE + SUNSET) / 2, LOWEST = .3; // radians, about 17°
// The sun's elevation through the day: a cosine around solar noon, at NOON_ELEVATION then and zero at sunrise and sunset.
const DIP = Math.cos(Math.PI * (SUNSET - SUNRISE) / 1440), SWING = NOON_ELEVATION / (1 - DIP);
const elevationAt = minute => SWING * (Math.cos(2 * Math.PI * (minute - SOLAR_NOON) / 1440) - DIP);
const DAY = {sky: 0xebf6ff, ground: 0x7b8066, key: 0xffe7ba, fill: 0xc9e2ed}, NIGHT = {sky: 0x7d93b0, key: 0xb7d4ff}, LOW_SUN = 0xffad70;
const color = new THREE.Color(), other = new THREE.Color();

// How much daylight there is (0 night … 1 full day) and how high the sun is (0 horizon or below … 1 noon).
export function sunAt(minute) {
  const light = Math.min(smooth((minute - SUNRISE + TWILIGHT) / (2 * TWILIGHT)), smooth((SUNSET + TWILIGHT - minute) / (2 * TWILIGHT)));
  return {light, height: Math.max(0, elevationAt(minute)) / NOON_ELEVATION};
}

// Applies the sky for `minute` to the scene's lights. `dayBackground` is the page's daytime background colour.
export function applySky({minute, scene, renderer, hemisphere, key, fill, dayBackground}) {
  const {light, height} = sunAt(minute);
  const low = light * (1 - smooth(height / .45)); // golden hour: daylight with the sun still low
  // Highest at noon, where the old fixed light was; the heading turns once a day, so 23:59 and 00:00 are neighbours.
  const heading = NOON_HEADING + 2 * Math.PI * (minute - SOLAR_NOON) / 1440, elevation = Math.max(LOWEST, Math.abs(elevationAt(minute)));
  key.position.set(Math.cos(heading) * Math.cos(elevation), Math.sin(elevation), Math.sin(heading) * Math.cos(elevation)).multiplyScalar(NOON_LENGTH);
  key.intensity = THREE.MathUtils.lerp(.24, 3.2 * (.45 + .55 * smooth(height / .6)), light);
  key.color.set(DAY.key).lerp(other.set(LOW_SUN), low).lerp(other.set(NIGHT.key), 1 - light);
  hemisphere.intensity = THREE.MathUtils.lerp(.36, 1.05, light);
  hemisphere.color.set(DAY.sky).lerp(other.set(0xffd2b0), low * .6).lerp(other.set(NIGHT.sky), 1 - light);
  fill.intensity = THREE.MathUtils.lerp(.09, .6, light);
  scene.environmentIntensity = THREE.MathUtils.lerp(.16, .65, light);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.05, 1, light);
  color.set(dayBackground).lerp(other.set('#efcfb4'), low * .8).lerp(other.set('#182b3c'), 1 - light);
  scene.background.copy(color);
}
