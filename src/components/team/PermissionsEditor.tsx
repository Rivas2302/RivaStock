import { useCallback } from 'react';
import type { ModuleKey, ActionKey, PermissionMatrix } from '../../types';

interface Props {
  value: PermissionMatrix;
  onChange: (matrix: PermissionMatrix) => void;
}

const MODULES: ModuleKey[] = [
  'stock',
  'ventas',
  'caja',
  'ingresos',
  'pedidos',
  'presupuestos',
  'clientes',
  'proveedores',
  'config',
];

const ACTIONS: ActionKey[] = ['read', 'write', 'delete'];

const MODULE_LABELS: Record<ModuleKey, string> = {
  stock:        'Stock',
  ventas:       'Ventas',
  caja:         'Flujo de Caja',
  ingresos:     'Ingresos',
  pedidos:      'Pedidos',
  presupuestos: 'Presupuestos',
  clientes:     'Clientes',
  proveedores:  'Proveedores',
  config:       'Configuración',
};

const ACTION_LABELS: Record<ActionKey, string> = {
  read:   'Lectura',
  write:  'Escritura',
  delete: 'Eliminar',
};

export default function PermissionsEditor({ value, onChange }: Props) {
  const handleToggle = useCallback((module: ModuleKey, action: ActionKey) => {
    onChange({
      ...value,
      [module]: {
        ...value[module],
        [action]: !value[module][action],
      },
    });
  }, [value, onChange]);

  return (
    <div className="permissions-editor overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-2 px-3 font-bold text-slate-600 dark:text-slate-400">Módulo</th>
            {ACTIONS.map(action => (
              <th key={action} className="text-center py-2 px-3 font-bold text-slate-600 dark:text-slate-400">
                {ACTION_LABELS[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map(module => (
            <tr key={module} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300">
                {MODULE_LABELS[module]}
              </td>
              {ACTIONS.map(action => (
                <td key={action} className="text-center py-2.5 px-3">
                  <button
                    type="button"
                    onClick={() => handleToggle(module, action)}
                    className={`w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center mx-auto ${
                      value[module][action]
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-slate-300 dark:border-slate-600 text-slate-400 hover:border-indigo-400'
                    }`}
                    aria-label={`${MODULE_LABELS[module]} - ${ACTION_LABELS[action]}`}
                  >
                    {value[module][action] && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
