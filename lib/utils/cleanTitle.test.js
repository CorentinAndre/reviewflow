'use strict';

const cleanTitle = require('./cleanTitle');

it('should clean dash before ONK', () => {
  expect(cleanTitle('feat: add something - ONK-1234')).toBe(
    'feat: add something ONK-1234'
  );
});

it('should clean space before ONK', () => {
  expect(cleanTitle('feat: add something   ONK-1234')).toBe(
    'feat: add something ONK-1234'
  );
});

it('should clean dash and space before ONK', () => {
  expect(cleanTitle('feat: add something  -  ONK-1234')).toBe(
    'feat: add something ONK-1234'
  );
});

it('should clean uppercase and slash', () => {
  expect(cleanTitle('Feat/add something')).toBe('feat: add something');
});

it('should write correct revert', () => {
  expect(
    cleanTitle('Revert "chore(deps): update node.js to v8.14 (#296)"')
  ).toBe('revert: chore(deps): update node.js to v8.14');
});