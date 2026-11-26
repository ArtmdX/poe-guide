// Checklist, filtros, navegação e utilidades compartilhadas (build.js e tracker.js usam state/saveState/render/toast/showSideTab)
const STORAGE_KEY = document.body.dataset.progressKey;
const UI_KEY = 'poe2-ui-v1';
const steps = [...document.querySelectorAll('main .step')];

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const loadState = () => loadJSON(STORAGE_KEY, {});
const saveState = s => saveJSON(STORAGE_KEY, s);
let state = loadState();

// ---------- Áreas: passos de cada cabeçalho + link da navegação ----------
const zones = [];
for (const el of document.querySelectorAll('main .zone-header, main .step')) {
  if (el.classList.contains('zone-header')) {
    const link = document.querySelector(`.nav a[href="#${el.id}"]`);
    const count = document.createElement('span');
    count.className = 'zone-count';
    el.querySelector('.badge')?.after(count);
    const linkCount = document.createElement('span');
    linkCount.className = 'count';
    link?.appendChild(linkCount);
    zones.push({ header: el, link, count, linkCount, steps: [] });
  } else {
    zones.at(-1)?.steps.push(el);
  }
}

// ---------- Render ----------
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');

function render() {
  let doneCount = 0;
  for (const el of steps) {
    const isDone = Boolean(state[el.dataset.step]);
    el.classList.toggle('done', isDone);
    el.querySelector('.checkbox').textContent = isDone ? '✓' : '';
    if (isDone) doneCount++;
  }
  progressText.textContent = `${doneCount} / ${steps.length}`;
  progressFill.style.width = `${(100 * doneCount) / steps.length}%`;

  for (const z of zones) {
    const d = z.steps.filter(s => state[s.dataset.step]).length;
    const complete = z.steps.length > 0 && d === z.steps.length;
    z.count.textContent = `${d}/${z.steps.length}`;
    z.linkCount.textContent = complete ? '✓' : `${d}/${z.steps.length}`;
    z.header.classList.toggle('complete', complete);
    z.link?.classList.toggle('complete', complete);
  }
}

for (const el of steps) {
  el.setAttribute('role', 'checkbox');
  el.tabIndex = 0;
  const toggle = () => {
    const id = el.dataset.step;
    state[id] = !state[id];
    saveState(state);
    render();
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
}

// ---------- Filtros (lembrados entre visitas) ----------
const ui = loadJSON(UI_KEY, {});
for (const btn of document.querySelectorAll('.toggle[data-toggle]')) {
  const cls = btn.dataset.toggle;
  const invert = btn.hasAttribute('data-invert'); // botão "ligado" = classe ausente
  const apply = on => {
    document.body.classList.toggle(cls, on);
    btn.setAttribute('aria-pressed', String(invert ? !on : on));
  };
  apply(Boolean(ui[cls]));
  btn.addEventListener('click', () => {
    ui[cls] = !document.body.classList.contains(cls);
    saveJSON(UI_KEY, ui);
    apply(ui[cls]);
  });
}

document.getElementById('btnReset').addEventListener('click', () => {
  if (!confirm('Desmarcar todos os passos do guia?')) return;
  state = {};
  saveState(state);
  render();
});

// Próximo passo: o destacado pelo jogo ou o primeiro não feito que esteja visível
document.getElementById('btnNext').addEventListener('click', () => {
  const visible = s => s.offsetParent !== null;
  const target =
    steps.find(s => s.classList.contains('current-step') && !state[s.dataset.step]) ||
    steps.find(s => !state[s.dataset.step] && visible(s));
  if (!target) { toast('Tudo concluído! 🎉'); return; }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
});

// ---------- Barra lateral: abas, área ativa, menu no celular ----------
function showSideTab(name) {
  document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.sidebar [data-pane]').forEach(p => (p.hidden = p.dataset.pane !== name));
  if (matchMedia('(max-width: 900px)').matches) document.body.classList.add('nav-open');
}
document.querySelectorAll('.side-tab').forEach(t => t.addEventListener('click', () => showSideTab(t.dataset.tab)));

const closeNav = () => document.body.classList.remove('nav-open');
document.getElementById('btnMenu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.getElementById('scrim').addEventListener('click', closeNav);
document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', closeNav));
addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });

let spyQueued = false;
function updateActiveZone() {
  spyQueued = false;
  const top = document.querySelector('.toolbar').getBoundingClientRect().bottom + 24;
  let active = zones[0];
  for (const z of zones) if (z.header.getBoundingClientRect().top <= top) active = z;
  for (const z of zones) z.link?.classList.toggle('active', z === active);
}
addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(updateActiveZone); } }, { passive: true });

// Marca na navegação a área em que o personagem está (usado pelo tracker.js)
function markZoneOfStep(stepEl) {
  for (const z of zones) z.link?.classList.toggle('here', z.steps.includes(stepEl));
}

// ---------- Toast ----------
const toastEl = document.createElement('div');
toastEl.className = 'toast';
toastEl.setAttribute('role', 'status');
document.body.appendChild(toastEl);
let toastTimer;
function toast(msg, ms = 4000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

render();
updateActiveZone();
