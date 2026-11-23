// The tour's stops, each fact about one in one place.
// - panel, floor, chip: its texts (getters: they follow the TH/EN switch);
// - view: what the model shows there ('all', or one floor, whose rooms the room colours paint), cut at waist height or not;
// - level: where it lies, for flights (two stops on one level are a short step apart);
// - marker: the height of the ring that marks it in flight, from its camera target's height;
// - icon: its moments' on the timeline.
import {t} from 'osd/viewer/texts.js';

const stop = (id, facts) => ({
  cutaway: false,
  marker: () => 0.2,
  ...facts,
  get panel() {
    return t(`stop.${id}.panel`);
  },
  get floor() {
    return t(`stop.${id}.floor`);
  },
  get chip() {
    return t(`stop.${id}.chip`);
  },
});
export const stops = {
  overview: stop('overview', {view: 'all', level: null, icon: 'moon'}),
  meeting: stop('meeting', {view: '4', cutaway: true, level: 4, marker: (y) => y - 0.6, icon: 'users'}),
  pond: stop('pond', {view: '1', level: 1, icon: 'drop'}),
  energy: stop('energy', {view: 'all', level: 5, marker: () => 15.8, icon: 'sun'}),
  parking: stop('parking', {view: 'all', level: 'site', icon: 'car'}),
};
