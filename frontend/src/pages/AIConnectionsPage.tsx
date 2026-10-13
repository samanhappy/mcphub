import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, KeyRound, PlugZap } from 'lucide-react';
import { getBasePath } from '@/utils/runtime';

// MCPHub exposes group/server endpoints; users must choose an actual configured
// group or server and enable compatible OAuth before connecting ChatGPT.
const AIConnectionsPage: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const hubRoot = useMemo(() => {
    const path = getBasePath().replace(/\/$/, '');
    return `${window.location.origin}${path}`;
  }, []);
  const example = `${hubRoot}/mcp/{group-or-server}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(example);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="hub-h1">ChatGPT & AI connections</h1>
        <p className="hub-sub">Connect clients to MCPHub using its existing MCP endpoints and OAuth authorization server.</p>
      </header>
      <div className="hub-card hub-card-pad space-y-4">
        <div className="flex items-center gap-2 font-semibold"><PlugZap size={18} /> Remote MCP endpoint</div>
        <p className="text-sm" style={{ color: 'var(--hub-ink-2)' }}>
          This is a URL template, not a live connection. Replace the placeholder with a configured
          MCPHub group or server name. For ChatGPT, use HTTPS and configure MCPHub OAuth
          according to the client registration and consent settings.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="hub-tag break-all">{example}</code>
          <button type="button" className="hub-btn" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy template'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/servers" className="hub-btn primary">Manage servers</Link>
          <Link to="/groups" className="hub-btn">Manage groups</Link>
          <Link to="/settings" className="hub-btn"><KeyRound size={15} /> OAuth settings</Link>
        </div>
      </div>
      <div className="hub-card hub-card-pad space-y-3">
        <h2 className="font-semibold">Connect ChatGPT</h2>
        <ol className="list-decimal pl-6 space-y-2 text-sm" style={{ color: 'var(--hub-ink-2)' }}>
          <li>Create or select an MCPHub group/server and confirm it exposes the expected tools.</li>
          <li>Configure MCPHub OAuth, HTTPS origin and an authorized user/client.</li>
          <li>In ChatGPT, add a custom MCP connection with the real group/server endpoint URL.</li>
          <li>Complete authorization and verify tools/list and a read-only tools/call against live data.</li>
        </ol>
        <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" className="hub-btn inline-flex">
          Open ChatGPT <ExternalLink size={14} />
        </a>
      </div>
      <p className="hub-sub">
        Compatible MCP clients may use Streamable HTTP. STDIO-only clients need an
        appropriate local bridge. Client support and authentication settings vary by platform.
      </p>
    </div>
  );
};

export default AIConnectionsPage;
