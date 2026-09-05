import { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

const Ctx = createContext(null);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((x) => x.filter((t) => t.id !== id)), []);

  const push = useCallback((t) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-3), { id, kind: t.kind || 'info', ...t }]);
    setTimeout(() => dismiss(id), 10000);
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-[1200] w-[380px] max-w-[calc(100vw-2rem)] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-slide-in panel p-3.5 flex gap-3 shadow-2xl border-l-4 ${
              t.kind === 'warn' ? 'border-l-warn' : t.kind === 'bad' ? 'border-l-bad' : 'border-l-ir-blue'
            }`}
          >
            <div className={`mt-0.5 ${t.kind === 'warn' ? 'text-warn' : t.kind === 'bad' ? 'text-bad' : 'text-ir-sky'}`}>
              {t.kind === 'info' ? <Info size={17} /> : <AlertTriangle size={17} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.body && <div className="text-[12px] text-muted mt-0.5 leading-snug">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-slate-200 self-start">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
