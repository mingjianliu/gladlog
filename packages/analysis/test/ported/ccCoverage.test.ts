import { ccSpellIds } from '../../src/data/spellTags';

test('ccSpellIds covers totem/stun CC that read as 0 in the meta-eval', () => {
  expect(ccSpellIds.has('192058')).toBe(true); // Capacitor Totem
});
