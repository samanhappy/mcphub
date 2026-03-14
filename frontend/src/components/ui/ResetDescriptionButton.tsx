import type { MouseEvent } from 'react';
import { RotateCcw } from '@/components/icons/LucideIcons';

interface ResetDescriptionButtonProps {
  title: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  loading?: boolean;
}

const ResetDescriptionButton = ({
  title,
  onClick,
  disabled = false,
  loading = false,
}: ResetDescriptionButtonProps) => {
  return (
    <button
      type="button"
      className="ml-2 p-1 text-amber-600 hover:text-amber-700 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
    </button>
  );
};

export default ResetDescriptionButton;