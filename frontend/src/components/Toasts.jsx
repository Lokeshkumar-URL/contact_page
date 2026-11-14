import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((text, tone = 'success') => {
    const id = ++nextId.current;
    setToasts((list) => [...list.slice(-3), { id, text, tone }]);
    setTimeout(() => dismiss(id), 5500);
  }, [dismiss]);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`} role="status"><span>{t.text}</span><button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button></div>)}
      </div>
    </ToastContext.Provider>
  );
}
