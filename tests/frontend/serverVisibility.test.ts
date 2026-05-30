import {
  getServerVisibilityDisplay,
  getServerVisibilityOptions,
  normalizeServerVisibility,
} from '../../frontend/src/utils/serverVisibility';

const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key;

describe('serverVisibility', () => {
  it('defaults missing visibility values to private labels', () => {
    expect(normalizeServerVisibility(undefined)).toBe('private');

    expect(getServerVisibilityDisplay(t, undefined)).toEqual({
      value: 'private',
      shortLabel: 'Private',
      longLabel: 'Private — only the owner and admins',
      className: 'bg-[var(--hub-bg-2)] text-[var(--hub-ink-2)] border-[var(--hub-line-2)]',
    });
  });

  it('only exposes the reserved group option when the current visibility is group', () => {
    expect(getServerVisibilityOptions(t, 'public')).toEqual([
      { value: 'private', label: 'Private', disabled: false },
      { value: 'public', label: 'Public', disabled: false },
    ]);

    expect(getServerVisibilityOptions(t, 'group')).toEqual([
      { value: 'private', label: 'Private', disabled: false },
      { value: 'group', label: 'Group', disabled: true },
      { value: 'public', label: 'Public', disabled: false },
    ]);
  });
});
