import { Sparkles, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import '../styles/knowledge.css';
import KnowledgeDocumentDetail from '../components/knowledge/KnowledgeDocumentDetail';
import KnowledgeAdmin from '../components/knowledge/KnowledgeAdmin';
import KnowledgeLibrary from '../components/knowledge/KnowledgeLibrary';
import KnowledgePanel from '../components/knowledge/KnowledgePanel';
import UploadDialog from '../components/knowledge/UploadDialog';

export default function Knowledge() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const uploadOpen = searchParams.get('upload') === '1';

  const openUpload = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set('upload', '1');
    return next;
  }, { replace: true });

  const closeUpload = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('upload');
    return next;
  }, { replace: true });

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 text-[var(--ink)]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]"><Sparkles size={15}/>RivaStock AI</p>
          <h2 className="page-heading text-2xl font-bold md:text-3xl">Conocimientos</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">La base de conocimiento de tu negocio para la IA.</p>
          <Link to="/ia" className="mt-3 inline-flex text-sm font-semibold text-[var(--brand)] hover:underline">← IA</Link>
        </div>
        <button type="button" onClick={openUpload} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold shadow-sm"><Upload size={16}/>Subir archivos</button>
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
        <Route index element={<KnowledgePanel refreshKey={refreshKey}/>}/>
        <Route path="biblioteca" element={<KnowledgeLibrary refreshKey={refreshKey}/>}/>
        <Route path="doc/:documentId" element={<KnowledgeDocumentDetail/>}/>
        <Route path="admin" element={<KnowledgeAdmin/>}/>
        <Route path="*" element={<Navigate to="/ia/conocimientos" replace/>}/>
      </Routes>
      <UploadDialog isOpen={uploadOpen} onClose={closeUpload} initialFolderId={searchParams.get('folder')} onUploaded={() => setRefreshKey((value) => value + 1)}/>
    </div>
  );
}
