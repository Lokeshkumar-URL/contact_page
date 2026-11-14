import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); previous?.focus?.(); };
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body">{children}</div>
        <div className="button-group">
          <button type="button" className="secondary-button" ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="danger-solid" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
