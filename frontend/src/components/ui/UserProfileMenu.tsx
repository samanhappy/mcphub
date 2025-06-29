import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { User, Settings, LogOut, Info } from 'lucide-react';
import AboutDialog from './AboutDialog';
import { checkLatestVersion, compareVersions } from '@/utils/version';

interface UserProfileMenuProps {
  collapsed: boolean;
  version: string;
}

const UserProfileMenu: React.FC<UserProfileMenuProps> = ({ collapsed, version }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { auth, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showNewVersionInfo, setShowNewVersionInfo] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check for new version on login and component mount
  useEffect(() => {
    const checkForNewVersion = async () => {
      try {
        const latestVersion = await checkLatestVersion();
        if (latestVersion) {
          setShowNewVersionInfo(compareVersions(version, latestVersion) > 0);
        }
      } catch (error) {
        console.error('Error checking for new version:', error);
      }
    };

    checkForNewVersion();
  }, [version]);

  // Close the menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSettingsClick = () => {
    navigate('/settings');
    setIsOpen(false);
  };

  const handleLogoutClick = () => {
    logout();
    navigate('/login');
  };

  const handleAboutClick = () => {
    setShowAboutDialog(true);
    setIsOpen(false);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex ${collapsed ? 'justify-center' : 'items-center'} w-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors rounded-md ${isOpen ? 'bg-gray-100 dark:bg-gray-700' : ''
          }`}
      >
        <div className="flex-shrink-0 relative">
          <div className="w-5 h-5 flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
            <User className="h-4 w-4 text-gray-700 dark:text-gray-300" />
          </div>
          {showNewVersionInfo && (
            <span className="absolute -top-1 -right-1 block w-2 h-2 bg-red-500 rounded-full"></span>
          )}
        </div>
        {!collapsed && (
          <div className="ml-3 flex flex-col items-start">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {auth.user?.username || t('auth.user')}
            </span>
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-0 transform -translate-y-full left-0 w-full min-w-max bg-white border border-gray-200 dark:bg-gray-800 py-1 z-50">
          <button
            onClick={handleSettingsClick}
            className="flex items-center w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Settings className="h-4 w-4 mr-2" />
            {t('nav.settings')}
          </button>
          <button
            onClick={handleAboutClick}
            className="flex items-center w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 relative"
          >
            <Info className="h-4 w-4 mr-2" />
            {t('about.title')}
            {showNewVersionInfo && (
              <span className="absolute top-2 right-4 block w-2 h-2 bg-red-500 rounded-full"></span>
            )}
          </button>
          <button
            onClick={handleLogoutClick}
            className="flex items-center w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <LogOut className="h-4 w-4 mr-2" />
            {t('app.logout')}
          </button>
        </div>
      )}

      {/* About dialog */}
      <AboutDialog
        isOpen={showAboutDialog}
        onClose={() => setShowAboutDialog(false)}
        version={version}
      />
    </div>
  );
};

export default UserProfileMenu;
