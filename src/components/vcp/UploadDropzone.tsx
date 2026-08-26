'use client';

import { useRef, useState } from 'react';

export function UploadDropzone({
  label,
  hint,
  onFile,
  disabled,
}: {
  label: string;
  hint?: string;
  onFile: (file: File) => Promise<void>;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | null | undefined) {
    if (!file || busy || disabled) return;
    setBusy(true);
    try {
      await onFile(file);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div
      className={dragOver ? 'dropzone is-dragover' : 'dropzone'}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFile(e.target.files?.[0])} disabled={disabled} />
      <p style={{ margin: 0 }}>{busy ? 'Uploading…' : label}</p>
      {hint && (
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
