import { useToastStore } from '../lib/toast';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ToastContainer() {
  const { toasts, remove } = useToastStore();

  return (
    <div className="toast-container flex w-full flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={cn(
              "app-toast pointer-events-auto flex w-full sm:w-auto sm:max-w-md items-start gap-3 px-4 sm:px-5 py-3.5 rounded-2xl shadow-2xl font-bold text-sm",
              toast.type === 'success' && "app-toast-success",
              toast.type === 'error'   && "app-toast-error",
              toast.type === 'info'    && "app-toast-info",
            )}
          >
            <span className="min-w-0 flex-1 break-words leading-snug">{toast.text}</span>
            <button
              onClick={() => remove(toast.id)}
              className="ml-auto shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
