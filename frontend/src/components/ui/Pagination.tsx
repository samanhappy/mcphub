import React from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange
}) => {
  // Generate page buttons
  const getPageButtons = () => {
    const buttons = [];
    const maxDisplayedPages = 5; // Maximum number of page buttons to display

    // Always display first page
    buttons.push(
      <button
        key="first"
        onClick={() => onPageChange(1)}
        className={`px-3 py-1 mx-1 rounded ${currentPage === 1
          ? 'bg-blue-500 text-white btn-primary'
          : 'bg-gray-200 hover:bg-gray-300 text-gray-700 btn-secondary'
          }`}
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
          className={`px-3 py-1 mx-1 rounded ${currentPage === i
            ? 'bg-blue-500 text-white btn-primary'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-700 btn-secondary'
            }`}
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
          className={`px-3 py-1 mx-1 rounded ${currentPage === totalPages
            ? 'bg-blue-500 text-white btn-primary'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-700 btn-secondary'
            }`}
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
        disabled={currentPage === 1}
        className={`px-3 py-1 rounded mr-2 ${currentPage === 1
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-gray-200 hover:bg-gray-300 text-gray-700 btn-secondary'
          }`}
      >
        &laquo; Prev
      </button>

      <div className="flex">{getPageButtons()}</div>

      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        className={`px-3 py-1 rounded ml-2 ${currentPage === totalPages
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-gray-200 hover:bg-gray-300 text-gray-700 btn-secondary'
          }`}
      >
        Next &raquo;
      </button>
    </div>
  );
};

export default Pagination;