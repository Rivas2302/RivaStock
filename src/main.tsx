import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/public-settings.css';
import { AuthProvider } from './AuthContext';
import { BusinessPlanProvider } from './hooks/useBusinessPlan';
import { ThemeProvider } from './components/ThemeProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import './lib/mobileNavigationGuard';

if (typeof crypto.randomUUID !== 'function') {
  (crypto as { randomUUID?: () => string }).randomUUID = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((b, i) =>
      ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'),
    ).join('');
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BusinessPlanProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </BusinessPlanProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
