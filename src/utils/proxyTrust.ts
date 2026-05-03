import fs from 'fs';

export type TrustProxySetting = boolean | number | string;

const isContainerEnvironment = (
  env: NodeJS.ProcessEnv,
  pathExists: (filePath: string) => boolean,
): boolean =>
  Boolean(env.KUBERNETES_SERVICE_HOST) || pathExists('/.dockerenv');

export const resolveTrustProxySetting = (
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (filePath: string) => boolean = fs.existsSync,
): TrustProxySetting => {
  const rawSetting = env.TRUST_PROXY?.trim();

  if (rawSetting) {
    const normalizedSetting = rawSetting.toLowerCase();

    if (normalizedSetting === 'true') {
      return 1;
    }

    if (normalizedSetting === 'false') {
      return false;
    }

    if (/^\d+$/.test(rawSetting)) {
      return Number(rawSetting);
    }

    return rawSetting;
  }

  return isContainerEnvironment(env, pathExists) ? 1 : false;
};
