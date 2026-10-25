import { useState } from 'react';
import KnowledgeAdminDocuments from './KnowledgeAdminDocuments';
import KnowledgeAdminSummary from './KnowledgeAdminSummary';
import KnowledgeIndexJobs from './KnowledgeIndexJobs';
import KnowledgeSearchProbe from './KnowledgeSearchProbe';
import TaxonomyManager from './TaxonomyManager';

type AdminTab = 'summary' | 'documents' | 'indexing' | 'search' | 'organization';
const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'summary', label: 'Resumen' },
  { id: 'documents', label: 'Documentos' },
  { id: 'indexing', label: 'Indexación' },
  { id: 'search', label: 'Probar búsqueda' },
  { id: 'organization', label: 'Organización' },
];

export default function KnowledgeAdmin() {
  const [tab, setTab] = useState<AdminTab>('summary');
  const [refreshKey, setRefreshKey] = useState(0);
  const onMutated = () => setRefreshKey((value) => value + 1);

  return <div className="space-y-5">
    <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)]" role="tablist" aria-label="Administración de Conocimientos">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold ${tab === item.id ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>{item.label}</button>)}
    </nav>
    <div role="tabpanel">
      {tab === 'summary' && <KnowledgeAdminSummary refreshKey={refreshKey}/>}
      {tab === 'documents' && <KnowledgeAdminDocuments onMutated={onMutated}/>}
      {tab === 'indexing' && <KnowledgeIndexJobs/>}
      {tab === 'search' && <KnowledgeSearchProbe/>}
      {tab === 'organization' && <section aria-labelledby="knowledge-organization-heading" className="space-y-4"><div><h2 id="knowledge-organization-heading" className="text-lg font-bold">Organización</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Administrá las categorías y etiquetas de tu biblioteca.</p></div><TaxonomyManager/></section>}
    </div>
  </div>;
}
