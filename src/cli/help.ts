import { printLine } from './output.js';

const TOP_LEVEL_HELP = `mcphub — official CLI for the mcphub server

Usage:
  mcphub                           start the mcphub server (legacy, no-arg form)
  mcphub <command> [options]       run a CLI command

Commands:
  login                            interactively log in to a mcphub instance
  logout                           clear the cached token for the active profile
  config                           manage local profiles and credentials
  servers                          list/get/add/remove/toggle/reload MCP servers
  groups                           manage server groups
  keys                             manage bearer keys
  call                             call an MCP tool via /mcp/$smart or /mcp/<group>
  export                           export the running hub's mcp_settings.json
  discover                         browse a remote hub's public marketplace (#809)
  install                          install a server from a remote marketplace
  help [command]                   show help for a command

Global options:
  --url <url>                      override the active profile's base URL
  --token <token>                  override the active profile's token
  --bearer                         treat --token as a bearer key (default: JWT)
  --profile <name>                 use a specific saved profile
  --json                           print JSON output instead of human-friendly
  --debug                          print stack traces on error

Environment:
  MCPHUB_URL, MCPHUB_TOKEN, MCPHUB_TOKEN_KIND
  XDG_CONFIG_HOME, XDG_DATA_HOME, NO_COLOR
`;

const COMMAND_HELP: Record<string, string> = {
  login: `mcphub login [--url <url>] [--username <name>] [--password <pwd>]

Log in to a mcphub instance and cache a JWT in the active profile.
Prompts for missing values. The token is written to credentials.json
with 0600 permissions.`,

  logout: `mcphub logout

Clear the token from the active profile (URL and username are preserved).`,

  config: `mcphub config <subcommand>

Subcommands:
  show                             print the active profile (token masked)
  list                             list all saved profiles
  use <name>                       switch the active profile
  set-url <url>                    set the URL of a profile (--profile to target)
  set-token <token> [--bearer]     set the token of a profile manually
  remove <name>                    delete a saved profile`,

  servers: `mcphub servers <subcommand>

Subcommands:
  list                             list all servers
  get <name>                       show one server's config
  add <name> --from-file <path>    add a server from a JSON file
  add <name> --type stdio --command <cmd> [--arg <a> ...] [--env K=V ...]
  remove <name>                    delete a server
  toggle <name> [--on|--off]       enable/disable a server
  reload <name>                    reconnect a server`,

  groups: `mcphub groups <subcommand>

Subcommands:
  list                             list groups
  get <id|name>                    show one group
  add <name> [--description <d>]   create a group
  remove <id|name>                 delete a group
  add-server <group> <server>      add a server to a group
  remove-server <group> <server>   remove a server from a group`,

  keys: `mcphub keys <subcommand>

Subcommands:
  list                             list bearer keys
  create --name <n> [--access-type all|groups|servers|custom]
         [--groups a,b] [--servers x,y]
  delete <id>                      delete a key`,

  call: `mcphub call <tool> [k=v ...] [--group <g>|--smart] [--params-json <json>]

Call an MCP tool. Argument parsing:
  key=value                        string by default
  key=42 / key=true / key=null     auto-coerced to number/boolean/null
  key=@path                        load JSON from file
  --params-json '{"a":1}'          override the entire params object`,

  export: `mcphub export [--out <path>]

Download the running hub's mcp_settings.json. Default: stdout (pretty JSON).`,

  discover: `mcphub discover [subcommand] [--remote <url>] [--search <q>]
                          [--category <c>] [--tag <t>] [--limit <n>]

Browse the public marketplace API (requires the hub to have
systemConfig.discovery.enabled=true).

Subcommands:
  (default)                        list market servers
  info <name>                      show a single server
  categories                       list categories
  tags                             list tags`,

  install: `mcphub install <name> [--remote <url>] [--type npm|docker|uvx|pip|binary]
                          [--to hub|file|stdout] [--out <path>]
                          [--env K=V ...] [--dry-run] [--yes] [--force]

Install a server from a remote hub's marketplace.

--to hub      POST /api/servers on the active profile's hub (default)
--to file     merge mcpServers into a Claude Desktop / OpenClaw-style JSON
--to stdout   print the mcpServers snippet (same as --dry-run)
`,
};

export function printHelp(command?: string): void {
  if (!command) {
    printLine(TOP_LEVEL_HELP);
    return;
  }
  const help = COMMAND_HELP[command];
  if (!help) {
    printLine(`No help available for "${command}".`);
    printLine('');
    printLine(TOP_LEVEL_HELP);
    return;
  }
  printLine(help);
}

export function printVersion(): void {
  // The version is read lazily so tests don't have to mock the package.json
  // path. We import via createRequire to keep this ESM-safe.
  import('node:module').then(({ createRequire }) => {
    try {
      const require = createRequire(import.meta.url);
      const pkg = require('../../package.json');
      printLine(pkg.version ?? 'unknown');
    } catch {
      printLine('unknown');
    }
  });
}
