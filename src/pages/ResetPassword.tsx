import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { getRivaTechWhatsAppUrl } from '../lib/platformSupport';
import { AlertCircle, Check, Circle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import AuthPageShell from '../components/auth/AuthPageShell';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionEmail, setSessionEmail] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, authUser } = useAuth();
  const isInvitation = searchParams.get('type') === 'invite';
  const isTemporaryLogin = searchParams.get('type') === 'temporary';
  const hasEightCharacters = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  useEffect(() => {
    let cancelled = false;
    const hashParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.hash.slice(1) : '');
    const hashError = hashParams.get('error_code') ?? hashParams.get('error');
    if (hashError) {
      setError(hashError === 'otp_expired' || hashError === 'access_denied'
        ? 'El link expiró o ya fue usado. Solicitá uno nuevo.'
        : (hashParams.get('error_description')?.replace(/\+/g, ' ') || 'El link no es válido.'));
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        setSessionEmail(session.user?.email ?? '');
        setReady(true);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    const timeout = setTimeout(() => {
      if (!cancelled) setReady(current => {
        if (!current) setError('El link no es válido o ya expiró. Solicitá uno nuevo.');
        return current;
      });
    }, 5000);
    return () => { cancelled = true; clearTimeout(timeout); subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasEightCharacters) { setError('La contraseña debe tener 8 caracteres o más.'); return; }
    if (!hasNumber) { setError('La contraseña debe incluir al menos un número.'); return; }
    if (!passwordsMatch) { setError('Las contraseñas no coinciden.'); return; }
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('El link expiró o ya fue usado. Solicitá uno nuevo.');
      const { error: updateError } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
      if (updateError) throw new Error(updateError.message);
      if (!isInvitation && !isTemporaryLogin) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
      setSuccess(true);
      if (!isInvitation && !isTemporaryLogin) setTimeout(() => navigate('/login'), 3000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const email = authUser?.email || sessionEmail;
  const businessName = user?.businessName?.trim();

  return <AuthPageShell>
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="password-heading">
      {isInvitation && <p className="auth-v2-subtitle mb-2">Bienvenida{businessName ? `, ${businessName}` : ' a RivaStock'}</p>}
      <h2 id="password-heading">{isInvitation ? 'Creá tu contraseña' : isTemporaryLogin ? 'Elegí una nueva contraseña' : 'Restablecé tu contraseña'}</h2>
      <p className="auth-v2-subtitle">{isInvitation ? 'La vas a usar para entrar desde la PC o el celular.' : isTemporaryLogin ? 'Para continuar, reemplazá la contraseña temporal por una propia.' : 'Elegí una nueva contraseña para entrar a RivaStock.'}</p>
      {!ready && !success && !error && <div role="status" className="auth-v2-progress"><Loader2 size={18} className="animate-spin"/>Validando el link…</div>}
      {error && <p role="alert" className="auth-v2-alert mt-6 flex items-center gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
      {success ? <div className="auth-v2-alert mt-6 space-y-4" role="status"><p>{isInvitation ? 'Tu contraseña quedó guardada.' : isTemporaryLogin ? 'La contraseña temporal quedó reemplazada.' : 'Contraseña actualizada. Te vamos a llevar al ingreso.'}</p>{(isInvitation||isTemporaryLogin)&&<button type="button" onClick={()=>navigate('/',{replace:true})} className="auth-v2-submit w-full">Entrar a RivaStock</button>}</div>
        : ready && <form onSubmit={handleSubmit} className="auth-v2-form">
          {isInvitation && <div className="auth-v2-field"><label htmlFor="invite-email">Email</label><input id="invite-email" className="auth-v2-input" type="email" value={email} readOnly aria-readonly="true"/></div>}
          <div className="auth-v2-field"><label htmlFor="new-password">Contraseña nueva</label><div className="auth-v2-password"><input id="new-password" className="auth-v2-input" type={showPassword?'text':'password'} autoComplete="new-password" required value={password} onChange={event=>setPassword(event.target.value)} placeholder="Elegí una contraseña"/><button type="button" className="auth-v2-icon-button" aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><ul className="auth-v2-checklist"><li className={hasEightCharacters?'valid':''}>{hasEightCharacters?<Check size={16}/>:<Circle size={16}/>}8 caracteres o más</li><li className={hasNumber?'valid':''}>{hasNumber?<Check size={16}/>:<Circle size={16}/>}Al menos un número</li></ul></div>
          <div className="auth-v2-field"><label htmlFor="confirm-password">Repetila</label><input id="confirm-password" className="auth-v2-input" type={showPassword?'text':'password'} autoComplete="new-password" required value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} placeholder="Volvé a escribirla"/></div>
          <button type="submit" disabled={loading} className="auth-v2-submit w-full">{loading?<><Loader2 size={18} className="animate-spin"/>Guardando…</>:isInvitation?'Crear contraseña y entrar':'Guardar contraseña'}</button>
        </form>}
      {isInvitation && <p className="auth-v2-bottom">¿Algún problema? <a className="auth-v2-link" href={getRivaTechWhatsAppUrl('Hola RivaTech, necesito ayuda para crear mi contraseña de RivaStock.')}>Escribinos por WhatsApp</a></p>}
    </motion.section>
  </AuthPageShell>;
}
