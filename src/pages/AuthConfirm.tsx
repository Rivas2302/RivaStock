import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const token_hash = searchParams.get('token_hash');
    const typeParam  = searchParams.get('type');

    if (!token_hash || !typeParam || !VALID_TYPES.includes(typeParam as OtpType)) {
      setError('Link inválido o incompleto.');
      return;
    }

    // verifyOtp is a POST request, so email-client prefetchers (Gmail's link
    // scanner, corporate firewalls, etc.) do not consume the token by simply
    // GETting the URL. The token is only consumed when this page runs.
    supabase.auth.verifyOtp({
      token_hash,
      type: typeParam as OtpType,
    }).then(({ error: verifyErr }) => {
      if (verifyErr) {
        const msg = verifyErr.message || '';
        if (msg.toLowerCase().includes('expired')) {
          setError('El link expiró. Solicitá uno nuevo desde la app.');
        } else {
          setError(msg || 'No se pudo validar el link.');
        }
        return;
      }
      // Session established. Both invite and recovery flows continue at
      // /reset-password to set/update the password.
      navigate(typeParam === 'invite' ? '/reset-password?type=invite' : '/reset-password', { replace: true });
    });
  }, [searchParams, navigate]);

  return <AuthPageShell><motion.section initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="text-center" aria-live="polite">
    {error ? <><AlertCircle className="mx-auto mb-4 text-[var(--danger-ink)]" size={32}/><h2 className="mb-2">Link inválido</h2><p className="auth-v2-subtitle mb-6">{error}</p><button type="button" onClick={()=>navigate('/login')} className="auth-v2-submit w-full">Volver al ingreso</button></> : <><Loader2 className="mx-auto mb-4 animate-spin text-[var(--auth-accent)]" size={32}/><p className="auth-v2-subtitle">Validando el link…</p></>}
  </motion.section></AuthPageShell>;
}
