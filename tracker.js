// Acompanha o jogo lendo o Client.txt do PoE2 (área atual e nível) — Chrome/Edge
(() => {
  const btn = document.getElementById('gamePill');
  const label = btn.querySelector('.pill-label');
  const setLabel = t => { label.textContent = t; };

  const LIVE = typeof window.showOpenFilePicker === 'function';

  // Nomes das áreas no cliente em português → nome em inglês usado no guia
  const PT = {
    'Acampamento de Clearfell': 'Clearfell Encampment', 'Acampamento Zigurate': 'Ziggurat Encampment',
    'Ruínas da Selva': 'Jungle Ruins', 'Terras Infestadas': 'Infested Barrens', 'Pantanal Quimérico': 'Chimeral Wetlands',
    'Maquinário de Jiquani': "Jiquani's Machinarium", 'Santuário de Jiquani': "Jiquani's Sanctum",
    'As Hidrovias de Matlan': 'The Matlan Waterways', 'A Cidade Submersa': 'The Drowned City', 'O Cofre Derretido': 'The Molten Vault',
    'Ápice da Imundície': 'Apex of Filth', 'Templo de Kopec': 'Temple of Kopec', 'As Câmaras Sombrias': 'The Black Chambers',
    'O Charco Azak': 'Azak Bog', 'Baía Ancoreta': 'Kedge Bay', 'Fim da Jornada': "Journey's End", 'Prisão Abandonada': 'Abandoned Prison',
    'Confinamento Solitário': 'Solitary Confinement', 'Ilha Whakapanu': 'Whakapanu Island', 'Cavernas Cantoras': 'Singing Caverns',
    'Olho de Hinekora': 'Eye of Hinekora', 'Salão dos Mortos': 'Halls of the Dead', 'Provação dos Ancestrais': 'Trial of Ancestors',
    'Ilha da Família': 'Isle of Kin', 'Galerias Vulcânicas': 'Volcanic Warrens', 'A Excavação': 'The Excavation',
    'Coração da Tribo': 'Heart of the Tribe', 'A Provação do Caos': 'Trial of Chaos', 'Provação das Sekhemas': 'Trial of the Sekhemas',
  };
  const IGNORE = /^\(|^(act|ato) \d|^interl[uú]d|^atlas$|hideout|^refúgio/i;
  const MAX_JUMP = 15; // não pula mais que isso de uma vez (ex.: Trial feito fora de ordem)
  const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'").replace(/^the\s+/, '').replace(/[^a-z0-9' ]/g, '').trim();
  const steps = [...document.querySelectorAll('main .step')];
  const stepZones = steps.map(st => [...st.querySelectorAll('.loc')].map(l => norm(l.textContent)));
  const matches = (zone, loc) => loc === zone || (loc.length >= 4 && (` ${zone} `.includes(` ${loc} `) || ` ${loc} `.includes(` ${zone} `)));

  let cursor = -1;
  let level = null;
  let zone = null;

  function setStatus() {
    const parts = [level ? `Lvl ${level}` : '', zone || ''].filter(Boolean);
    if (parts.length) setLabel(parts.join(' · '));
    btn.title = [charName, level && `Lvl ${level}`, zone].filter(Boolean).join(' · ') + (timer ? ' — clique para desconectar' : '');
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
    markZoneOfStep(steps[idx]);
    steps[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    cursor = idx;
  }

  // Só avança: entrar na cidade ou voltar a uma área antiga não puxa o guia para trás
  function onZone(name, live) {
    zone = name;
    setStatus();
    const z = norm(PT[name.trim()] || name);
    const end = cursor < 0 ? steps.length : Math.min(steps.length, cursor + MAX_JUMP);
    for (let i = Math.max(cursor, 0); i < end; i++) {
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
  const RE_LEVEL = /: (\S+) \([^)]*\) (?:is now level|chegou ao n[ií]vel) (\d+)/;
  let charName = null;

  function parse(text, live, markOnFinal = false) {
    let lastZone = null;
    for (const line of text.split(/\r?\n/)) {
      const z = line.match(RE_ZONE);
      if (z) {
        const name = z[1] || z[2];
        if (name && !IGNORE.test(name.trim())) {
          if (live) onZone(name, true); else lastZone = name;
        }
        continue;
      }
      const l = line.match(RE_LEVEL);
      if (l) { charName = l[1]; onLevel(+l[2]); }
    }
    if (!live && lastZone) onZone(lastZone, markOnFinal);
  }

  // ---------- Leitura do arquivo ----------
  let handle = null, offset = 0, timer = null, partial = '', failures = 0;

  async function poll() {
    try {
      const file = await handle.getFile();
      if (file.size < offset) { offset = 0; partial = ''; } // log recriado
      if (file.size > offset) {
        const text = partial + (await file.slice(offset).text());
        offset = file.size;
        // a última linha pode estar pela metade (o jogo ainda está escrevendo): guarda para a próxima leitura
        const cut = text.lastIndexOf('\n') + 1;
        partial = text.slice(cut);
        parse(text.slice(0, cut), true);
      }
      failures = 0;
    } catch (e) {
      // o jogo pode estar escrevendo no arquivo bem na hora da leitura: tenta de novo no próximo segundo
      console.warn('Leitura do log falhou', e);
      if (++failures >= 30) stop('Conexão com o log perdida — clique em "Conectar ao jogo" de novo.');
    }
  }

  function stop(msg) {
    clearInterval(timer);
    timer = null;
    btn.classList.remove('on');
    setLabel('Conectar ao jogo');
    if (msg) toast(msg);
  }

  async function start(h) {
    handle = h;
    const file = await handle.getFile();
    // lê o fim do log para descobrir onde você está agora
    const tail = Math.max(0, file.size - 2_000_000);
    cursor = -1;
    parse(await file.slice(tail).text(), false);
    offset = file.size;
    partial = '';
    failures = 0;
    timer = setInterval(poll, 1000);
    btn.classList.add('on');
    setLabel('Conectado');
    setStatus();
    saved = h;
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

  // Sem File System Access (Brave, Firefox, Opera…): lê o arquivo uma vez; clique de novo para atualizar
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const reread = zone !== null;
      parse(await f.slice(Math.max(0, f.size - 2_000_000)).text(), false, reread);
      setStatus();
      setLabel(`${label.textContent} · ↻`);
      btn.title = 'Modo manual: clique e escolha o Client.txt de novo para atualizar';
      if (!zone) toast('Nenhuma área encontrada nesse arquivo — é o Client.txt do PoE2?');
    } catch (e) {
      toast('Erro ao ler: ' + e.message);
    }
  });

  let saved = null;
  btn.addEventListener('click', async () => {
    if (timer) { stop(''); return; }
    if (!LIVE) {
      toast(navigator.brave
        ? 'O Brave não acompanha o arquivo ao vivo. Para atualizar sozinho: abra brave://flags/#file-system-access-api, ative e reinicie o Brave. Por enquanto, escolha o Client.txt (clique de novo para atualizar).'
        : 'Seu navegador não acompanha o arquivo ao vivo: escolha o Client.txt (clique de novo para atualizar). Chrome e Edge atualizam sozinhos.', 10000);
      fileInput.click();
      return;
    }
    try {
      let h = saved;
      if (h) {
        if ((await h.requestPermission({ mode: 'read' })) !== 'granted') h = null;
      }
      if (!h) {
        toast('Escolha o Client.txt (pasta do jogo → logs)');
        [h] = await window.showOpenFilePicker({
          id: 'poe2-log',
          types: [{ description: 'Client.txt do PoE2', accept: { 'text/plain': ['.txt'] } }],
        });
      }
      await start(h);
      toast(zone ? `Conectado ao jogo — você está em ${zone}` : 'Conectado, mas nenhuma área encontrada ainda — é o Client.txt do PoE2?');
    } catch (e) {
      console.error(e);
      if (e.name !== 'AbortError') toast('Erro ao abrir o log: ' + e.message);
    }
  });

  if (LIVE) loadHandle().then(h => { if (h) { saved = h; setLabel('Reconectar ao jogo'); } });
})();
