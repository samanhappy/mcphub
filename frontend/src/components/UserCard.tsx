import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, IUser } from '@/types';
import { Edit, Trash } from '@/components/icons/LucideIcons';
import DeleteDialog from '@/components/ui/DeleteDialog';

interface UserCardProps {
  user: User;
  currentUser: IUser | null;
  onEdit: (user: User) => void;
  onDelete: (username: string) => void;
}

const UserCard: React.FC<UserCardProps> = ({ user, currentUser, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    onDelete(user.username);
    setShowDeleteDialog(false);
  };

  const isCurrentUser = currentUser?.username === user.username;
  const canDelete = !isCurrentUser; // Can't delete own account

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
              <span className="text-white font-medium text-sm">
                {user.username.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {user.username}
                {isCurrentUser && (
                  <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                    {t('users.currentUser')}
                  </span>
                )}
              </h3>
              <div className="flex items-center space-x-2">
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${user.isAdmin
                    ? 'bg-red-100 text-red-800'
                    : 'bg-gray-100 text-gray-800'
                    }`}
                >
                  {user.isAdmin ? t('users.admin') : t('users.user')}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => onEdit(user)}
            className="text-gray-500 hover:text-gray-700"
            title={t('users.edit')}
          >
            <Edit size={18} />
          </button>

          {canDelete && (
            <button
              onClick={handleDeleteClick}
              className="text-gray-500 hover:text-red-600"
              title={t('users.delete')}
            >
              <Trash size={18} />
            </button>
          )}
        </div>
      </div>

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        serverName={user.username}
        isGroup={false}
        isUser={true}
      />
    </div>
  );
};

export default UserCard;
