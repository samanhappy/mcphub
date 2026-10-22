import { matchesNamePattern } from '../../src/utils/namePattern.js';

it.each([
  ['get_a', 'get_*', true],
  ['get_', 'get_*', true],
  ['get_a', 'get_?', true],
  ['get_ab', 'get_?', false],
  ['Get_a', 'get_*', false],
  ['xget_a', 'get_*', false],
  ['a.b[0]', 'a.b[0]', true],
  ['axb0', 'a.b[0]', false],
  ['anything', '*', true],
  ['ababa', '*ab*a', true],
  ['ababa', '*ab*z', false],
  ['', '**', true],
  ['', '?', false],
])('matches %s against %s: %s', (name, pattern, expected) => {
  expect(matchesNamePattern(name, pattern)).toBe(expected);
});
