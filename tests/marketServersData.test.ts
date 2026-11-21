import fs from 'fs';
import path from 'path';

/**
 * Guards the market entries in servers.json against drift from the
 * environment variables their upstream servers actually read.
 */

interface MarketArgument {
  description: string;
  required?: boolean;
  example?: string;
}

interface MarketInstallation {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MarketServer {
  name?: string;
  display_name?: string;
  installations?: Record<string, MarketInstallation>;
  arguments?: Record<string, MarketArgument>;
}

const loadServersJson = (): Record<string, MarketServer> => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'servers.json'), 'utf8');
  return JSON.parse(raw) as Record<string, MarketServer>;
};

describe('servers.json market data', () => {
  it('elasticsearch entry uses the env var names of the upstream server', () => {
    const servers = loadServersJson();
    const entry = servers['elasticsearch'];
    expect(entry).toBeDefined();
    expect(entry.repository?.url).toBe(
      'https://github.com/cr7258/elasticsearch-mcp-server'
    );

    // Upstream reads ELASTICSEARCH_HOSTS / ELASTICSEARCH_USERNAME /
    // ELASTICSEARCH_PASSWORD (see cr7258/elasticsearch-mcp-server README);
    // there are no ELASTIC_* environment variables.
    const expected = [
      'ELASTICSEARCH_HOSTS',
      'ELASTICSEARCH_USERNAME',
      'ELASTICSEARCH_PASSWORD',
    ];

    for (const installation of Object.values(entry.installations ?? {})) {
      expect(Object.keys(installation.env ?? {})).toEqual(
        expect.arrayContaining(expected)
      );
      for (const envName of Object.keys(installation.env ?? {})) {
        expect(envName).toMatch(/^ELASTICSEARCH_/);
      }
    }

    for (const argName of Object.keys(entry.arguments ?? {})) {
      expect(argName).toMatch(/^ELASTICSEARCH_/);
    }
  });
});
