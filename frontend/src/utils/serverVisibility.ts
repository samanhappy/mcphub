export type ServerVisibility = 'private' | 'group' | 'public';

type VisibilityTranslator = (key: string, options?: { defaultValue?: string }) => string;

type VisibilityDisplay = {
  value: ServerVisibility;
  shortLabel: string;
  longLabel: string;
  className: string;
};

type VisibilityOption = {
  value: ServerVisibility;
  label: string;
  disabled: boolean;
};

const VISIBILITY_META: Record<
  ServerVisibility,
  {
    shortKey: string;
    shortFallback: string;
    longKey: string;
    longFallback: string;
    className: string;
  }
> = {
  private: {
    shortKey: 'server.visibilityPrivateShort',
    shortFallback: 'Private',
    longKey: 'server.visibilityPrivate',
    longFallback: 'Private — only the owner and admins',
    className: 'bg-[var(--hub-bg-2)] text-[var(--hub-ink-2)] border-[var(--hub-line-2)]',
  },
  group: {
    shortKey: 'server.visibilityGroupShort',
    shortFallback: 'Group',
    longKey: 'server.visibilityGroup',
    longFallback: 'Group (reserved — not yet implemented)',
    className: 'bg-[oklch(0.97_0.02_85)] text-[oklch(0.45_0.07_85)] border-[oklch(0.88_0.04_85)]',
  },
  public: {
    shortKey: 'server.visibilityPublicShort',
    shortFallback: 'Public',
    longKey: 'server.visibilityPublic',
    longFallback: 'Public — every authenticated user',
    className: 'bg-[oklch(0.97_0.03_145)] text-[oklch(0.42_0.12_145)] border-[oklch(0.88_0.04_145)]',
  },
};

export const normalizeServerVisibility = (visibility?: string): ServerVisibility => {
  if (visibility === 'public' || visibility === 'group') {
    return visibility;
  }
  return 'private';
};

export const getServerVisibilityDisplay = (
  t: VisibilityTranslator,
  visibility?: string,
): VisibilityDisplay => {
  const value = normalizeServerVisibility(visibility);
  const meta = VISIBILITY_META[value];

  return {
    value,
    shortLabel: t(meta.shortKey, { defaultValue: meta.shortFallback }),
    longLabel: t(meta.longKey, { defaultValue: meta.longFallback }),
    className: meta.className,
  };
};

export const getServerVisibilityOptions = (
  t: VisibilityTranslator,
  visibility?: string,
): VisibilityOption[] => {
  const currentVisibility = normalizeServerVisibility(visibility);
  const options: VisibilityOption[] = [
    {
      value: 'private',
      label: t('server.visibilityPrivateShort', { defaultValue: 'Private' }),
      disabled: false,
    },
  ];

  if (currentVisibility === 'group') {
    options.push({
      value: 'group',
      label: t('server.visibilityGroupShort', { defaultValue: 'Group' }),
      disabled: true,
    });
  }

  options.push({
    value: 'public',
    label: t('server.visibilityPublicShort', { defaultValue: 'Public' }),
    disabled: false,
  });

  return options;
};
