import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { LogIn, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

export default function Login() {
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [attempts, setAttempts]       = useState(0);
  const [lockUntil, setLockUntil]     = useState(0);

  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now < lockUntil) {
      const secs = Math.ceil((lockUntil - now) / 1000);
      setError(`Demasiados intentos. Esperá ${secs} segundos.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      setAttempts(0);
      navigate('/');
    } catch (err: unknown) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) {
        setLockUntil(Date.now() + 30_000);
        setAttempts(0);
        setError('Demasiados intentos fallidos. Esperá 30 segundos.');
      } else {
        setError(err instanceof Error ? err.message : 'Ocurrió un error al iniciar sesión.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="auth-card"
      >
        <div className="space-y-3 mb-9">
          <div className="auth-brand-mark mb-6">
            <LogIn size={22} strokeWidth={1.8} />
          </div>
          <p className="auth-kicker">RivaStock</p>
          <h1 className="auth-title">Bienvenido</h1>
          <p className="text-slate-500 font-medium">Inicia sesión en tu cuenta de RivaStock</p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="auth-alert mb-6 p-4 flex items-center gap-3 text-sm font-semibold"
          >
            <AlertCircle size={18} className="shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="auth-label">Email</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="auth-input pl-12 pr-4 py-3.5 font-medium"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between ml-1">
              <label className="text-sm font-black text-slate-700">Contraseña</label>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="auth-link text-xs"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="auth-input pl-12 pr-12 py-3.5 font-medium"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#1D2026] transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || Date.now() < lockUntil}
            className="auth-primary w-full py-3.5 font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : 'Iniciar Sesión'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
