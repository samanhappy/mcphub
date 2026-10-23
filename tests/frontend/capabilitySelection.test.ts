import {
  applyVisibleSelection,
  classifyTool,
  filterCapabilities,
} from '../../frontend/src/utils/capabilitySelection';

describe('capability bulk selection', () => {
  it('changes only visible items and preserves unavailable saved selections', () => {
    expect(applyVisibleSelection(['a', 'missing'], ['a', 'b', 'c'], ['b'], 'select')).toEqual([
      'a',
      'missing',
      'b',
    ]);
    expect(applyVisibleSelection('all', ['a', 'b', 'c'], ['b'], 'deselect')).toEqual(['a', 'c']);
    expect(applyVisibleSelection(['a', 'c'], ['a', 'b', 'c'], ['a', 'b'], 'invert')).toEqual([
      'c',
      'b',
    ]);
    expect(applyVisibleSelection('all', ['a'], [], 'invert')).toBe('all');
    expect(applyVisibleSelection([], ['a'], ['a'], 'select')).toEqual(['a']);
  });
  it('searches names and descriptions case-insensitively and intersects explicit annotation hints', () => {
    const items = [
      { value: 'get_a', description: 'Workspace', annotations: { readOnlyHint: true } },
      { value: 'get_b' },
      { value: 'delete', annotations: { readOnlyHint: 'true' } },
    ];
    expect(filterCapabilities(items, 'WORKSPACE', 'all')).toEqual([items[0]]);
    expect(filterCapabilities(items, 'get', 'readOnlyHint')).toEqual([items[0]]);
    expect(filterCapabilities(items, '', 'readOnlyHint')).toEqual([items[0]]);
    expect(filterCapabilities(items, 'no-match', 'all')).toEqual([]);
  });
  it('gives annotations precedence and keeps ambiguous destructive hints unclassified', () => {
    expect(classifyTool({ value: 'delete_data', annotations: { readOnlyHint: true } })).toBe(
      'read',
    );
    expect(classifyTool({ value: 'get_data', annotations: { destructiveHint: true } })).toBe(
      'other',
    );
    expect(classifyTool({ value: 'get_data', annotations: { readOnlyHint: false } })).toBe('other');
    expect(classifyTool({ value: 'create_item' })).toBe('create');
    expect(classifyTool({ value: 'update_item' })).toBe('update');
    expect(classifyTool({ value: 'delete_item' })).toBe('delete');
    expect(classifyTool({ value: 'get_item' })).toBe('read');
    expect(classifyTool({ value: 'set_item', annotations: { destructiveHint: false } })).toBe(
      'update',
    );
  });
});
