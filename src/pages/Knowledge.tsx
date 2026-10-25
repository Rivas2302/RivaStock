import { Library, Sparkles } from 'lucide-react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import KnowledgeLibrary from '../components/knowledge/KnowledgeLibrary';
import KnowledgePanel from '../components/knowledge/KnowledgePanel';

function KnowledgeSectionPlaceholder({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center shadow-sm">
      <Library className="mx-auto text-[var(--brand)]" size={28}/>
      <h3 className="mt-3 font-bold">{title}</h3>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">Esta sección se habilitará al completar la configuración de Conocimientos.</p>
    </section>
  );
}

function KnowledgeDocumentDetail() {
  return <KnowledgeSectionPlaceholder title="Documento de Conocimientos"/>;
}

function KnowledgeAdmin() {
  return <KnowledgeSectionPlaceholder title="Administración de Conocimientos"/>;
}

export default function Knowledge() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5 text-[var(--ink)]">
      <header>
        <p className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]"><Sparkles size={15}/>RivaStock AI</p>
        <h2 className="page-heading text-2xl font-bold md:text-3xl">Conocimientos</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">La base de conocimiento de tu negocio para la IA.</p>
        <Link to="/ia" className="mt-3 inline-flex text-sm font-semibold text-[var(--brand)] hover:underline">← IA</Link>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)]" aria-label="Secciones de Conocimientos">
        {[
          { to: '.', label: 'Panel', end: true },
          { to: 'biblioteca', label: 'Biblioteca', end: false },
          { to: 'admin', label: 'Administración', end: false },
        ].map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `inline-flex shrink-0 items-center border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${isActive ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<KnowledgePanel/>}/>
        <Route path="biblioteca" element={<KnowledgeLibrary/>}/>
        <Route path="doc/:documentId" element={<KnowledgeDocumentDetail/>}/>
        <Route path="admin" element={<KnowledgeAdmin/>}/>
        <Route path="*" element={<Navigate to="/ia/conocimientos" replace/>}/>
      </Routes>
    </div>
  );
}
