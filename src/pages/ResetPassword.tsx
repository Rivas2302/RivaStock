import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

export default function ResetPassword() {
  const [password, setPassword]           = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword]   = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [success, setSuccess]             = useState(false);
  // Supabase fires PASSWORD_RECOVERY event when the user lands via the email link
  const [ready, setReady]                 = useState(false);

  const navigate          = useNavigate();
  const [searchParams] = useSearchParams();
  const isInvitation = searchParams.get('type') === 'invite';
  const isTemporaryLogin = searchParams.get('type') === 'temporary';

  useEffect(() => {
    let cancelled = false;

    // 1. Detect errors that Supabase puts in the URL hash (otp_expired,
    //    access_denied, etc.) and surface them immediately — no need to wait.
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hash);
    const hashError  = hashParams.get('error_code') ?? hashParams.get('error');
    if (hashError) {
      if (hashError === 'otp_expired' || hashError === 'access_denied') {
        setError('El link expiró o ya fue usado. Solicitá uno nuevo.');
      } else {
        const desc = hashParams.get('error_description')?.replace(/\+/g, ' ');
        setError(desc || 'Link inválido.');
      }
      return;
    }

    // 2. The /auth/confirm route already established a session via verifyOtp;
    //    when we land here we can immediately show the form.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session) setReady(true);
    });

    // 3. Also listen for late events (race with Supabase hash processing).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });

    // 4. Timeout: if nothing fires within 5s, the link is invalid.
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setReady((current) => {
        if (current) return current;
        setError('El link es inválido o ya expiró. Solicitá uno nuevo.');
        return current;
      });
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden'); return; }

    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Link inválido o vencido. Solicitá un nuevo email de recuperación.');
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (updateError) throw new Error(updateError.message);
      if (!isInvitation && !isTemporaryLogin) {
        supabase.auth.signOut({ scope: 'local' }).catch(() => { /* ignore */ });
      }
      setSuccess(true);
      if (!isInvitation && !isTemporaryLogin) setTimeout(() => navigate('/login'), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al actualizar la contraseña.');
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
        <div className="text-center space-y-2 mb-10">
          <div className="auth-brand-mark mx-auto mb-6">
            <Lock className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{isInvitation ? 'Creá tu contraseña' : isTemporaryLogin ? 'Elegí una nueva contraseña' : 'Nueva Contraseña'}</h1>
          <p className="text-slate-500 font-medium">{isInvitation ? 'Definí una contraseña para entrar a RivaStock.' : isTemporaryLogin ? 'Para continuar, reemplazá la contraseña temporal por una propia.' : 'Ingresá tu nueva contraseña de acceso'}</p>
        </div>

        {!ready && !success && !error && (
          <div className="text-center text-slate-500 py-4">
            <Loader2 className="animate-spin mx-auto mb-2" size={24} />
            <p className="text-sm">Validando link de recuperación...</p>
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            role="alert"
            className="auth-alert mb-6 p-4 flex items-center gap-3 text-sm font-semibold"
          >
            <AlertCircle size={18} className="shrink-0" />
            {error}
          </motion.div>
        )}

        {error && !ready && !success && (
          <button
            onClick={() => navigate('/forgot-password')}
            className="auth-primary w-full py-3.5 font-semibold transition-colors"
          >
            Solicitar nuevo link
          </button>
        )}

        {success ? (
          <div className="text-center space-y-6">
            <div className="auth-success p-6 font-semibold flex flex-col items-center gap-4">
              <CheckCircle2 size={48} className="text-[#365FAD]" />
              <span>{isInvitation ? 'Tu contraseña quedó guardada.' : isTemporaryLogin ? 'La contraseña temporal quedó reemplazada.' : 'Contraseña actualizada correctamente. Redirigiendo...'}</span>
            </div>
            {isInvitation && <button type="button" onClick={() => navigate('/', { replace: true })} className="auth-primary w-full py-3.5 font-semibold transition-colors">Entrar a RivaStock</button>}
            {isTemporaryLogin && <button type="button" onClick={() => window.location.assign('/')} className="auth-primary w-full py-3.5 font-semibold transition-colors">Continuar</button>}
          </div>
        ) : ready ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-black text-slate-700 ml-1">Nueva Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
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

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-black text-slate-700 ml-1">Confirmar Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repetí la contraseña"
                className="auth-input pl-12 pr-12 py-3.5 font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="auth-primary w-full py-3.5 font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : isInvitation ? 'Entrar a RivaStock' : 'Actualizar Contraseña'}
            </button>
          </form>
        ) : null}
      </motion.div>
    </div>
  );
}
