import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import './Login.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!lockUntil) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= lockUntil) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [lockUntil]);

  const isCoolingDown = now < lockUntil;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
        setNow(Date.now());
        setAttempts(0);
        setError('Demasiados intentos fallidos. Esperá 30 segundos.');
      } else {
        setError('Email o contraseña incorrectos.');
      }
    } finally {
      setLoading(false);
    }
  };

  const whatsappNumber = import.meta.env.VITE_RIVATECH_WHATSAPP_NUMBER?.replace(/\D/g, '') || '5492302381814';
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hola RivaTech, quiero pedir una cuenta de RivaStock.')}`;

  return (
    <div className="login-page">
      <div className="lp-background" aria-hidden="true">
        <div className="lp-orb lp-orb-one" />
        <div className="lp-orb lp-orb-two" />
        <div className="lp-orb lp-orb-three" />
      </div>

      <div className="lp-page">
        <section className="lp-left" aria-label="Presentación de RivaStock">
          <Link className="lp-brand" to="/" aria-label="RivaStock, inicio">
            <span className="lp-mark" aria-hidden="true">R</span>
            <span>RivaStock</span>
          </Link>

          <div className="lp-hero">
            <h1>
              <span className="lp-line"><i>Tu comercio,</i></span>
              <span className="lp-line"><i><span className="lp-gradient">en orden.</span></i></span>
            </h1>
            <p className="lp-lead lp-fade lp-delay-45">Stock, ventas y tu catálogo online en un solo lugar. Desde la PC o el celular.</p>
            <ul className="lp-features">
              <li className="lp-fade lp-delay-60">
                <span className="lp-feature-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7.5 10 4l6 3.5v7L10 18l-6-3.5v-7Z"/><path d="M10 11v7M4.5 7.8 10 11l5.5-3.2"/></svg></span>
                Sabé qué tenés y qué reponer
              </li>
              <li className="lp-fade lp-delay-75">
                <span className="lp-feature-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h12l-1 10H5L4 7ZM7 7a3 3 0 0 1 6 0"/></svg></span>
                Vendé y cobrá en segundos
              </li>
              <li className="lp-fade lp-delay-90">
                <span className="lp-feature-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.2 2.2 2.2 11.8 0 14M10 3c-2.2 2.2-2.2 11.8 0 14"/></svg></span>
                Tu catálogo online con pedidos por WhatsApp
              </li>
            </ul>

            <div className="lp-toasts" aria-hidden="true">
              <div className="lp-toast">
                <b><svg viewBox="0 0 20 20"><path d="m3 14 5-5 3 3 6-7M12 5h5v5"/></svg></b>
                <span>Venta registrada<small>Ejemplo · cobrada en segundos</small></span>
              </div>
              <div className="lp-toast lp-toast-warning">
                <b><svg viewBox="0 0 20 20"><path d="M10 3 2.5 16h15L10 3ZM10 8v4M10 14h.01"/></svg></b>
                <span>Hay que reponer<small>Ejemplo · quedan pocas unidades</small></span>
              </div>
              <div className="lp-toast">
                <b><svg viewBox="0 0 20 20"><path d="M4 4h12v9H9l-4 3v-3H4V4Z"/></svg></b>
                <span>Nuevo pedido por WhatsApp<small>Ejemplo · desde tu catálogo</small></span>
              </div>
            </div>
          </div>

          <p className="lp-made">Hecho en General Pico por RivaTech</p>
        </section>

        <main className="lp-right">
          <div className="lp-card">
            <h2 id="login-heading">Ingresá a tu cuenta</h2>
            <p className="lp-subtitle">Con el email que te dimos de alta.</p>

            <form onSubmit={handleSubmit} aria-labelledby="login-heading">
              <div className="lp-field">
                <div className="lp-row"><label htmlFor="login-email">Email</label></div>
                <div className="lp-input-box">
                  <span className="lp-input-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m3 6 7 5 7-5"/></svg></span>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="tu@email.com"
                    required
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                  />
                </div>
              </div>

              <div className="lp-field">
                <div className="lp-row">
                  <label htmlFor="login-password">Contraseña</label>
                  <Link className="lp-link" to="/forgot-password">¿Te olvidaste?</Link>
                </div>
                <div className="lp-input-box">
                  <span className="lp-input-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg></span>
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Tu contraseña"
                    required
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                  />
                  <button
                    className="lp-eye"
                    type="button"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(value => !value)}
                  >
                    <svg className="lp-eye-open" viewBox="0 0 20 20" aria-hidden="true"><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.4"/></svg>
                    <svg className="lp-eye-closed" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3l14 14M8.2 5a8 8 0 0 1 1.8-.5c5 0 8.2 5.5 8.2 5.5a14 14 0 0 1-2.4 3M5.6 6.6A14 14 0 0 0 1.8 10S5 15.5 10 15.5c1.2 0 2.3-.3 3.3-.8"/><path d="M8.3 8.4a2.4 2.4 0 0 0 3.3 3.3"/></svg>
                  </button>
                </div>
              </div>

              <button className={`lp-submit${loading ? ' is-loading' : ''}`} type="submit" disabled={loading || isCoolingDown}>
                <span className="lp-submit-label">Ingresar</span>
                <span className="lp-arrow" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 10h11M10 5l5 5-5 5"/></svg></span>
                <span className="lp-spinner" aria-hidden="true" />
              </button>
              <p className="lp-error" role="alert" aria-live="polite">{error}</p>
            </form>

            <p className="lp-alternative">
              ¿No tenés cuenta?<br />
              <a href={whatsappUrl}>Pedila por WhatsApp <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5"/></svg></a>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
