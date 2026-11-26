// Importação de build do Path of Building 2 (código de export ou link pobb.in)
(() => {
  const BUILD_KEY = 'poe2-build-v1';
  const OWNED_KEY = 'poe2-build-owned-v1';
  const panel = document.getElementById('buildPanel');

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // ---------- Decodificação ----------
  async function decodePobCode(code) {
    const b64 = code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).text();
  }

  async function resolveInput(input) {
    input = input.trim();
    const m = input.match(/pobb\.in\/(?:pob\/)?([\w-]+)/i);
    if (m) {
      let res;
      try {
        res = await fetch(`https://pobb.in/${m[1]}/raw`);
      } catch {
        throw new Error('Não consegui baixar do pobb.in (bloqueio do navegador). Abra o link, clique em "Copy" e cole o código aqui.');
      }
      if (!res.ok) throw new Error(`pobb.in respondeu ${res.status}.`);
      input = await res.text();
    }
    if (input.startsWith('<')) return input;
    return decodePobCode(input);
  }

  function parseBuild(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML da build inválido.');
    const b = doc.querySelector('Build');
    if (!b) throw new Error('Isso não parece um código do Path of Building.');

    const skillSets = [];
    const setNodes = doc.querySelectorAll('Skills > SkillSet');
    const groups = setNodes.length
      ? [...setNodes].map(s => ({ title: s.getAttribute('title'), skills: s.querySelectorAll(':scope > Skill') }))
      : [{ title: null, skills: doc.querySelectorAll('Skills > Skill') }];
    groups.forEach((g, i) => {
      const links = [];
      g.skills.forEach(sk => {
        if (sk.getAttribute('enabled') === 'false') return;
        const gems = [...sk.querySelectorAll('Gem')]
          .filter(gm => gm.getAttribute('enabled') !== 'false')
          .map(gm => {
            const name = gm.getAttribute('nameSpec') || gm.getAttribute('skillId') || '?';
            const id = (gm.getAttribute('gemId') || '') + (gm.getAttribute('skillId') || '');
            return { name, support: /support/i.test(id) };
          })
          .filter(gm => gm.name !== '?');
        if (gems.length) links.push(gems);
      });
      if (links.length) skillSets.push({ title: g.title || `Set ${i + 1}`, links });
    });

    // Armas equipadas
    const weapons = [];
    const items = {};
    doc.querySelectorAll('Items > Item').forEach(it => (items[it.getAttribute('id')] = it.textContent));
    doc.querySelectorAll('Slot').forEach(sl => {
      const name = sl.getAttribute('name') || '';
      if (!/^Weapon [12]$/.test(name)) return;
      const raw = items[sl.getAttribute('itemId')];
      if (!raw) return;
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !/^(Rarity|Item Class|Unique ID|Item Level|Quality|Sockets|LevelReq|Implicits):?/i.test(l));
      const rarity = (raw.match(/Rarity:\s*(\w+)/i) || [])[1] || '';
      const base = /normal|magic/i.test(rarity) ? lines[0] : lines[1] || lines[0];
      if (base && !weapons.includes(base)) weapons.push(base);
    });

    return {
      className: b.getAttribute('className') || '?',
      ascendancy: b.getAttribute('ascendClassName') || '',
      level: b.getAttribute('level') || '',
      bandit: b.getAttribute('bandit') || '',
      skillSets,
      weapons,
      notes: (doc.querySelector('Notes')?.textContent || '').replace(/\^x?[0-9A-Fa-f]{1,6}/g, '').trim(),
    };
  }

  // ---------- Estado ----------
  let build = store.get(BUILD_KEY, null);
  let owned = store.get(OWNED_KEY, {});
  let setIdx = store.get(BUILD_KEY + '-set', 0);

  function currentGems() {
    const set = build?.skillSets[setIdx] || build?.skillSets[0];
    if (!set) return { skills: [], supports: [] };
    const skills = [], supports = [];
    set.links.forEach(link => link.forEach(g => {
      const list = g.support ? supports : skills;
      if (!list.includes(g.name)) list.push(g.name);
    }));
    return { skills, supports };
  }

  // ---------- Dicas nos passos ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SPIRIT_RE = /^(Herald|Tame Beast|Wind Dancer|Archmage|Grace|Purity|Determination|Discipline|Raging Spirits|Trinity|Blasphemy|Berserk|Combat Frenzy|Ghost Dance|Charge Infusion|Cast on)/i;
  const ACT_START = { 1: 'a1-riverbank', 2: 'a2-vastiri', 3: 'a3-marsh', 4: 'a4-kingsmarch' };

  // Conjunto de skills para cada ato: usa títulos tipo "Ato 2" / "Act 3" / "Ato 4+"; senão, o conjunto escolhido no painel.
  function setForAct(act) {
    let best = null, bestN = -1;
    build.skillSets.forEach(s => {
      const n = +((s.title || '').match(/(\d+)/) || [])[1];
      if (n && n <= act && n > bestN) { best = s; bestN = n; }
    });
    return best || build.skillSets[setIdx] || build.skillSets[0];
  }

  function gemsOf(set) {
    const skills = [], supports = [], spirit = [];
    set.links.forEach(link => link.forEach(g => {
      const list = g.support ? supports : SPIRIT_RE.test(g.name) ? spirit : skills;
      if (!list.includes(g.name)) list.push(g.name);
    }));
    return { skills, supports, spirit };
  }

  function renderHints() {
    document.querySelectorAll('.build-hint, .build-setup').forEach(e => e.remove());
    document.body.classList.toggle('no-build', !build);
    if (!build) return;

    const seen = new Set();
    const queue = { skill: [], support: [], spirit: [] };
    for (let act = 1; act <= 4; act++) {
      const set = setForAct(act);
      const g = gemsOf(set);
      // gemas novas deste ato entram no fim da fila (sobras do ato anterior vêm antes)
      [['skill', g.skills], ['support', g.supports], ['spirit', g.spirit]].forEach(([k, list]) =>
        list.forEach(n => { if (!seen.has(n) && !owned[n]) queue[k].push(n); }));
      const isNew = n => !seen.has(n);

      // Quadro de setup no início do ato
      const header = document.getElementById(ACT_START[act]);
      if (header) {
        const box = document.createElement('details');
        box.className = 'build-setup info-box';
        box.innerHTML = `<summary>⚔ Setup da build — ${esc(set.title)}</summary>` +
          set.links.map(link => {
            const [main, ...sup] = link;
            const tag = n => `<span class="${isNew(n) ? 'bs-new' : ''}">${esc(n)}</span>`;
            return `<div class="bs-link"><b>${tag(main.name)}</b>${sup.length ? ' + ' + sup.map(x => tag(x.name)).join(', ') : ''}</div>`;
          }).join('') + '<div class="bs-legend"><span class="bs-new">destacado</span> = novo neste ato</div>';
        header.before(box);
      }
      [...g.skills, ...g.supports, ...g.spirit].forEach(n => seen.add(n));

      document.querySelectorAll(`.step[data-step^="a${act}-"]`).forEach(step => {
        step.querySelectorAll('.reward, .gem').forEach(chip => {
          const r = chip.textContent;
          let name = null, label = '';
          if (/Spirit Gem/i.test(r)) { name = queue.spirit.shift(); label = 'spirit'; }
          else if (/Support/i.test(r)) {
            label = 'support';
            let i = -1;
            if (/Tier\s*[3-9]/i.test(r)) {
              const tier = n => ({ I: 1, II: 2, III: 3, IV: 4, V: 5 }[(n.match(/\s(I{1,3}|IV|V)$/) || [])[1]] || 0);
              i = queue.support.reduce((b, n, j) => (tier(n) > (b < 0 ? 0 : tier(queue.support[b])) ? j : b), -1);
            }
            name = i >= 0 ? queue.support.splice(i, 1)[0] : queue.support.shift();
          }
          else if (/Skill Gem/i.test(r)) { name = queue.skill.shift(); label = 'skill'; }
          else if (/Ascend/i.test(r) && build.ascendancy) name = build.ascendancy;
          if (!name) return;
          const tag = document.createElement('span');
          tag.className = 'build-hint ' + label;
          tag.title = 'Sugestão baseada na sua build importada';
          tag.textContent = '→ ' + name;
          chip.after(tag);
        });
      });
    }
  }

  // ---------- Painel lateral ----------
  function renderPanel() {
    if (!build) { panel.innerHTML = ''; return; }
    const { skills, supports } = currentGems();
    const gemRow = (n, sup) =>
      `<label class="bp-gem${owned[n] ? ' owned' : ''}"><input type="checkbox" data-gem="${esc(n)}"${owned[n] ? ' checked' : ''}><span class="${sup ? 'sup' : ''}">${esc(n)}</span></label>`;
    panel.innerHTML = `
      <div class="bp-card">
        <div class="bp-title">${esc(build.ascendancy || build.className)}</div>
        <div class="bp-sub">${esc(build.className)}${build.level ? ' · Lvl ' + esc(build.level) : ''}</div>
        ${build.skillSets.length > 1 ? `<select id="bpSet">${build.skillSets.map((s, i) => `<option value="${i}"${i == setIdx ? ' selected' : ''}>${esc(s.title)}</option>`).join('')}</select>` : ''}
        ${build.weapons.length ? `<div class="bp-sec">Armas</div>${build.weapons.map(esc).join('<br>')}` : ''}
        <div class="bp-sec">Skills (marque as que já tem)</div>
        ${skills.map(n => gemRow(n, false)).join('') || '—'}
        ${supports.length ? `<div class="bp-sec">Supports</div>${supports.map(n => gemRow(n, true)).join('')}` : ''}
        ${build.notes ? `<details><summary>Notas da build</summary><pre>${esc(build.notes)}</pre></details>` : ''}
        <div class="bp-actions"><button type="button" id="bpChange">Trocar</button><button type="button" id="bpRemove">Remover</button></div>
      </div>`;
    panel.querySelectorAll('input[data-gem]').forEach(cb => cb.addEventListener('change', () => {
      owned[cb.dataset.gem] = cb.checked;
      store.set(OWNED_KEY, owned);
      refresh();
    }));
    panel.querySelector('#bpSet')?.addEventListener('change', e => {
      setIdx = +e.target.value;
      store.set(BUILD_KEY + '-set', setIdx);
      refresh();
    });
    panel.querySelector('#bpChange').addEventListener('click', openDialog);
    panel.querySelector('#bpRemove').addEventListener('click', () => {
      build = null; owned = {}; setIdx = 0;
      store.del(BUILD_KEY); store.del(OWNED_KEY); store.del(BUILD_KEY + '-set');
      refresh();
    });
  }

  function refresh() { renderPanel(); renderHints(); }

  // ---------- Diálogo de importação ----------
  const dlg = document.createElement('dialog');
  dlg.id = 'buildDialog';
  dlg.innerHTML = `
    <h3 style="margin-top:0">Importar build</h3>
    <p>Cole o código de export do <b>Path of Building 2</b> (Import/Export Build → Generate/Copy) ou um link do <b>pobb.in</b>.
    A build fica salva só no seu navegador.</p>
    <textarea id="bdInput" placeholder="eNrtfWt34ziS6Gf..."></textarea>
    <div class="err" id="bdErr"></div>
    <div class="row"><button type="button" id="bdCancel">Cancelar</button><button type="button" id="bdOk" class="active">Importar</button></div>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector('#bdInput');
  const err = dlg.querySelector('#bdErr');

  function openDialog() { err.textContent = ''; input.value = ''; dlg.showModal(); input.focus(); }
  dlg.querySelector('#bdCancel').addEventListener('click', () => dlg.close());
  dlg.querySelector('#bdOk').addEventListener('click', async () => {
    err.textContent = 'Lendo…';
    try {
      const parsed = parseBuild(await resolveInput(input.value));
      if (!parsed.skillSets.length) throw new Error('Build importada, mas sem nenhuma gem habilitada.');
      build = parsed; setIdx = 0; owned = {};
      store.set(BUILD_KEY, build); store.set(OWNED_KEY, owned); store.set(BUILD_KEY + '-set', 0);
      dlg.close();
      refresh();
    } catch (e) {
      err.textContent = e.message && !/atob|decod|invalid/i.test(e.message) ? e.message : 'Código inválido. Confira se copiou o código inteiro.';
    }
  });

  document.getElementById('btnBuild').addEventListener('click', openDialog);
  refresh();
})();
