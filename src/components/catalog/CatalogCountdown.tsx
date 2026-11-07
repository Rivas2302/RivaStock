import { useEffect, useState } from 'react';

interface CatalogCountdownProps {
  target: Date;
  label: string;
}

function remainingTime(target: Date, now: number) {
  const minutes = Math.max(0, Math.ceil((target.getTime() - now) / 60_000));
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

export default function CatalogCountdown({ target, label }: CatalogCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = remainingTime(target, now);
  return <p className="catalog-countdown" aria-label={`Faltan ${remaining.days} días, ${remaining.hours} horas y ${remaining.minutes} minutos ${label}`}>
    <span className="catalog-countdown__eyebrow">Cuenta regresiva {label}</span>
    <span className="catalog-countdown__time"><b>{remaining.days}</b>d <b>{remaining.hours}</b>h <b>{remaining.minutes}</b>m</span>
  </p>;
}
