import React from 'react';

interface CursorPaginationProps {
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
}

const CursorPagination: React.FC<CursorPaginationProps> = ({
  currentPage,
  hasNextPage,
  hasPreviousPage,
  onNextPage,
  onPreviousPage,
}) => {
  return (
    <div className="flex items-center justify-center space-x-2 my-6">
      {/* Previous button */}
      <button
        onClick={onPreviousPage}
        disabled={!hasPreviousPage}
        className="hub-btn"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 inline-block mr-1"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        Prev
      </button>

      {/* Current page indicator */}
      <span className="hub-btn primary">
        Page {currentPage}
      </span>

      {/* Next button */}
      <button
        onClick={onNextPage}
        disabled={!hasNextPage}
        className="hub-btn"
      >
        Next
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 inline-block ml-1"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
};

export default CursorPagination;
