import type { MyCredentialBinding, CredentialSlot } from '../types';

const slotId = (slot: CredentialSlot) =>
  `${slot.target}.${slot.target === 'headers' ? slot.name.toLowerCase() : slot.name}`;

export function getCredentialCopySources(
  target: MyCredentialBinding,
  bindings: MyCredentialBinding[],
) {
  return bindings
    .filter((source) => source.serverName !== target.serverName)
    .map((source) => {
      const missing = target.credentialTemplate
        .filter(
          (slot) =>
            !source.credentialTemplate.some((candidate) => slotId(candidate) === slotId(slot)),
        )
        .map((slot) => `${slot.target}.${slot.name}`);
      const incompatibleUrl = target.credentialTemplate.some((slot) => {
        const candidate = source.credentialTemplate.find((item) => slotId(item) === slotId(slot));
        return (
          slot.target === 'url' &&
          candidate &&
          !candidate.allowed?.every((value) => slot.allowed?.includes(value))
        );
      });
      const reason = !source.configured
        ? 'unconfigured'
        : missing.length
          ? 'missing'
          : incompatibleUrl
            ? 'url'
            : undefined;
      return { source, reason, missing };
    });
}
