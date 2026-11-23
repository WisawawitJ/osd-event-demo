// The tour's stops, each fact about one in one place.
// - panel, floor, chip: its texts (getters: they follow the TH/EN switch);
// - view: what the model shows there ('all', or one floor, whose rooms the room colours paint), with all `below` it or
//   not, cut at waist height or not;
// - devices: the rooms whose ceiling lights and AC show, where the ceilings are off (the others would hang in the air);
// - level: where it lies, for flights (two stops on one level are a short step apart);
// - marker: the height of the ring that marks it in flight, from its camera target's height;
// - icon: its moments' on the timeline.
import {t} from 'osd/viewer/texts.js';
import {MEETING_ROOM} from 'osd/viewer/building.js';

const stop = (id, facts) => ({
  below: false,
  cutaway: false,
  devices: null,
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
  meeting: stop('meeting', {
    view: '4',
    below: true,
    cutaway: true,
    devices: [MEETING_ROOM],
    level: 4,
    marker: (y) => y - 0.6,
    icon: 'users',
  }),
  pond: stop('pond', {view: '1', devices: [], level: 1, icon: 'drop'}),
  energy: stop('energy', {view: 'all', level: 5, marker: () => 15.8, icon: 'sun'}),
  parking: stop('parking', {view: 'all', level: 'site', icon: 'car'}),
};
