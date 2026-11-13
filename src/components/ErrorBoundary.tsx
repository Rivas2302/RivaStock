import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { hasUnsavedAppChanges, persistAppDrafts, reloadCurrentPage } from '../lib/buildRuntime';

interface Props { children: ReactNode }
interface State { error: Error | null; reloadBlocked: boolean }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, reloadBlocked: false };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, reloadBlocked: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
    persistAppDrafts();
  }

  reset() {
    if (hasUnsavedAppChanges()) {
      this.setState({ reloadBlocked: true });
      return;
    }
    reloadCurrentPage();
  }

  componentDidUpdate() {
    if (this.state.error && this.state.reloadBlocked && !hasUnsavedAppChanges()) {
      this.setState({ reloadBlocked: false });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 text-center">
        <div className="max-w-md space-y-4">
          <AlertTriangle className="mx-auto text-rose-600" size={48} />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">No pudimos cargar esta pantalla</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Revisá tu conexión e intentá de nuevo. La página va a conservar su dirección.
          </p>
          <button
            onClick={this.reset}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold"
          >
            Reintentar
          </button>
          {this.state.reloadBlocked && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Guardá o cerrá el formulario antes de actualizar para conservar tus cambios.</p>}
          <details className="text-left text-xs text-slate-500 dark:text-slate-400">
            <summary className="cursor-pointer">Ver detalle</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{this.state.error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
