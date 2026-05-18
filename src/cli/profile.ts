import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// XDG-aware credential and config storage. Credentials are written with 0600
// (owner read/write only) and the parent directory with 0700; writes are atomic
// (tmp + rename) so a crashed write can't leave a half-written file.

export interface Profile {
  url: string;
  tokenKind?: 'jwt' | 'bearer';
  token?: string;
  username?: string;
  savedAt?: string;
}

export interface Credentials {
  current: string;
  profiles: Record<string, Profile>;
}

export interface CliConfigFile {
  defaultOutput?: 'text' | 'json';
  defaultProfile?: string;
}

const APP_NAME = 'mcphub';

function homeDir(): string {
  // Prefer HOME / USERPROFILE so tests (and users) can override via env. On
  // some macOS configurations os.homedir() ignores HOME and reads the real
  // passwd entry, which would defeat both isolation and explicit overrides.
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || process.cwd();
}

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(homeDir(), '.config');
}

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(homeDir(), '.local', 'share');
}

function legacyDir(): string {
  return path.join(homeDir(), `.${APP_NAME}`);
}

export function credentialsPath(): string {
  const legacy = path.join(legacyDir(), 'credentials.json');
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return path.join(xdgDataHome(), APP_NAME, 'credentials.json');
}

export function configPath(): string {
  return path.join(xdgConfigHome(), APP_NAME, 'config.json');
}

const EMPTY_CREDENTIALS: Credentials = { current: '', profiles: {} };

export function loadCredentials(): Credentials {
  const p = credentialsPath();
  if (!fs.existsSync(p)) {
    return { ...EMPTY_CREDENTIALS };
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
      return { ...EMPTY_CREDENTIALS };
    }
    return parsed;
  } catch {
    return { ...EMPTY_CREDENTIALS };
  }
}

export function saveCredentials(creds: Credentials): void {
  const p = credentialsPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Best-effort tighten on existing dir (mkdirSync mode is honored only on
  // creation; chmod on dir works on POSIX, no-op on Windows).
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
}

export function loadConfigFile(): CliConfigFile {
  const p = configPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

export function getProfile(creds: Credentials, name?: string): Profile | undefined {
  const target = name || creds.current;
  if (!target) return undefined;
  return creds.profiles[target];
}

export function setProfile(creds: Credentials, name: string, profile: Profile): Credentials {
  return {
    current: creds.current || name,
    profiles: { ...creds.profiles, [name]: { ...profile, savedAt: new Date().toISOString() } },
  };
}

export function deleteProfile(creds: Credentials, name: string): Credentials {
  if (!(name in creds.profiles)) return creds;
  const next = { ...creds.profiles };
  delete next[name];
  return {
    current: creds.current === name ? Object.keys(next)[0] || '' : creds.current,
    profiles: next,
  };
}

export function setCurrentProfile(creds: Credentials, name: string): Credentials {
  if (!(name in creds.profiles)) {
    throw new Error(`Profile not found: ${name}`);
  }
  return { ...creds, current: name };
}
