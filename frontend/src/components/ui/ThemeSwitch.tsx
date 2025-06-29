import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { Sun, Moon } from 'lucide-react';

const ThemeSwitch: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center space-x-2">
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
        <button
          onClick={() => setTheme('light')}
          className={`flex items-center justify-center rounded-md p-1.5 ${theme === 'light'
            ? 'bg-white text-yellow-600 shadow'
            : 'text-black dark:text-gray-300 hover:text-yellow-600 dark:hover:text-yellow-500'
            }`}
          title={t('theme.light')}
          aria-label={t('theme.light')}
        >
          <Sun size={18} />
        </button>
        <button
          onClick={() => setTheme('dark')}
          className={`flex items-center justify-center rounded-md p-1.5 ${theme === 'dark'
            ? 'bg-gray-800 text-blue-400 shadow'
            : 'text-gray-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400'
            }`}
          title={t('theme.dark')}
          aria-label={t('theme.dark')}
        >
          <Moon size={18} />
        </button>
        {/* <button
          onClick={() => setTheme('system')}
          className={`flex items-center justify-center rounded-md p-1.5 ${theme === 'system'
              ? 'bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 shadow'
              : 'text-black dark:text-gray-300 hover:text-green-600 dark:hover:text-green-400'
            }`}
          title={t('theme.system')}
          aria-label={t('theme.system')}
        >
          <Monitor size={18} />
        </button> */}
      </div>
    </div>
  );
};

export default ThemeSwitch;