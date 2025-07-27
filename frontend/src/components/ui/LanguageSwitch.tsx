import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageIcon from '@/components/icons/LanguageIcon';

const LanguageSwitch: React.FC = () => {
  const { i18n } = useTranslation();
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language);

  // Available languages
  const availableLanguages = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '中文' }
  ];

  // Update current language when it changes
  useEffect(() => {
    setCurrentLanguage(i18n.language);
  }, [i18n.language]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.language-dropdown')) {
        setLanguageDropdownOpen(false);
      }
    };

    if (languageDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [languageDropdownOpen]);

  const handleLanguageChange = (lang: string) => {
    localStorage.setItem('i18nextLng', lang);
    setLanguageDropdownOpen(false);
    window.location.reload();
  };

  // Always show dropdown for language selection
  const handleLanguageToggle = () => {
    setLanguageDropdownOpen(!languageDropdownOpen);
  };

  return (
    <div className="relative language-dropdown">
      <button
        onClick={handleLanguageToggle}
        className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none"
        aria-label="Language Switcher"
      >
        <LanguageIcon className="h-5 w-5" />
      </button>

      {/* Show dropdown when opened */}
      {languageDropdownOpen && (
        <div className="absolute right-0 mt-2 w-24 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50">
          <div>
            {availableLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`flex items-center w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${currentLanguage.startsWith(lang.code)
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-100'
                  }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LanguageSwitch;
