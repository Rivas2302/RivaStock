import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import AuthPageShell from '../components/auth/AuthPageShell';
import { getRivaTechWhatsAppUrl } from '../lib/platformSupport';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (Date.now() < lockUntil) {
      setError(`Demasiados intentos. Esperá ${Math.ceil((lockUntil - Date.now()) / 1000)} segundos.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      setAttempts(0);
      const requestedPath = (location.state as { from?: unknown } | null)?.from;
      navigate(typeof requestedPath === 'string' && requestedPath.startsWith('/pedidos/') ? requestedPath : '/', { replace: true });
    } catch {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) {
        setLockUntil(Date.now() + 30_000);
        setAttempts(0);
        setError('Demasiados intentos fallidos. Esperá 30 segundos.');
      } else {
        setError('Email o contraseña incorrectos.');
      }
    } finally {
      setLoading(false);
    }
  };

  return <AuthPageShell>
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="login-heading">
      <h2 id="login-heading">Ingresá a tu cuenta</h2>
      <p className="auth-v2-subtitle">Con el email que te dimos de alta.</p>
      {error && <p role="alert" className="auth-v2-alert mt-6 flex items-center gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
      <form onSubmit={handleSubmit} className="auth-v2-form">
        <div className="auth-v2-field"><label htmlFor="login-email">Email</label><input id="login-email" className="auth-v2-input" type="email" inputMode="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="tu@email.com"/></div>
        <div className="auth-v2-field">
          <div className="flex items-baseline justify-between gap-2"><label htmlFor="login-password">Contraseña</label><Link to="/forgot-password" className="auth-v2-link">¿Te la olvidaste?</Link></div>
          <div className="auth-v2-password"><input id="login-password" className="auth-v2-input" type={showPassword?'text':'password'} autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} placeholder="Tu contraseña"/><button type="button" className="auth-v2-icon-button" aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        </div>
        <button type="submit" disabled={loading||Date.now()<lockUntil} className="auth-v2-submit w-full">{loading?<><Loader2 className="animate-spin" size={18}/>Ingresando…</>:'Ingresar'}</button>
      </form>
      <div className="auth-v2-bottom"><span>¿No tenés cuenta?</span><a className="auth-v2-link w-fit" href={getRivaTechWhatsAppUrl('Hola RivaTech, quiero pedir una cuenta de RivaStock.')}>Pedila por WhatsApp</a></div>
    </motion.section>
  </AuthPageShell>;
}
