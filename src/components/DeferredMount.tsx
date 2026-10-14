import { useEffect, useState, type ReactNode } from 'react';

/** Delay optional UI until first use, retaining its state on subsequent closes. */
export default function DeferredMount({ active, children }: { active: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(active);
  useEffect(() => { if (active) setMounted(true); }, [active]);
  return active || mounted ? children : null;
}
