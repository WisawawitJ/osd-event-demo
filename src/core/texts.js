// The texts every part shares: the stories' bars and captions (story-bar.js).
import {addTexts} from './lang.js';

export * from './lang.js';
addTexts({
  next: ['ถัดไป', 'Next'],
  'story.play': ['เริ่มสาธิต', 'Play the story'],
  'story.pause': ['หยุดชั่วคราว', 'Pause'],
  'story.resume': ['เล่นต่อ', 'Resume'],
  'story.restart': ['เริ่มใหม่', 'Restart'],
  'story.exit': ['จบการสาธิต', 'Exit story'],
  'story.autoAdvance': ['เล่นอัตโนมัติ', 'Auto-advance'],
  'story.loop': ['เล่นวนซ้ำ', 'Loop'],
  'story.step': ['ขั้นที่ {n} / {total}', 'Step {n} / {total}'],
});
