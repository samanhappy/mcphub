import { createHash } from 'node:crypto';
import { isReservedStagingName } from '../services/fileStaging/tools.js';

const compatibleName = /^[A-Za-z0-9_-]{1,64}$/;

/** Build aliases from the authorized, route-projected catalog, never from persisted names. */
export const compatibleToolNames = (
  tools: ReadonlyArray<{ name: string }>,
): Map<string, string> => {
  const aliases = new Map<string, string>();
  const used = new Set(
    tools.filter((tool) => compatibleName.test(tool.name)).map((tool) => tool.name),
  );
  for (const name of [...new Set(tools.map((tool) => tool.name))].sort()) {
    if (compatibleName.test(name)) {
      aliases.set(name, name);
      continue;
    }
    let stem = name.replace(/[^A-Za-z0-9_-]/g, '_') || 'tool';
    // Generated aliases must not be intercepted by the hub's early staging dispatch.
    if (isReservedStagingName(stem)) stem = `tool_${stem}`;
    const hash = createHash('sha256').update(name).digest('hex').slice(0, 12);
    let counter = 0;
    let alias: string;
    do {
      const suffix = `_${hash}${counter ? `_${counter}` : ''}`;
      alias = `${stem.slice(0, 64 - suffix.length)}${suffix}`;
      counter++;
    } while (used.has(alias));
    used.add(alias);
    aliases.set(name, alias);
  }
  return aliases;
};
