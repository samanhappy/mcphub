import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { normalizeTags, SERVER_TAG_MAX_LENGTH, isTagCommitKey } from '../../utils/serverTags';

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}

const TagInput: React.FC<TagInputProps> = ({
  id,
  value,
  onChange,
  suggestions = [],
  placeholder,
}) => {
  const { t } = useTranslation();
  const listId = useId();
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const parts = raw.split(',');
    const next = normalizeTags([...value, ...parts]);
    if (next.length !== value.length) {
      onChange(next);
    }
    setDraft('');
  };

  const remove = (tag: string) => {
    onChange(value.filter((item) => item !== tag));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (isTagCommitKey(event.key, isComposing)) {
      event.preventDefault();
      commit(draft);
    } else if (!isComposing && event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    const isComposing = (event.nativeEvent as InputEvent).isComposing === true;
    if (!isComposing && next.includes(',')) {
      commit(next);
    } else {
      setDraft(next);
    }
  };

  const selected = new Set(value.map((tag) => tag.toLowerCase()));
  const available = normalizeTags(suggestions).filter((tag) => !selected.has(tag.toLowerCase()));

  return (
    <div className="w-full form-input flex flex-wrap items-center gap-1.5 py-1.5 px-2">
      {value.map((tag) => (
        <span key={tag} className="hub-tag inline-flex items-center gap-1 text-xs">
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            aria-label={t('server.removeTag', { tag })}
            className="inline-flex items-center"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={draft}
        list={available.length > 0 ? listId : undefined}
        maxLength={SERVER_TAG_MAX_LENGTH}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => draft && commit(draft)}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="flex-1 min-w-[8rem] bg-transparent outline-none text-sm py-0.5"
      />
      {available.length > 0 && (
        <datalist id={listId}>
          {available.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      )}
    </div>
  );
};

export default TagInput;
