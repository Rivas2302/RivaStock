import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

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
      navigate('/reset-password', { replace: true });
    });
  }, [searchParams, navigate]);

  return (
    <div className="auth-page">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="auth-card text-center"
      >
        {error ? (
          <>
            <div className="w-16 h-16 bg-rose-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="text-rose-600" size={32} />
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Link inválido</h1>
            <p className="text-slate-500 font-medium mb-6">{error}</p>
            <button
              onClick={() => navigate('/login')}
              className="auth-primary w-full py-3 font-semibold transition-colors"
            >
              Volver al login
            </button>
          </>
        ) : (
          <>
            <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={36} />
            <p className="text-slate-500 font-medium">Validando link...</p>
          </>
        )}
      </motion.div>
    </div>
  );
}
