import { useState } from 'react';
import {
  BUSINESS_MODULE_GROUPS,
  BUSINESS_MODULE_LABELS,
  getBusinessModuleDisableBlockers,
  getBusinessModuleEnableRequirements,
  normalizeBusinessModules,
  type BusinessModuleKey,
  type BusinessModules,
} from '../../lib/businessModules';

export default function BusinessModuleEditor({
  modules,
  onChange,
}: {
  modules: BusinessModules;
  onChange: (modules: BusinessModules) => void;
}) {
  const [notice, setNotice] = useState('');

  const toggle = (key: BusinessModuleKey, enabled: boolean) => {
    const blockers = enabled ? [] : getBusinessModuleDisableBlockers(modules, key);
    if (blockers.length) {
      setNotice(`No se puede desactivar ${BUSINESS_MODULE_LABELS[key]} todavía. Primero desactivá: ${blockers.map(item => BUSINESS_MODULE_LABELS[item]).join(', ')}.`);
      return;
    }
    const requirements = enabled ? getBusinessModuleEnableRequirements(modules, key) : [];
    if (requirements.length) {
      setNotice(`Para activar ${BUSINESS_MODULE_LABELS[key]}, activá primero: ${requirements.map(item => BUSINESS_MODULE_LABELS[item]).join(', ')}.`);
      return;
    }
    setNotice('');
    onChange(normalizeBusinessModules({ ...modules, [key]: enabled }));
  };

  return <fieldset className="grid gap-4 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 md:grid-cols-2">
    <legend className="px-1 text-xs font-bold text-slate-600 dark:text-slate-300">Módulos incluidos</legend>
    <p className="text-xs text-slate-500 dark:text-slate-400 md:col-span-2">Inicio, Ajustes y Cerrar sesión siempre están activos.</p>
    {BUSINESS_MODULE_GROUPS.map(group => <section key={group.label} aria-label={group.label} className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.label}</h4>
      <div className="space-y-2">
        {group.modules.map(module => <label key={module.key} className="flex items-start gap-2">
          <input type="checkbox" checked={modules[module.key]} onChange={event => toggle(module.key, event.target.checked)} />
          <span><span className="font-medium">{module.label}</span>{module.dependencies.length > 0 && <span className="block text-[11px] text-slate-500 dark:text-slate-400">Necesita: {module.dependencies.map(key => BUSINESS_MODULE_LABELS[key]).join(' y ')}</span>}</span>
        </label>)}
      </div>
    </section>)}
    {notice && <p role="alert" className="text-xs font-semibold text-amber-800 dark:text-amber-200 md:col-span-2">{notice}</p>}
  </fieldset>;
}
