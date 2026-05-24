import { useToastStore } from '../lib/toast';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ToastContainer() {
  const { toasts, remove } = useToastStore();

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={cn(
              "pointer-events-auto flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl font-bold text-sm",
              toast.type === 'success' && "bg-emerald-500 text-white",
              toast.type === 'error'   && "bg-rose-500 text-white",
              toast.type === 'info'    && "bg-slate-800 text-white dark:bg-slate-700",
            )}
          >
            <span>{toast.text}</span>
            <button
              onClick={() => remove(toast.id)}
              className="ml-2 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}