import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { Switch } from '@/components/ui/ToggleGroup';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  const { 
    routingConfig, 
    loading, 
    updateRoutingConfig 
  } = useSettingsData();
  
  const handleRoutingConfigChange = async (key: 'enableGlobalRoute' | 'enableGroupNameRoute', value: boolean) => {
    await updateRoutingConfig(key, value);
  };
  
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
      
      {/* Route Configuration Settings */}
      <div className="bg-white shadow rounded-lg p-6 mt-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">{t('pages.settings.routeConfig')}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-700">{t('settings.enableGlobalRoute')}</h3>
              <p className="text-sm text-gray-500">{t('settings.enableGlobalRouteDescription')}</p>
            </div>
            <Switch
              disabled={loading}
              checked={routingConfig.enableGlobalRoute}
              onCheckedChange={(checked) => handleRoutingConfigChange('enableGlobalRoute', checked)}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-700">{t('settings.enableGroupNameRoute')}</h3>
              <p className="text-sm text-gray-500">{t('settings.enableGroupNameRouteDescription')}</p>
            </div>
            <Switch
              disabled={loading}
              checked={routingConfig.enableGroupNameRoute}
              onCheckedChange={(checked) => handleRoutingConfigChange('enableGroupNameRoute', checked)}
            />
          </div>
        </div>
      </div>
      
      {/* Language Settings */}
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