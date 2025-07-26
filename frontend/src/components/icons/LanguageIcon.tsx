import React from 'react';
import { useTranslation } from 'react-i18next';

export const LanguageIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => {
  const { t } = useTranslation();

  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      {...props}
    >
      <title>{t('common.language')}</title>
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h20" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
};

export default LanguageIcon;
