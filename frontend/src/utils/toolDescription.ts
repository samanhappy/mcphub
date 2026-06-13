type ToolDescriptionSource = {
  description?: string;
  defaultDescription?: string;
  hasDescriptionOverride?: boolean;
};

export interface ToolDescriptionInfo {
  currentDescription: string;
  defaultDescription?: string;
  hasDescriptionOverride: boolean;
}

const normalizeDescription = (description: string | undefined, fallback: string): string => {
  return description && description.trim() ? description : fallback;
};

export const getToolDescriptionInfo = (
  tool: ToolDescriptionSource,
  noDescriptionText: string,
): ToolDescriptionInfo => {
  const currentDescription = normalizeDescription(tool.description, noDescriptionText);

  if (!tool.hasDescriptionOverride) {
    return {
      currentDescription,
      hasDescriptionOverride: false,
    };
  }

  return {
    currentDescription,
    defaultDescription: normalizeDescription(tool.defaultDescription, noDescriptionText),
    hasDescriptionOverride: true,
  };
};
