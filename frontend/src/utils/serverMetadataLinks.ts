import type { Server, ServerFormData } from '../types';

/**
 * Seed the two metadata-link inputs from the stored config (#1495).
 *
 * The edit form submits the whole config, so a field the form does not seed is
 * sent back as `undefined` and the stored link is cleared on any save. Keeping
 * the mapping in one place lets the regression test exercise the real seeding
 * instead of a copy of it.
 */
export const getInitialMetadataLinks = (
  initialData: Server | null | undefined,
): Pick<ServerFormData, 'repositoryUrl' | 'documentationUrl'> => {
  const config = initialData?.config;
  return {
    repositoryUrl: config?.repositoryUrl,
    documentationUrl: config?.documentationUrl,
  };
};
