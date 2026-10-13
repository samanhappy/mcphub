// Navigation catalog mirrors the service directories under /mnt/mcp.
// Entries describe intended integrations; they do not imply that a service is connected.
export const alazabServices = [
  { id: 'agents', label: 'Agents', description: 'AI agents and orchestration' },
  { id: 'autodesk', label: 'Autodesk', description: 'Autodesk applications and APIs' },
  { id: 'azure', label: 'Azure', description: 'Azure services and APIs' },
  { id: 'daftra', label: 'Daftra', description: 'ERP, invoices and work orders' },
  { id: 'env', label: 'Environment', description: 'Runtime configuration' },
  { id: 'forms', label: 'Forms', description: 'Forms and submissions' },
  { id: 'foundry', label: 'AI Foundry', description: 'Agents and models' },
  { id: 'frappe', label: 'Frappe', description: 'ERPNext and Frappe services' },
  { id: 'gcp', label: 'Google Cloud', description: 'Google Cloud APIs' },
  { id: 'magicplan', label: 'MagicPlan', description: 'Project plans and files' },
  { id: 'mail', label: 'Mail', description: 'Email integrations' },
  { id: 'mcp-app', label: 'MCP App', description: 'MCP applications' },
  { id: 'mcphub', label: 'MCPHub', description: 'Central MCP gateway' },
  { id: 'minio', label: 'MinIO', description: 'Object storage integration' },
  { id: 'mongodb', label: 'MongoDB', description: 'MongoDB Atlas and databases' },
  { id: 'nove', label: 'Nove', description: 'Nove integration' },
  { id: 'openapi', label: 'OpenAPI', description: 'API specifications' },
  { id: 'oracle', label: 'Oracle', description: 'Oracle Cloud integration' },
  { id: 'postgres', label: 'Postgres', description: 'PostgreSQL integration' },
  { id: 'storage', label: 'Storage', description: 'Cloud file and object storage' },
  { id: 'supabase', label: 'Supabase', description: 'Supabase projects and functions' },
  { id: 'toolboxes', label: 'Toolboxes', description: 'Shared AI and MCP tools' },
  { id: 'uberfix', label: 'UberFix', description: 'Maintenance management' },
  { id: 'whatsapp', label: 'WhatsApp', description: 'Messaging integrations' },
] as const;

export type AlazabServiceId = (typeof alazabServices)[number]['id'];
