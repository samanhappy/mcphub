import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const handlePasswordChangeSuccess = () => {
    setTimeout(() => {
      navigate('/');
    }, 2000);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">{t('pages.settings.title')}</h1>
      
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">{t('auth.changePassword')}</h2>
        <div className="max-w-lg">
          <ChangePasswordForm onSuccess={handlePasswordChangeSuccess} />
        </div>
      </div>
      
      {/* 其他设置可以在这里添加 */}
      <div className="bg-white shadow rounded-lg p-6 mt-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">{t('pages.settings.language')}</h2>
        <div className="flex space-x-4">
          <button 
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
            onClick={() => {
              localStorage.setItem('i18nextLng', 'en');
              window.location.reload();
            }}
          >
            English
          </button>
          <button 
            className="px-4 py-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
            onClick={() => {
              localStorage.setItem('i18nextLng', 'zh');
              window.location.reload();
            }}
          >
            中文
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;