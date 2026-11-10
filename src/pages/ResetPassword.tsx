import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { getRivaTechWhatsAppUrl } from '../lib/platformSupport';
import { normalizeDisplayName, saveAccountProfile, validateDisplayName } from '../lib/accountProfile';
import { AlertCircle, Check, Circle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import AuthPageShell from '../components/auth/AuthPageShell';

export default function ResetPassword() {
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionEmail, setSessionEmail] = useState('');
  const [requiresName, setRequiresName] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, authUser, refreshAuthProfile } = useAuth();
  const flowType = searchParams.get('type');
  const isInvitation = flowType === 'invite';
  const isFirstLogin = flowType === 'first-login';
  const isTemporaryLogin = flowType === 'temporary';
  const isRecovery = flowType === 'recovery' || (!isInvitation && !isFirstLogin && !isTemporaryLogin);
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
        : 'El link no es válido. Solicitá uno nuevo desde el ingreso.');
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        const metadata = session.user.user_metadata ?? {};
        setSessionEmail(session.user.email ?? '');
        const safeName = normalizeDisplayName(metadata.display_name)
          || normalizeDisplayName(metadata.full_name)
          || authUser?.displayName
          || '';
        if (safeName) setDisplayName(current => current || safeName);
        if (isInvitation || isFirstLogin || metadata.password_set !== true || !safeName) setRequiresName(true);
        setReady(true);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'USER_UPDATED') setReady(true);
    });
    const timeout = setTimeout(() => {
      if (!cancelled) setReady(current => {
        if (!current) setError('El link no es válido o ya expiró. Solicitá uno nuevo.');
        return current;
      });
    }, 7000);
    return () => { cancelled = true; clearTimeout(timeout); subscription.unsubscribe(); };
  }, [isFirstLogin, isInvitation]);

  useEffect(() => {
    if (isInvitation || isFirstLogin || authUser?.needsProfileSetup) setRequiresName(true);
    if (authUser?.displayName) setDisplayName(current => current || authUser.displayName);
  }, [authUser?.displayName, authUser?.needsProfileSetup, isFirstLogin, isInvitation]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (requiresName) {
      const nameError = validateDisplayName(displayName);
      if (nameError) { setError(nameError); return; }
    }
    if (!hasEightCharacters) { setError('La contraseña debe tener 8 caracteres o más.'); return; }
    if (!hasNumber) { setError('La contraseña debe incluir al menos un número.'); return; }
    if (!passwordsMatch) { setError('Las contraseñas no coinciden.'); return; }
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('El link expiró o ya fue usado. Solicitá uno nuevo.');
      const finalName = normalizeDisplayName(displayName) || authUser?.displayName || '';
      await saveAccountProfile(finalName, password);
      if (isRecovery) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        setSuccess(true);
        setTimeout(() => navigate('/login', { replace: true }), 1500);
      } else {
        await refreshAuthProfile();
        setSuccess(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la contraseña y el perfil.');
    } finally {
      setLoading(false);
    }
  };

  const email = authUser?.email || sessionEmail;
  const businessName = user?.businessName?.trim();
  const heading = isInvitation || isFirstLogin ? 'Creá tu contraseña'
    : isTemporaryLogin ? 'Elegí una contraseña nueva'
      : 'Elegí tu contraseña nueva';
  const description = isInvitation || isFirstLogin ? 'Completá tu nombre y definí la contraseña para entrar a RivaStock.'
    : isTemporaryLogin ? 'Para continuar, reemplazá la contraseña temporal por una propia.'
      : 'Elegí una contraseña nueva para volver a entrar a RivaStock.';

  return <AuthPageShell>
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="password-heading">
      {isInvitation && <p className="auth-v2-subtitle mb-2">Bienvenida{businessName ? `, ${businessName}` : ' a RivaStock'}</p>}
      <h2 id="password-heading">{heading}</h2>
      <p className="auth-v2-subtitle">{description}</p>
      {!ready && !success && !error && <div role="status" className="auth-v2-progress"><Loader2 size={18} className="animate-spin"/>Validando el link…</div>}
      {error && <p role="alert" className="auth-v2-alert mt-6 flex items-center gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
      {success ? <div className="auth-v2-alert mt-6 space-y-4" role="status">
        <p>{isInvitation || isFirstLogin ? 'Tu nombre y contraseña quedaron guardados.' : isTemporaryLogin ? 'Tu nombre y contraseña quedaron guardados.' : 'Contraseña actualizada. Te vamos a llevar al ingreso.'}</p>
        {!isRecovery && <button type="button" onClick={() => navigate('/', { replace: true })} className="auth-v2-submit w-full">Entrar a RivaStock</button>}
      </div> : ready && <form onSubmit={handleSubmit} className="auth-v2-form">
        {requiresName && <div className="auth-v2-field"><label htmlFor="display-name">¿Cómo te llamás?</label><input id="display-name" className="auth-v2-input" type="text" autoComplete="name" maxLength={80} required value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Tu nombre"/></div>}
        {isInvitation && <div className="auth-v2-field"><label htmlFor="invite-email">Email</label><input id="invite-email" className="auth-v2-input" type="email" value={email} readOnly aria-readonly="true"/></div>}
        <div className="auth-v2-field"><label htmlFor="new-password">Contraseña nueva</label><div className="auth-v2-password"><input id="new-password" className="auth-v2-input" type={showPassword?'text':'password'} autoComplete="new-password" required value={password} onChange={event=>setPassword(event.target.value)} placeholder="Elegí una contraseña"/><button type="button" className="auth-v2-icon-button" aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><ul className="auth-v2-checklist"><li className={hasEightCharacters?'valid':''}>{hasEightCharacters?<Check size={16}/>:<Circle size={16}/>}8 caracteres o más</li><li className={hasNumber?'valid':''}>{hasNumber?<Check size={16}/>:<Circle size={16}/>}Al menos un número</li></ul></div>
        <div className="auth-v2-field"><label htmlFor="confirm-password">Repetila</label><input id="confirm-password" className="auth-v2-input" type={showPassword?'text':'password'} autoComplete="new-password" required value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} placeholder="Volvé a escribirla"/></div>
        <button type="submit" disabled={loading} className="auth-v2-submit w-full">{loading?<><Loader2 size={18} className="animate-spin"/>Guardando…</>:isInvitation || isFirstLogin?'Crear contraseña y entrar':'Guardar contraseña'}</button>
      </form>}
      {isInvitation && <p className="auth-v2-bottom">¿Algún problema? <a className="auth-v2-link" href={getRivaTechWhatsAppUrl('Hola RivaTech, necesito ayuda para crear mi contraseña de RivaStock.')}>Escribinos por WhatsApp</a></p>}
    </motion.section>
  </AuthPageShell>;
}
