import { useState } from 'react';
import { IconCopy, IconEdit, IconRefresh } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

interface NarrativePanelProps {
  value: string;
  onChange?: (value: string) => void;
  onRegenerate?: () => void;
  readOnly?: boolean;
  className?: string;
}

export function NarrativePanel({
  value,
  onChange,
  onRegenerate,
  readOnly = false,
  className,
}: NarrativePanelProps) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {editing && !readOnly ? (
        <textarea
          className="w-full text-13 text-text-primary bg-bg-surface rounded-md p-3 resize-none outline-none"
          style={{ border: '0.5px solid var(--border-emphasis)', minHeight: 100 }}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          autoFocus
        />
      ) : (
        <p
          className="text-13 text-text-primary leading-relaxed"
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {value || <span className="text-text-tertiary">No closure plan yet.</span>}
        </p>
      )}
      {!readOnly && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="inline-flex items-center gap-1 text-11 text-text-secondary hover:text-text-primary px-2 py-1 rounded-sm"
            style={{ border: '0.5px solid var(--border-hairline)' }}
          >
            <IconEdit size={11} />
            Edit
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!onRegenerate}
            className="inline-flex items-center gap-1 text-11 text-text-secondary hover:text-text-primary px-2 py-1 rounded-sm disabled:opacity-40"
            style={{ border: '0.5px solid var(--border-hairline)' }}
          >
            <IconRefresh size={11} />
            Regenerate
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-11 text-text-secondary hover:text-text-primary px-2 py-1 rounded-sm"
            style={{ border: '0.5px solid var(--border-hairline)' }}
          >
            <IconCopy size={11} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
