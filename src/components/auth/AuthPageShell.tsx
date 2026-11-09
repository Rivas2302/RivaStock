import type { ReactNode } from 'react';
import { Globe2, Package, ShoppingBag } from 'lucide-react';

interface Props {
  children: ReactNode;
}

export default function AuthPageShell({ children }: Props) {
  return <div className="auth-v2-page">
    <aside className="auth-v2-aside">
      <a href="/login" className="auth-v2-brand" aria-label="RivaStock, inicio">
        <span className="auth-v2-mark">R</span><span>RivaStock</span>
      </a>
      <div className="auth-v2-intro">
        <h1>Tu comercio, en orden.</h1>
        <p>Stock, ventas y tu catálogo online en un solo lugar. Desde la PC o el celular.</p>
        <ul>
          <li><span><Package size={18}/></span>Sabé qué tenés y qué reponer</li>
          <li><span><ShoppingBag size={18}/></span>Vendé y cobrá en segundos</li>
          <li><span><Globe2 size={18}/></span>Tu catálogo online con pedidos por WhatsApp</li>
        </ul>
      </div>
      <p className="auth-v2-footer">Hecho en General Pico por RivaTech</p>
    </aside>
    <main className="auth-v2-main">
      <a href="/login" className="auth-v2-brand auth-v2-mobile-brand" aria-label="RivaStock, inicio">
        <span className="auth-v2-mark">R</span><span>RivaStock</span>
      </a>
      <div className="auth-v2-content">{children}</div>
    </main>
  </div>;
}
