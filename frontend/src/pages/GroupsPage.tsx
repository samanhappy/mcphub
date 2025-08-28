import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group } from '@/types';
import { useGroupData } from '@/hooks/useGroupData';
import { useServerData } from '@/hooks/useServerData';
import AddGroupForm from '@/components/AddGroupForm';
import EditGroupForm from '@/components/EditGroupForm';
import GroupCard from '@/components/GroupCard';

const GroupsPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    groups,
    loading: groupsLoading,
    error: groupError,
    setError: setGroupError,
    deleteGroup,
    triggerRefresh
  } = useGroupData();
  const { servers } = useServerData({ refreshOnMount: true });

  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleEditClick = (group: Group) => {
    setEditingGroup(group);
  };

  const handleEditComplete = () => {
    setEditingGroup(null);
    triggerRefresh(); // Refresh the groups list after editing
  };

  const handleDeleteGroup = async (groupId: string) => {
    const result = await deleteGroup(groupId);
    if (!result || !result.success) {
      setGroupError(result?.message || t('groups.deleteError'));
    }
  };

  const handleAddGroup = () => {
    setShowAddForm(true);
  };

  const handleAddComplete = () => {
    setShowAddForm(false);
    triggerRefresh(); // Refresh the groups list after adding
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('pages.groups.title')}</h1>
        <div className="flex space-x-4">
          <button
            onClick={handleAddGroup}
            className="flex items-center px-4 py-2 text-blue-800 transition-all duration-200 bg-blue-100 rounded hover:bg-blue-200 btn-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 00-1 1v5H4a1 1 0 100 2h5v5a1 1 0 102 0v-5h5a1 1 0 100-2h-5V4a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {t('groups.add')}
          </button>
        </div>
      </div>

      {groupError && (
        <div className="p-4 mb-6 text-red-700 bg-red-100 border-l-4 border-red-500 rounded-lg error-box">
          <p>{groupError}</p>
        </div>
      )}

      {groupsLoading ? (
        <div className="p-6 bg-white rounded-lg shadow loading-container">
          <div className="flex flex-col items-center justify-center">
            <svg className="w-10 h-10 mb-4 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">{t('app.loading')}</p>
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="p-6 bg-white rounded-lg shadow empty-state">
          <p className="text-gray-600">{t('groups.noGroups')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              servers={servers}
              onEdit={handleEditClick}
              onDelete={handleDeleteGroup}
            />
          ))}
        </div>
      )}

      {showAddForm && (
        <AddGroupForm onAdd={handleAddComplete} onCancel={handleAddComplete} />
      )}

      {editingGroup && (
        <EditGroupForm
          group={editingGroup}
          onEdit={handleEditComplete}
          onCancel={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
};

export default GroupsPage;