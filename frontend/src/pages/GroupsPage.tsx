import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Download, Upload, AlertCircle, X } from 'lucide-react';
import { Group } from '@/types';
import { useGroupData } from '@/hooks/useGroupData';
import { useServerData } from '@/hooks/useServerData';
import AddGroupForm from '@/components/AddGroupForm';
import EditGroupForm from '@/components/EditGroupForm';
import GroupCard from '@/components/GroupCard';
import GroupImportForm from '@/components/GroupImportForm';
import TemplateExportForm from '@/components/TemplateExportForm';
import TemplateImportForm from '@/components/TemplateImportForm';

const GroupsPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    groups,
    loading: groupsLoading,
    error: groupError,
    setError: setGroupError,
    deleteGroup,
    triggerRefresh,
  } = useGroupData();
  const { allServers } = useServerData({ refreshOnMount: true });

  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [showTemplateExport, setShowTemplateExport] = useState(false);
  const [showTemplateImport, setShowTemplateImport] = useState(false);

  const handleDeleteGroup = async (groupId: string) => {
    const result = await deleteGroup(groupId);
    if (!result || !result.success) {
      setGroupError(result?.message || t('groups.deleteError'));
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('pages.groups.title')}</h1>
          <p className="hub-sub">
            <span className="hub-num">{groups.length}</span> {t('nav.groups').toLowerCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="hub-btn" onClick={() => setShowImportForm(true)}>
            <Upload size={13} /> {t('groupImport.button')}
          </button>
          <button className="hub-btn" onClick={() => setShowTemplateExport(true)}>
            <Download size={13} /> {t('template.exportButton')}
          </button>
          <button className="hub-btn" onClick={() => setShowTemplateImport(true)}>
            <Upload size={13} /> {t('template.importButton')}
          </button>
          <button className="hub-btn primary" onClick={() => setShowAddForm(true)}>
            <Plus size={13} /> {t('groups.add')}
          </button>
        </div>
      </div>

      {groupError && (
        <div
          className="hub-card flex items-center justify-between gap-3 mb-4"
          style={{
            padding: '10px 14px',
            borderColor: 'oklch(0.85 0.1 25)',
            background: 'oklch(0.97 0.03 25)',
            color: 'oklch(0.4 0.18 25)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={14} className="flex-shrink-0" />
            <span className="truncate text-[13px]">{groupError}</span>
          </div>
          <button className="hub-icon-btn sm" onClick={() => setGroupError(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {groupsLoading ? (
        <div className="hub-card p-6 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          {t('app.loading')}
        </div>
      ) : groups.length === 0 ? (
        <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          {t('groups.noGroups')}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              servers={allServers}
              onEdit={setEditingGroup}
              onDelete={handleDeleteGroup}
            />
          ))}
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center justify-center text-[var(--hub-ink-3)] hover:text-[var(--hub-ink-2)] transition-colors"
            style={{
              border: '1px dashed var(--hub-line)',
              borderRadius: 10,
              minHeight: 200,
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <div className="text-center">
              <div
                className="grid place-items-center mx-auto mb-2"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid var(--hub-line)',
                }}
              >
                <Plus size={16} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--hub-ink-2)' }}>
                {t('groups.add')}
              </div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{t('groups.addNew')}</div>
            </div>
          </button>
        </div>
      )}

      {showAddForm && (
        <AddGroupForm
          onAdd={() => {
            setShowAddForm(false);
            triggerRefresh();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {showImportForm && (
        <GroupImportForm
          onSuccess={() => {
            setShowImportForm(false);
            triggerRefresh();
          }}
          onCancel={() => setShowImportForm(false)}
        />
      )}

      {editingGroup && (
        <EditGroupForm
          group={editingGroup}
          onEdit={() => {
            setEditingGroup(null);
            triggerRefresh();
          }}
          onCancel={() => setEditingGroup(null)}
        />
      )}

      {showTemplateExport && (
        <TemplateExportForm groups={groups} onCancel={() => setShowTemplateExport(false)} />
      )}

      {showTemplateImport && (
        <TemplateImportForm
          onSuccess={() => {
            setShowTemplateImport(false);
            triggerRefresh();
          }}
          onCancel={() => setShowTemplateImport(false)}
        />
      )}
    </div>
  );
};

export default GroupsPage;
