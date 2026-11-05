import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { supabase } from '../../lib/supabase';
import { startVisiblePolling } from '../../lib/visiblePolling';

export default function AIActionNotification() {
  const { isOwner } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    const refresh = async () => {
      const { count: pending, error } = await supabase
        .from('ai_action_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (active && !error) setCount(pending ?? 0);
    };
    void refresh();
    const stopPolling = startVisiblePolling(() => refresh(), 30_000);
    return () => { active = false; stopPolling(); };
  }, [isOwner]);

  if (!isOwner || count === 0) return null;
  return <aside role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100">
    <p className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck size={17}/>{count} {count === 1 ? 'acción de IA espera' : 'acciones de IA esperan'} tu revisión.</p>
    <Link to="/ia?view=actions" className="inline-flex items-center gap-1 text-sm font-bold text-indigo-700 dark:text-indigo-300">Revisar en IA<ArrowRight size={15}/></Link>
  </aside>;
}
