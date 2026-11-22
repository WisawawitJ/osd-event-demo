// Node unit tests: the browser globals the parking modules touch when they load, and the page's import map
// ("osd/…" paths) for Node. Loaded with `node --import ./test/unit/setup.mjs`.
import {registerHooks} from 'node:module';

// A canvas that draws nothing (cars paint their plates on one): any call or property on its 2D context gives the same
// stand-in back (gradients, patterns), and measureText a width.
const context = new Proxy(function () {}, {get: (_, k) => (k === 'measureText' ? () => ({width: 0}) : k === Symbol.toPrimitive ? () => 0 : context), apply: () => context, set: () => true});
const canvas = () => ({width: 0, height: 0, style: {}, getContext: () => context, toDataURL: () => ''});
globalThis.document ??= {documentElement: {}, createElement: tag => (tag === 'canvas' ? canvas() : {style: {}})};
// Node's own localStorage warns unless given a file: a plain in-memory one instead.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)}});

// The page's import map: "osd/viewer/…" and "osd/parking/…" are src/, "osd/node_modules/three/…" vendor/three.
const root = new URL('../../', import.meta.url);
const MAP = [['osd/viewer/', 'src/viewer/'], ['osd/parking/', 'src/parking/'], ['osd/node_modules/three/', 'vendor/three/']];
registerHooks({
  resolve(specifier, context, next) {
    for (const [from, to] of MAP) if (specifier.startsWith(from)) return next(new URL(to + specifier.slice(from.length), root).href, context);
    return next(specifier, context);
  },
});
