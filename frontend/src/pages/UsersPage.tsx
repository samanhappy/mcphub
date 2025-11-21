import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '@/types';
import { useUserData } from '@/hooks/useUserData';
import { useAuth } from '@/contexts/AuthContext';
import AddUserForm from '@/components/AddUserForm';
import EditUserForm from '@/components/EditUserForm';
import { Edit, Trash, User as UserIcon } from 'lucide-react';
import DeleteDialog from '@/components/ui/DeleteDialog';

const UsersPage: React.FC = () => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const currentUser = auth.user;
  const {
    users,
    loading: usersLoading,
    error: userError,
    setError: setUserError,
    deleteUser,
    triggerRefresh
  } = useUserData();

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);

  // Check if current user is admin
  if (!currentUser?.isAdmin) {
    return (
      <div className="bg-white shadow rounded-lg p-6 dashboard-card">
        <p className="text-red-600">{t('users.adminRequired')}</p>
      </div>
    );
  }

  const handleEditClick = (user: User) => {
    setEditingUser(user);
  };

  const handleEditComplete = () => {
    setEditingUser(null);
    triggerRefresh(); // Refresh the users list after editing
  };

  const handleDeleteClick = (username: string) => {
    setUserToDelete(username);
  };

  const handleConfirmDelete = async () => {
    if (userToDelete) {
      const result = await deleteUser(userToDelete);
      if (!result?.success) {
        setUserError(result?.message || t('users.deleteError'));
      }
      setUserToDelete(null);
    }
  };

  const handleAddUser = () => {
    setShowAddForm(true);
  };

  const handleAddComplete = () => {
    setShowAddForm(false);
    triggerRefresh(); // Refresh the users list after adding
  };

  return (
    <div className="container mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('pages.users.title')}</h1>
        <div className="flex space-x-4">
          <button
            onClick={handleAddUser}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center btn-primary transition-all duration-200 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 00-1 1v5H4a1 1 0 100 2h5v5a1 1 0 102 0v-5h5a1 1 0 100-2h-5V4a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {t('users.add')}
          </button>
        </div>
      </div>

      {userError && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 error-box rounded-lg shadow-sm">
          <div className="flex justify-between items-center">
            <p>{userError}</p>
            <button
              onClick={() => setUserError(null)}
              className="text-red-500 hover:text-red-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 011.414 0L10 8.586l4.293-4.293a1 1 111.414 1.414L11.414 10l4.293 4.293a1 1 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 01-1.414-1.414L8.586 10 4.293 5.707a1 1 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {usersLoading ? (
        <div className="bg-white shadow rounded-lg p-6 loading-container flex justify-center items-center h-64">
          <div className="flex flex-col items-center justify-center">
            <svg className="animate-spin h-10 w-10 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">{t('app.loading')}</p>
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-6 empty-state dashboard-card">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="p-4 bg-gray-100 rounded-full mb-4">
              <UserIcon className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-600 text-lg font-medium">{t('users.noUsers')}</p>
            <button
              onClick={handleAddUser}
              className="mt-4 text-blue-600 hover:text-blue-800 font-medium"
            >
              {t('users.addFirst')}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden table-container dashboard-card">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('users.username')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('users.role')}
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('users.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => {
                const isCurrentUser = currentUser?.username === user.username;
                return (
                  <tr key={user.username} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 flex items-center">
                            {user.username}
                            {isCurrentUser && (
                              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full border border-blue-200">
                                {t('users.currentUser')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${user.isAdmin
                          ? 'bg-purple-100 text-purple-800 border border-purple-200'
                          : 'bg-gray-100 text-gray-800 border border-gray-200'
                        }`}>
                        {user.isAdmin ? t('users.admin') : t('users.user')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-3">
                        <button
                          onClick={() => handleEditClick(user)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                          title={t('users.edit')}
                        >
                          <Edit size={18} />
                        </button>
                        {!isCurrentUser && (
                          <button
                            onClick={() => handleDeleteClick(user.username)}
                            className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors"
                            title={t('users.delete')}
                          >
                            <Trash size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddForm && (
        <AddUserForm onAdd={handleAddComplete} onCancel={handleAddComplete} />
      )}

      {editingUser && (
        <EditUserForm
          user={editingUser}
          onEdit={handleEditComplete}
          onCancel={() => setEditingUser(null)}
        />
      )}

      <DeleteDialog
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleConfirmDelete}
        serverName={userToDelete || ''}
        isGroup={false}
        isUser={true}
      />
    </div>
  );
};

export default UsersPage;
