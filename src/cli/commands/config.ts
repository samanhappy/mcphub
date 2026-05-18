import { CliUsageError } from '../errors.js';
import { GlobalFlags } from '../context.js';
import { extractFlags } from '../parse-args.js';
import {
  Credentials,
  deleteProfile,
  loadCredentials,
  saveCredentials,
  setCurrentProfile,
  setProfile,
} from '../profile.js';
import { bold, dim, green, maskToken, printJson, printLine, printTable } from '../output.js';

export interface ConfigDeps {
  loadCreds?: () => Credentials;
  saveCreds?: (creds: Credentials) => void;
}

export async function run(args: string[], globals: GlobalFlags, deps: ConfigDeps = {}): Promise<void> {
  const sub = args.shift();
  switch (sub) {
    case undefined:
    case 'show':
      return showActive(globals, deps);
    case 'list':
      return list(globals, deps);
    case 'use':
      return use(args, deps);
    case 'set-url':
      return setUrl(args, globals, deps);
    case 'set-token':
      return setToken(args, globals, deps);
    case 'remove':
      return remove(args, deps);
    default:
      throw new CliUsageError(`Unknown config subcommand: ${sub}`);
  }
}

function showActive(globals: GlobalFlags, deps: ConfigDeps): void {
  const creds = (deps.loadCreds ?? loadCredentials)();
  const name = globals.profile || creds.current;
  if (!name || !creds.profiles[name]) {
    printLine(dim('No active profile. Run `mcphub login` to create one.'));
    return;
  }
  const profile = creds.profiles[name];
  if (globals.json) {
    printJson({
      name,
      url: profile.url,
      tokenKind: profile.tokenKind ?? 'jwt',
      tokenMasked: maskToken(profile.token),
      username: profile.username ?? null,
      savedAt: profile.savedAt ?? null,
    });
    return;
  }
  printLine(`${bold('profile')}    ${name}`);
  printLine(`${bold('url')}        ${profile.url}`);
  printLine(`${bold('tokenKind')}  ${profile.tokenKind ?? 'jwt'}`);
  printLine(`${bold('token')}      ${maskToken(profile.token)}`);
  if (profile.username) printLine(`${bold('username')}   ${profile.username}`);
  if (profile.savedAt) printLine(`${bold('savedAt')}    ${profile.savedAt}`);
}

function list(globals: GlobalFlags, deps: ConfigDeps): void {
  const creds = (deps.loadCreds ?? loadCredentials)();
  const rows = Object.entries(creds.profiles).map(([name, p]) => ({
    name,
    current: name === creds.current ? '*' : '',
    url: p.url,
    tokenKind: p.tokenKind ?? 'jwt',
    token: maskToken(p.token),
    username: p.username ?? '',
  }));
  if (globals.json) {
    printJson({ current: creds.current, profiles: rows });
    return;
  }
  printTable(rows, ['name', 'current', 'url', 'tokenKind', 'token', 'username']);
}

function use(args: string[], deps: ConfigDeps): void {
  const name = args[0];
  if (!name) throw new CliUsageError('Usage: mcphub config use <name>');
  const load = deps.loadCreds ?? loadCredentials;
  const save = deps.saveCreds ?? saveCredentials;
  const next = setCurrentProfile(load(), name);
  save(next);
  printLine(green(`Active profile set to "${name}".`));
}

function setUrl(args: string[], globals: GlobalFlags, deps: ConfigDeps): void {
  const url = args[0];
  if (!url) throw new CliUsageError('Usage: mcphub config set-url <url>');
  const load = deps.loadCreds ?? loadCredentials;
  const save = deps.saveCreds ?? saveCredentials;
  const creds = load();
  const target = globals.profile || creds.current || 'default';
  const existing = creds.profiles[target];
  const next = setProfile(creds, target, {
    url,
    tokenKind: existing?.tokenKind,
    token: existing?.token,
    username: existing?.username,
  });
  save(next);
  printLine(green(`Set url for profile "${target}" to ${url}.`));
}

function setToken(args: string[], globals: GlobalFlags, deps: ConfigDeps): void {
  const { positional, flags } = extractFlags(args, { boolean: ['--bearer'] });
  const token = positional[0];
  if (!token) throw new CliUsageError('Usage: mcphub config set-token <token> [--bearer]');
  const load = deps.loadCreds ?? loadCredentials;
  const save = deps.saveCreds ?? saveCredentials;
  const creds = load();
  const target = globals.profile || creds.current;
  if (!target || !creds.profiles[target]) {
    throw new CliUsageError('No profile to update. Run `mcphub login` first or pass --profile.');
  }
  const existing = creds.profiles[target];
  const next = setProfile(creds, target, {
    url: existing.url,
    tokenKind: flags['--bearer'] ? 'bearer' : 'jwt',
    token,
    username: existing.username,
  });
  save(next);
  printLine(green(`Set token for profile "${target}" (${flags['--bearer'] ? 'bearer' : 'jwt'}).`));
}

function remove(args: string[], deps: ConfigDeps): void {
  const name = args[0];
  if (!name) throw new CliUsageError('Usage: mcphub config remove <name>');
  const load = deps.loadCreds ?? loadCredentials;
  const save = deps.saveCreds ?? saveCredentials;
  const creds = load();
  if (!creds.profiles[name]) {
    throw new CliUsageError(`Profile not found: ${name}`);
  }
  save(deleteProfile(creds, name));
  printLine(green(`Removed profile "${name}".`));
}
