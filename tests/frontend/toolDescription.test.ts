import { getToolDescriptionInfo } from '../../frontend/src/utils/toolDescription';

describe('getToolDescriptionInfo', () => {
  it('marks manually overridden descriptions and preserves the upstream default text', () => {
    expect(
      getToolDescriptionInfo(
        {
          description: 'Custom current conditions lookup',
          defaultDescription: 'Fetch current conditions',
          hasDescriptionOverride: true,
        },
        'No description available',
      ),
    ).toEqual({
      currentDescription: 'Custom current conditions lookup',
      defaultDescription: 'Fetch current conditions',
      hasDescriptionOverride: true,
    });
  });

  it('keeps the original default visible even when the manual override is blank', () => {
    expect(
      getToolDescriptionInfo(
        {
          description: '',
          defaultDescription: 'Fetch fallback conditions',
          hasDescriptionOverride: true,
        },
        'No description available',
      ),
    ).toEqual({
      currentDescription: 'No description available',
      defaultDescription: 'Fetch fallback conditions',
      hasDescriptionOverride: true,
    });
  });

  it('does not expose default description metadata when there is no override', () => {
    expect(
      getToolDescriptionInfo(
        {
          description: 'Fetch current conditions',
          defaultDescription: 'Fetch current conditions',
          hasDescriptionOverride: false,
        },
        'No description available',
      ),
    ).toEqual({
      currentDescription: 'Fetch current conditions',
      hasDescriptionOverride: false,
    });
  });
});
