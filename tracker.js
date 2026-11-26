// Acompanha o jogo lendo o Client.txt do PoE2 (área atual e nível) — Chrome/Edge
(() => {
  const controls = document.querySelector('.controls');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btnLog';
  btn.textContent = 'Conectar ao jogo';
  btn.title = 'Lê o Client.txt do Path of Exile 2 para seguir sua posição no guia';
  controls.insertBefore(btn, document.getElementById('btnReset'));
  const status = document.createElement('span');
  status.className = 'progress-wrap';
  status.id = 'logStatus';
  controls.appendChild(status);

  if (!window.showOpenFilePicker) {
    btn.disabled = true;
    btn.title = 'Seu navegador não suporta leitura contínua de arquivos. Use Chrome ou Edge.';
    return;
  }

  const norm = s => s.toLowerCase().replace(/[’']/g, "'").replace(/^the\s+/, '').replace(/[^a-z0-9' ]/g, '').trim();
  const steps = [...document.querySelectorAll('main .step')];
  const stepZones = steps.map(st => [...st.querySelectorAll('.loc')].map(l => norm(l.textContent)));
  const matches = (zone, loc) => loc === zone || (loc.length >= 4 && (zone.startsWith(loc) || loc.startsWith(zone)));

  let cursor = -1;
  let level = null;
  let zone = null;

  function setStatus() {
    status.textContent = [level ? `Lvl ${level}` : '', zone ? `📍 ${zone}` : ''].filter(Boolean).join(' · ');
  }

  function goTo(idx, markPrevious) {
    if (idx < 0) return;
    if (markPrevious && typeof state !== 'undefined') {
      for (let i = 0; i < idx; i++) state[steps[i].dataset.step] = true;
      saveState(state);
      render();
    }
    steps.forEach(s => s.classList.remove('current-step'));
    steps[idx].classList.add('current-step');
    steps[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    cursor = idx;
  }

  // Só avança: entrar na cidade ou voltar a uma área antiga não puxa o guia para trás
  function onZone(name, live) {
    zone = name;
    setStatus();
    const z = norm(name);
    for (let i = Math.max(cursor, 0); i < steps.length; i++) {
      if (stepZones[i].some(loc => matches(z, loc))) {
        if (i !== cursor) goTo(i, live);
        return;
      }
    }
  }

  function onLevel(lv) {
    level = lv;
    setStatus();
    document.dispatchEvent(new CustomEvent('poe-level', { detail: lv }));
  }

  const RE_ZONE = /(?:You have entered (.+?)\.\s*$|\[SCENE\] Set Source \[(.+?)\])/;
  const RE_LEVEL = /\) is now level (\d+)/;

  function parse(text, live) {
    let lastZone = null;
    for (const line of text.split(/\r?\n/)) {
      const z = line.match(RE_ZONE);
      if (z) {
        const name = z[1] || z[2];
        if (name && name !== '(null)' && !/hideout/i.test(name)) {
          if (live) onZone(name, true); else lastZone = name;
        }
        continue;
      }
      const l = line.match(RE_LEVEL);
      if (l) onLevel(+l[1]);
    }
    if (!live && lastZone) onZone(lastZone, false);
  }

  // ---------- Leitura do arquivo ----------
  let handle = null, offset = 0, timer = null;

  async function poll() {
    try {
      const file = await handle.getFile();
      if (file.size < offset) offset = 0; // log recriado
      if (file.size > offset) {
        const text = await file.slice(offset).text();
        offset = file.size;
        parse(text, true);
      }
    } catch (e) {
      stop('Conexão com o log perdida');
    }
  }

  function stop(msg) {
    clearInterval(timer);
    timer = null;
    btn.classList.remove('active');
    btn.textContent = 'Conectar ao jogo';
    if (msg) status.textContent = msg;
  }

  async function start(h) {
    handle = h;
    const file = await handle.getFile();
    // lê o fim do log para descobrir onde você está agora
    const tail = Math.max(0, file.size - 2_000_000);
    cursor = -1;
    parse(await file.slice(tail).text(), false);
    offset = file.size;
    timer = setInterval(poll, 1000);
    btn.classList.add('active');
    btn.textContent = 'Conectado ✓';
    setStatus();
    saveHandle(h);
  }

  // Guarda o arquivo escolhido para não precisar procurar de novo
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('poe2-guide', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        const tx = r.result.transaction('kv', mode);
        const q = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(q?.result);
        tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    });
  }
  const saveHandle = h => idb('readwrite', s => s.put(h, 'clientLog')).catch(() => {});
  const loadHandle = () => idb('readonly', s => s.get('clientLog')).catch(() => null);

  btn.addEventListener('click', async () => {
    if (timer) { stop(''); return; }
    try {
      let h = await loadHandle();
      if (h && (await h.requestPermission({ mode: 'read' })) !== 'granted') h = null;
      if (!h) {
        [h] = await window.showOpenFilePicker({
          id: 'poe2-log',
          types: [{ description: 'Client.txt do PoE2', accept: { 'text/plain': ['.txt'] } }],
        });
      }
      await start(h);
    } catch (e) {
      if (e.name !== 'AbortError') status.textContent = 'Erro ao abrir o log: ' + e.message;
    }
  });

  loadHandle().then(h => { if (h) btn.textContent = 'Reconectar ao jogo'; });
})();
