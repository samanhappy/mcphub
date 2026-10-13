import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FolderOpen, RefreshCw, Search, Server as ServerIcon } from 'lucide-react';
import { alazabServices } from '@/data/alazabServices';
import { useServerData } from '@/hooks/useServerData';
import { Server } from '@/types';
import ServerCard from '@/components/ServerCard';
import AddServerForm from '@/components/AddServerForm';
import EditServerForm from '@/components/EditServerForm';

// Exact token matching avoids classifying a service as connected merely because
// its name happens to occur inside another server's descriptive text.
const tokens = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const matchesService = (server: Server, serviceId: string): boolean => {
  const serverTokens = tokens(server.name);
  const target = serviceId.toLowerCase();
  return server.name.toLowerCase() === target ||
    serverTokens.includes(target) ||
    (target === 'mcphub' && serverTokens.includes('mcp') && serverTokens.includes('hub')) ||
    (target === 'mcp-app' && serverTokens.includes('mcp') && serverTokens.includes('app'));
};

const AlazabServicePage: React.FC = () => {
  const { serviceId } = useParams<{ serviceId: string }>();
  const service = alazabServices.find((item) => item.id === serviceId);
  const {
    allServers, isLoading, error, handleServerAdd, handleServerEdit,
    handleServerRemove, handleServerToggle, handleServerVisibilityChange,
    handleServerReload, handleServerReinstall, handleServerOAuthDisconnect, triggerRefresh,
  } = useServerData({ refreshOnMount: true });

  const [search, setSearch] = useState('');
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const matchingServers = useMemo(() => {
    if (!service) return [];
    return allServers.filter((server) => matchesService(server, service.id))
      .filter((server) => server.name.toLowerCase().includes(search.trim().toLowerCase()));
  }, [allServers, service, search]);

  const editServer = async (server: Server) => {
    if (loadingEdit) return;
    setSelectedName(server.name);
    setLoadingEdit(true);
    setActionError(null);
    try {
      const full = await handleServerEdit(server);
      if (full) setEditingServer(full as Server);
      else setActionError('Could not load the current server configuration.');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingEdit(false);
      setSelectedName(null);
    }
  };

  if (!service) {
    return <div className="hub-card hub-card-pad">
      <h1 className="hub-h1">Unknown integration</h1>
      <Link to="/servers" className="hub-btn mt-4">MCP servers</Link>
    </div>;
  }

  const connected = matchingServers.filter((server) => server.status === 'connected').length;
  const toolCount = matchingServers.reduce((sum, server) => sum + (server.tools?.length ?? 0), 0);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FolderOpen size={24} style={{ color: '#FFB900' }} />
            <h1 className="hub-h1">{service.label} — MCP Management</h1>
          </div>
          <p className="hub-sub">{service.description} · /mnt/mcp/{service.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="hub-btn" onClick={triggerRefresh}>
            <RefreshCw size={14} /> Refresh
          </button>
          <AddServerForm onAdd={handleServerAdd} />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="hub-card hub-card-pad"><div className="hub-sub">Registered servers</div><div className="text-2xl font-semibold">{matchingServers.length}</div></div>
        <div className="hub-card hub-card-pad"><div className="hub-sub">Connected</div><div className="text-2xl font-semibold">{connected}</div></div>
        <div className="hub-card hub-card-pad"><div className="hub-sub">Discovered tools</div><div className="text-2xl font-semibold">{toolCount}</div></div>
      </div>

      <div className="hub-card hub-card-pad flex flex-wrap items-center gap-3">
        <Search size={16} style={{ color: 'var(--hub-ink-3)' }} />
        <input aria-label="Search servers in this integration" className="hub-input max-w-sm" placeholder="Search registered MCP servers" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Link to="/groups" className="hub-btn">MCP groups</Link>
        <Link to="/connections/chatgpt" className="hub-btn">AI client connections</Link>
      </div>

      {(error || actionError) && <div role="alert" className="hub-card hub-card-pad text-red-600">{actionError || error}</div>}

      {isLoading && <p className="hub-sub">Loading MCP connections...</p>}
      {!isLoading && matchingServers.length === 0 && (
        <div className="hub-card hub-card-pad space-y-3">
          <div className="flex items-center gap-2 font-semibold"><ServerIcon size={18} /> No registered MCP server matched this service</div>
          <p className="hub-sub">A directory at /mnt/mcp/{service.id} is not necessarily an active MCP connection. Add a server above to manage it here. A registered server name should contain the service ID as a distinct token.</p>
        </div>
      )}

      {matchingServers.map((server) => (
        <div key={server.name} className="space-y-1">
          <ServerCard
            server={server}
            onEdit={() => { void editServer(server); }}
            onRemove={(name) => { void handleServerRemove(name); }}
            onToggle={handleServerToggle}
            onVisibilityChange={handleServerVisibilityChange}
            onRefresh={triggerRefresh}
            onReload={handleServerReload}
            onReinstall={handleServerReinstall}
            onOAuthDisconnect={handleServerOAuthDisconnect}
          />
          {selectedName === server.name && <p className="hub-sub">Loading configuration...</p>}
        </div>
      ))}

      {editingServer && (
        <EditServerForm
          server={editingServer}
          onCancel={() => setEditingServer(null)}
          onEdit={() => { setEditingServer(null); triggerRefresh(); }}
        />
      )}
    </section>
  );
};

export default AlazabServicePage;
