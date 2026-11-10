import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface NewOrderNotice {
  orderCode: string | null;
  channel: 'retail' | 'reseller';
}

interface OrderRealtimeRow {
  user_id?: string;
  channel?: string;
  is_read?: boolean;
  order_code?: string | null;
}

export function useUnreadCatalogOrders(ownerUid: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notice, setNotice] = useState<NewOrderNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!ownerUid) {
      setUnreadCount(0);
      setNotice(null);
      return;
    }

    let active = true;
    const refreshCount = async () => {
      const result = await supabase.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ownerUid)
        .eq('is_read', false);
      if (active && !result.error) setUnreadCount(result.count ?? 0);
    };

    void refreshCount();
    const channel = supabase.channel(`catalog-order-notices:${ownerUid}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${ownerUid}`,
      }, payload => {
        const row = payload.new as OrderRealtimeRow;
        if (payload.eventType === 'INSERT' && (row.channel === 'retail' || row.channel === 'reseller') && row.is_read === false) {
          setNotice({ orderCode: row.order_code ?? null, channel: row.channel });
        }
        void refreshCount();
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [ownerUid]);

  return { unreadCount, notice, clearNotice };
}
