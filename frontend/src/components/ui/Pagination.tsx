import React from 'react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  disabled = false
}) => {
  const { t } = useTranslation();
  // Generate page buttons
  const getPageButtons = () => {
    const buttons = [];
    const maxDisplayedPages = 5; // Maximum number of page buttons to display

    // Always display first page
    buttons.push(
      <button
        key="first"
        onClick={() => onPageChange(1)}
        className={`hub-btn mx-1 ${currentPage === 1 ? 'primary' : ''}`}
      >
        1
      </button>
    );

    // Start range
    const startPage = Math.max(2, currentPage - Math.floor(maxDisplayedPages / 2));

    // If we're showing ellipsis after first page
    if (startPage > 2) {
      buttons.push(
        <span key="ellipsis1" className="px-3 py-1">
          ...
        </span>
      );
    }

    // Middle pages
    for (let i = startPage; i <= Math.min(totalPages - 1, startPage + maxDisplayedPages - 3); i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => onPageChange(i)}
          className={`hub-btn mx-1 ${currentPage === i ? 'primary' : ''}`}
        >
          {i}
        </button>
      );
    }

    // If we're showing ellipsis before last page
    if (startPage + maxDisplayedPages - 3 < totalPages - 1) {
      buttons.push(
        <span key="ellipsis2" className="px-3 py-1">
          ...
        </span>
      );
    }

    // Always display last page if there's more than one page
    if (totalPages > 1) {
      buttons.push(
        <button
          key="last"
          onClick={() => onPageChange(totalPages)}
          className={`hub-btn mx-1 ${currentPage === totalPages ? 'primary' : ''}`}
        >
          {totalPages}
        </button>
      );
    }

    return buttons;
  };

  // If there's only one page, don't render pagination
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex justify-center items-center my-6">
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={disabled || currentPage === 1}
        className="hub-btn mr-2"
      >
        &laquo; {t('common.previous')}
      </button>

      <div className="flex">{getPageButtons()}</div>

      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={disabled || currentPage === totalPages}
        className="hub-btn ml-2"
      >
        {t('common.next')} &raquo;
      </button>
    </div>
  );
};

export default Pagination;