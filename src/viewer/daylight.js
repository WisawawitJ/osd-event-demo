// Sky and sun for a time of day, read from the world clock (src/parking/clock.js). Bangkok in late November:
// sunrise about 06:20, sunset about 17:55. Daylight fades in and out over 40 minutes either side of them, with a
// warm low sun near the horizon; at night a dim blue moonlight stays where the noon sun is.
import * as THREE from 'osd/node_modules/three/build/three.module.js';

export const SUNRISE = 380, SUNSET = 1075;
// Room lights, car-park lamps and the page's night styling come on shortly after sunset and go off before sunrise.
export const isDark = minute => minute < SUNRISE - 10 || minute >= SUNSET + 10;

const TWILIGHT = 40;
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const NOON = new THREE.Vector3(-18, 35, 28), NOON_LENGTH = NOON.length();
const NOON_HEADING = Math.atan2(NOON.z, NOON.x), NOON_ELEVATION = Math.asin(NOON.y / NOON_LENGTH);
const DAY = {sky: 0xebf6ff, ground: 0x7b8066, key: 0xffe7ba, fill: 0xc9e2ed}, NIGHT = {sky: 0x7d93b0, key: 0xb7d4ff}, LOW_SUN = 0xffad70;
const color = new THREE.Color(), other = new THREE.Color();

// How much daylight there is (0 night … 1 full day) and how high the sun is (0 horizon … 1 noon).
export function sunAt(minute) {
  const light = Math.min(smooth((minute - SUNRISE + TWILIGHT) / (2 * TWILIGHT)), smooth((SUNSET + TWILIGHT - minute) / (2 * TWILIGHT)));
  const along = (minute - SUNRISE) / (SUNSET - SUNRISE);
  const height = along > 0 && along < 1 ? Math.sin(Math.PI * along) : 0;
  return {light, height, along: Math.min(1, Math.max(0, along))};
}

// Applies the sky for `minute` to the scene's lights. `dayBackground` is the page's daytime background colour.
export function applySky({minute, scene, renderer, hemisphere, key, fill, dayBackground}) {
  const {light, height, along} = sunAt(minute);
  const low = light * (1 - smooth(height / .45)); // golden hour: daylight with the sun still low
  // The sun crosses from one side (morning) to the other (evening), highest at noon where the old fixed light was.
  const heading = NOON_HEADING + (along - .5) * 2.4, elevation = light > 0 ? THREE.MathUtils.lerp(.1, NOON_ELEVATION, height) : NOON_ELEVATION * .8;
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
