import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FolderOpen, Server } from 'lucide-react';
import { alazabServices } from '@/data/alazabServices';

const AlazabServicePage: React.FC = () => {
  const { serviceId } = useParams<{ serviceId: string }>();
  const service = alazabServices.find((item) => item.id === serviceId);

  if (!service) {
    return (
      <section className="hub-card hub-card-pad">
        <h1 className="hub-h1">Service not found</h1>
        <Link to="/servers" className="hub-btn mt-4">Open MCP Servers</Link>
      </section>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <FolderOpen size={26} style={{ color: '#FFB900' }} aria-hidden="true" />
        <div>
          <h1 className="hub-h1">{service.label}</h1>
          <p className="hub-sub">{service.description}</p>
        </div>
      </div>
      <div className="hub-card hub-card-pad space-y-4">
        <p className="text-sm" style={{ color: 'var(--hub-ink-2)' }}>
          Server directory: <code className="hub-mono">/mnt/mcp/{service.id}</code>
        </p>
        <p className="text-sm" style={{ color: 'var(--hub-ink-2)' }}>
          This directory is part of the Alazab server inventory. Its presence does not
          confirm that an MCP server is configured or online. Add or inspect the actual
          MCP connection in the server management page.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/servers" className="hub-btn primary"><Server size={15} /> Manage MCP servers</Link>
          <Link to="/connections/chatgpt" className="hub-btn"><ExternalLink size={15} /> AI client connections</Link>
          <Link to="/" className="hub-btn"><ArrowLeft size={15} /> Dashboard</Link>
        </div>
      </div>
    </div>
  );
};

export default AlazabServicePage;
