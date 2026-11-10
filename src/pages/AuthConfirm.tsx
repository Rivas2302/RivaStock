import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import AuthPageShell from '../components/auth/AuthPageShell';

type OtpType = 'invite' | 'recovery' | 'signup' | 'email' | 'magiclink' | 'email_change';

const VALID_TYPES: OtpType[] = ['invite', 'recovery', 'signup', 'email', 'magiclink', 'email_change'];

export default function AuthConfirm() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = searchParams.get('token_hash');
    const typeParam = searchParams.get('type') ?? hashParams.get('type');
    const code = searchParams.get('code');
    const errorCode = searchParams.get('error_code') ?? hashParams.get('error_code');
    const errorDescription = searchParams.get('error_description') ?? hashParams.get('error_description');

    if (errorCode) {
      setError(errorCode === 'otp_expired' || errorCode === 'access_denied'
        ? 'El link expiró o ya fue usado. Solicitá uno nuevo desde la app.'
        : errorDescription?.replace(/\+/g, ' ') || 'No se pudo validar el link.');
      return;
    }
    if (typeParam && !VALID_TYPES.includes(typeParam as OtpType)) {
      setError('Link inválido o incompleto.');
      return;
    }

    void (async () => {
      try {
        if (code) {
          // PKCE callback; the app currently uses implicit links, but accepting
          // the authorization code keeps invitation/recovery links compatible.
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && typeParam) {
          // POST prevents email scanners from consuming the one-time token.
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: typeParam as OtpType,
          });
          if (verifyError) throw verifyError;
        } else {
          // Implicit-flow links are consumed by supabase-js from the URL hash.
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session) throw new Error('Link inválido o incompleto.');
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error('El link expiró o ya fue usado. Solicitá uno nuevo.');

        if (typeParam === 'invite') {
          navigate('/reset-password?type=invite', { replace: true });
          return;
        }
        if (typeParam === 'recovery') {
          navigate('/reset-password?type=recovery', { replace: true });
          return;
        }
        const metadata = session.user.user_metadata ?? {};
        if (metadata.must_change_password === true) {
          navigate('/reset-password?type=temporary', { replace: true });
        } else if (metadata.password_set !== true || !(metadata.display_name || metadata.full_name)) {
          navigate('/reset-password?type=first-login', { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '';
        setError(message.toLowerCase().includes('expired') || message.toLowerCase().includes('otp')
          ? 'El link expiró o ya fue usado. Solicitá uno nuevo desde la app.'
          : 'No se pudo validar el link. Solicitá uno nuevo desde la app.');
      }
    })();
  }, [searchParams, navigate]);

  return <AuthPageShell><motion.section initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="text-center" aria-live="polite">
    {error ? <><AlertCircle className="mx-auto mb-4 text-[var(--danger-ink)]" size={32}/><h2 className="mb-2">Link inválido</h2><p className="auth-v2-subtitle mb-6">{error}</p><button type="button" onClick={()=>navigate('/login')} className="auth-v2-submit w-full">Volver al ingreso</button></> : <><Loader2 className="mx-auto mb-4 animate-spin text-[var(--auth-accent)]" size={32}/><p className="auth-v2-subtitle">Validando el link…</p></>}
  </motion.section></AuthPageShell>;
}
