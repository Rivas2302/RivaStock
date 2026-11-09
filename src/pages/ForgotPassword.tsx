import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Mail } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../AuthContext';
import AuthPageShell from '../components/auth/AuthPageShell';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { sendResetEmail } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendResetEmail(email.trim());
      setSuccess(true);
    } catch {
      setError('No pudimos enviar el link. Revisá el email e intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return <AuthPageShell>
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="forgot-heading">
      <Link to="/login" className="auth-v2-link mb-6 inline-flex items-center gap-2"><ArrowLeft size={17}/>Volver al login</Link>
      <h2 id="forgot-heading">Recuperá tu contraseña</h2>
      <p className="auth-v2-subtitle">Te enviamos un link al email de tu cuenta.</p>
      {error && <p role="alert" className="auth-v2-alert mt-6 flex items-center gap-2"><AlertCircle size={18}/>{error}</p>}
      {success ? <p role="status" className="auth-v2-alert mt-6">Si el email existe, vas a recibir un link para recuperar tu contraseña.</p> : <form onSubmit={handleSubmit} className="auth-v2-form">
        <div className="auth-v2-field"><label htmlFor="recovery-email">Email</label><div className="relative"><Mail size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--auth-muted)]"/><input id="recovery-email" className="auth-v2-input pl-11" type="email" inputMode="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="tu@email.com"/></div></div>
        <button type="submit" disabled={loading} className="auth-v2-submit w-full">{loading?<><Loader2 size={18} className="animate-spin"/>Enviando…</>:'Enviar link de recuperación'}</button>
      </form>}
    </motion.section>
  </AuthPageShell>;
}
