import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { Switch } from '@/components/ui/ToggleGroup';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';

const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language);

  // Update current language when it changes
  useEffect(() => {
    setCurrentLanguage(i18n.language);
  }, [i18n.language]);

  const [installConfig, setInstallConfig] = useState<{
    pythonIndexUrl: string;
  }>({
    pythonIndexUrl: '',
  });

  const {
    routingConfig,
    installConfig: savedInstallConfig,
    loading,
    updateRoutingConfig,
    updateInstallConfig
  } = useSettingsData();

  // Update local installConfig when savedInstallConfig changes
  useEffect(() => {
    if (savedInstallConfig) {
      setInstallConfig(savedInstallConfig);
    }
  }, [savedInstallConfig]);

  const [sectionsVisible, setSectionsVisible] = useState({
    routingConfig: false,
    installConfig: false,
    password: false
  });

  const toggleSection = (section: 'routingConfig' | 'installConfig' | 'password') => {
    setSectionsVisible(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleRoutingConfigChange = async (key: 'enableGlobalRoute' | 'enableGroupNameRoute', value: boolean) => {
    await updateRoutingConfig(key, value);
  };

  const handleInstallConfigChange = (value: string) => {
    setInstallConfig({
      ...installConfig,
      pythonIndexUrl: value
    });
  };

  const saveInstallConfig = async () => {
    await updateInstallConfig('pythonIndexUrl', installConfig.pythonIndexUrl);
  };

  const handlePasswordChangeSuccess = () => {
    setTimeout(() => {
      navigate('/');
    }, 2000);
  };

  const handleLanguageChange = (lang: string) => {
    localStorage.setItem('i18nextLng', lang);
    window.location.reload();
  };

  return (
    <div className="container mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">{t('pages.settings.title')}</h1>

      {/* Language Settings */}
      <div className="bg-white shadow rounded-lg py-4 px-6 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">{t('pages.settings.language')}</h2>
          <div className="flex space-x-3">
            <button
              className={`px-3 py-1.5 rounded-md transition-colors text-sm ${
                currentLanguage.startsWith('en') 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
              }`}
              onClick={() => handleLanguageChange('en')}
            >
              English
            </button>
            <button
              className={`px-3 py-1.5 rounded-md transition-colors text-sm ${
                currentLanguage.startsWith('zh') 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
              }`}
              onClick={() => handleLanguageChange('zh')}
            >
              中文
            </button>
          </div>
        </div>
      </div>

      {/* Route Configuration Settings */}
      <div className="bg-white shadow rounded-lg py-4 px-6 mb-6">
        <div
          className="flex justify-between items-center cursor-pointer"
          onClick={() => toggleSection('routingConfig')}
        >
          <h2 className="font-semibold text-gray-800">{t('pages.settings.routeConfig')}</h2>
          <span className="text-gray-500">
            {sectionsVisible.routingConfig ? '▼' : '►'}
          </span>
        </div>

        {sectionsVisible.routingConfig && (
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
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
        )}
      </div>

      {/* Installation Configuration Settings */}
      <div className="bg-white shadow rounded-lg py-4 px-6 mb-6">
        <div
          className="flex justify-between items-center cursor-pointer"
          onClick={() => toggleSection('installConfig')}
        >
          <h2 className="font-semibold text-gray-800">{t('settings.installConfig')}</h2>
          <span className="text-gray-500">
            {sectionsVisible.installConfig ? '▼' : '►'}
          </span>
        </div>

        {sectionsVisible.installConfig && (
          <div className="space-y-4 mt-4">
            <div className="p-3 bg-gray-50 rounded-md">
              <div className="mb-2">
                <h3 className="font-medium text-gray-700">{t('settings.pythonIndexUrl')}</h3>
                <p className="text-sm text-gray-500">{t('settings.pythonIndexUrlDescription')}</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={installConfig.pythonIndexUrl}
                  onChange={(e) => handleInstallConfigChange(e.target.value)}
                  placeholder={t('settings.pythonIndexUrlPlaceholder')}
                  className="flex-1 mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  disabled={loading}
                />
                <button
                  onClick={saveInstallConfig}
                  disabled={loading}
                  className="mt-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Change Password */}
      <div className="bg-white shadow rounded-lg py-4 px-6 mb-6">
        <div
          className="flex justify-between items-center cursor-pointer"
          onClick={() => toggleSection('password')}
        >
          <h2 className="font-semibold text-gray-800">{t('auth.changePassword')}</h2>
          <span className="text-gray-500">
            {sectionsVisible.password ? '▼' : '►'}
          </span>
        </div>

        {sectionsVisible.password && (
          <div className="max-w-lg mt-4">
            <ChangePasswordForm onSuccess={handlePasswordChangeSuccess} />
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;