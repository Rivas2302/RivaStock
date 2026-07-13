import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 text-center">
        <div className="max-w-md space-y-4">
          <AlertTriangle className="mx-auto text-rose-600" size={48} />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Algo salió mal</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 break-words">
            {this.state.error.message}
          </p>
          <button
            onClick={this.reset}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
