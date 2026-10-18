import { nextHiddenParams } from '../../frontend/src/utils/hiddenParams';

describe('nextHiddenParams', () => {
  const properties = ['url', 'raw', 'max_length', 'start_index'];
  const required = ['url'];

  it('adds a parameter when unchecked and removes it when checked', () => {
    expect(nextHiddenParams(['raw'], 'max_length', false, properties, required)).toEqual([
      'raw',
      'max_length',
    ]);
    expect(nextHiddenParams(['raw', 'max_length'], 'raw', true, properties, required)).toEqual([
      'max_length',
    ]);
  });

  it('drops required and unknown names stored elsewhere', () => {
    expect(
      nextHiddenParams(['raw', 'url', 'gone'], 'start_index', false, properties, required),
    ).toEqual(['raw', 'start_index']);
  });
});
