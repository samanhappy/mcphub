export function stripRuntimeToolName(
  serverSlug: string,
  publicToolName: string,
  nameSeparator: string,
): string {
  const prefix = `${serverSlug}${nameSeparator}`;
  return publicToolName.startsWith(prefix)
    ? publicToolName.slice(prefix.length)
    : publicToolName;
}
