import { answerKey, normalizeAnswer, sha256Hex } from '../src/learning/answerKey';

// The same vectors as backend/tests/test_learning_api.py: the app and the backend agree on every key.
test('the answer keys match the backend', () => {
  expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(answerKey('turn-0001-abcdef', 'cat')).toBe('4f65fd689c5f51be');
  expect(answerKey('turn-0001-abcdef', '  Cat. ')).toBe('4f65fd689c5f51be');
  expect(answerKey('t-x', 'Don’t   worry!')).toBe('16d4547551c484cc');
  expect(answerKey('turn-0002-abcdef', 'get something off your chest')).toBe('8616050c28c2a7d8');
  expect(normalizeAnswer('  Hello,  World! ')).toBe('hello, world');
});
