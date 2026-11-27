
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* barra, progreso */
const topbar = document.getElementById('topbar'), prog = document.getElementById('progress');
addEventListener('scroll', () => {
  topbar.classList.toggle('scrolled', scrollY > 10);
  prog.style.transform = `scaleX(${scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)})`;
}, { passive: true });

/* revelado al scroll */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
document.querySelectorAll('.rv').forEach(el => io.observe(el));

/* cinta infinita */
const track = document.getElementById('track');
const base = [...track.children];
for (let k = 0; k < 3; k++) base.forEach(c => { const d = c.cloneNode(true); d.setAttribute('aria-hidden', 'true'); track.appendChild(d); });

/* luz del cursor, tilt y spotlight */
if (fine && !reduce) {
  const cur = document.getElementById('cursor');
  addEventListener('mousemove', e => { cur.style.opacity = 1; cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
  const tilt = document.getElementById('tilt'), st = tilt.querySelector('.stage');
  tilt.addEventListener('mousemove', e => {
    const r = tilt.getBoundingClientRect();
    st.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 12 + 'deg');
    st.style.setProperty('--rx', (.5 - (e.clientY - r.top) / r.height) * 10 + 'deg');
  });
  tilt.addEventListener('mouseleave', () => { st.style.removeProperty('--ry'); st.style.removeProperty('--rx'); });
}
document.querySelectorAll('.mc').forEach(c => c.addEventListener('pointermove', e => {
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px');
}));

/* panel vivo: stock y actividad */
if (!reduce) {
  const rows = [...document.querySelectorAll('.sr')], feed = document.getElementById('feed');
  const init = rows.map(r => r.querySelector('.ss').textContent);
  const ico = {
    v: '<path d="m3 14 5-5 3 3 6-7M12 5h5v5"/>',
    s: '<path d="M4 7.5 10 4l6 3.5v7L10 18l-6-3.5v-7Z"/><path d="M10 11v7M4.5 7.8 10 11l5.5-3.2"/>',
    a: '<path d="M10 3 2.5 16h15L10 3ZM10 8v4M10 14h.01"/>'
  };
  const ev = [
    { r: 0, v: 11, t: 'Venta registrada', s: 'Yerba 1 kg · 1 unidad', i: 'v' },
    { r: 2, v: 28, t: 'Venta registrada', s: 'Fideos 500 g · 2 unidades', i: 'v' },
    { r: 3, v: 16, t: 'Stock actualizado', s: 'Cargador USB-C · +10', i: 's' },
    { r: 1, v: 1, t: 'Stock bajo', s: 'Aceite 900 ml · 1 unidad', i: 'a', w: 1 }
  ];
  let n = 0;
  setInterval(() => {
    if (document.hidden) return;
    const k = n % ev.length, e = ev[k];
    if (k === 0) rows.forEach((r, i) => { const s = r.querySelector('.ss'); s.textContent = init[i]; s.classList.toggle('low', i === 1); });
    const row = rows[e.r], s = row.querySelector('.ss');
    s.textContent = e.v + ' un.'; s.classList.toggle('low', e.v <= 2);
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    const a = document.createElement('div'); a.className = 'act new';
    a.innerHTML = `<em class="${e.w ? 'w' : ''}"><svg viewBox="0 0 20 20">${ico[e.i]}</svg></em><span><strong>${e.t}</strong>${e.s}</span>`;
    feed.prepend(a); if (feed.children.length > 3) feed.lastElementChild.remove();
    n++;
  }, 3200);
}

/* pestañas (avanzan solas hasta que la persona interactúa) */
const tabsEl = document.getElementById('tabs'), tabs = [...tabsEl.querySelectorAll('[role="tab"]')], status = document.getElementById('tab-status');
const msgs = ['Mostrando un ejemplo de stock.', 'Mostrando un ejemplo de registro de venta.', 'Mostrando un ejemplo de cuentas de clientes.', 'Mostrando un ejemplo de catálogo online.'];
let cur = 0;
function pick(i, focus = true) {
  cur = i;
  tabs.forEach((t, j) => {
    const on = j === i; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
    const p = document.getElementById(t.getAttribute('aria-controls')); p.hidden = !on; p.classList.toggle('is-active', on);
  });
  status.textContent = msgs[i];
  if (focus) tabs[i].focus({ preventScroll: true });
}
function stopAuto() { tabsEl.classList.remove('auto'); }
if (reduce) stopAuto();
tabs.forEach((t, i) => {
  t.addEventListener('click', () => { stopAuto(); pick(i, false); });
  t.addEventListener('keydown', e => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = tabs.length - 1; else return;
    e.preventDefault(); stopAuto(); pick(n);
  });
  t.addEventListener('animationend', () => { if (tabsEl.classList.contains('auto') && i === cur) pick((i + 1) % tabs.length, false); });
});
