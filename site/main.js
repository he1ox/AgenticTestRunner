// qa-runner landing: the two story animations, the install tabs and the copy button.
// No dependencies. Each animation is a list of scenes run by a player that starts when its
// figure scrolls into view, stops when it leaves, and restarts on Replay.
(() => {
  'use strict';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const STOP = Symbol('stop');

  const pointer = (fill, stroke) =>
    `<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M1 1L1 14L4.5 10.5L7 16.5L9.2 15.5L6.8 9.8L12 9.8Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
  const agentCursor = (n) => `<div class="cur agent" data-cur>${pointer('#C6FF00', '#0A0A0A')}<span class="who">agent-${n}</span></div>`;
  const humanCursor = () => `<div class="cur human" data-cur>${pointer('#0B0B0B', '#fff')}<span class="who">you</span></div>`;

  // Reading a layout property commits the element's start state, so the transition to .on runs
  // even when the tab is in the background and animation frames are paused.
  const show = (el) => {
    void el.getBoundingClientRect();
    el.classList.add('on');
  };

  function rel(el, box) {
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }

  async function moveTo(W, cur, el, box) {
    const p = rel(el, box);
    const x = p.x + p.w * 0.55;
    cur.style.left = `${x}px`;
    cur.style.top = `${p.y + p.h * 0.5}px`;
    cur.classList.toggle('flip', x > box.clientWidth - 80);
    await W(700);
  }

  async function press(W, el) {
    el.style.transform = 'scale(.92)';
    await W(150);
    el.style.transform = '';
  }

  async function flash(W, el) {
    el.style.opacity = '.95';
    await W(140);
    el.style.opacity = '0';
    await W(200);
  }

  function log(container, text, color) {
    const line = document.createElement('div');
    line.textContent = text;
    if (color) line.style.color = color;
    container.appendChild(line);
    show(line);
  }

  function svgEl(svg, tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute('class', 'mk');
    svg.appendChild(el);
    show(el);
    return el;
  }

  const markBox = (svg, p, color) =>
    svgEl(svg, 'rect', { x: p.x - 4, y: p.y - 4, width: p.w + 8, height: p.h + 8, fill: 'none', stroke: color, 'stroke-width': 2.5 });
  const markArrow = (svg, x1, y1, x2, y2) =>
    svgEl(svg, 'line', { x1, y1, x2, y2, stroke: '#C6FF00', 'stroke-width': 2.5, 'marker-end': 'url(#ah)' });

  function markStep(host, p, n) {
    const s = document.createElement('div');
    s.className = 'st';
    s.textContent = n;
    s.style.left = `${p.x - 9}px`;
    s.style.top = `${p.y - 9}px`;
    host.appendChild(s);
    show(s);
  }

  async function count(W, el, to, format, ms) {
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      el.textContent = format((to * i) / steps);
      await W(ms / steps);
    }
  }

  // Runs scenes in order, in a loop, while the figure is on screen. Every run holds a token;
  // leaving the screen or pressing Replay changes the token and the old run stops at its next
  // wait. With reduced motion every wait is instant and the scenes run once, so the figure shows
  // the final state of the last scene.
  function player(figure, scenes) {
    let token = 0;
    let visible = false;
    const wait = (t, ms) =>
      new Promise((resolve, reject) => setTimeout(() => (t === token ? resolve() : reject(STOP)), reduce ? 0 : ms));

    async function run() {
      const t = ++token;
      const W = (ms) => wait(t, ms);
      try {
        do {
          for (const scene of scenes) await scene(W);
        } while (!reduce);
      } catch (err) {
        if (err !== STOP) throw err;
      }
    }

    figure.querySelector('[data-replay]').addEventListener('click', run);
    if (!('IntersectionObserver' in window)) return run();
    new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !visible) {
          visible = true;
          run();
        } else if (!entry.isIntersecting && visible) {
          visible = false;
          token++;
        }
      },
      { threshold: 0.2 },
    ).observe(figure);
  }

  // § 01: one agent tests a flow and marks its evidence, then three agents test one system.
  function watchIt(figure) {
    const scene = figure.querySelector('[data-scene]');
    const label = figure.querySelector('[data-label]');
    const $ = (sel) => scene.querySelector(sel);

    async function act1(W) {
      label.textContent = 'act 1 · one agent, one flow';
      scene.innerHTML = `
        <div class="act1">
          <div class="win"><div class="ub mono">acme.shop/cart</div>
            <div class="cart" data-box>
              <h3>Your cart</h3>
              <div class="row"><span>Acid hoodie × 1</span><span>$46.00</span></div>
              <div class="coupon"><span class="field" data-field>Coupon code</span><span class="btn" data-apply>Apply</span></div>
              <div class="total"><span>Total</span><b data-total>$46.00</b></div>
              <svg class="ov" data-ov></svg>
              ${agentCursor(1)}
              <div class="fl" data-flash></div>
            </div>
          </div>
          <div class="thought log" data-log></div>
        </div>
        <div class="strip"><span class="dim">evidence/</span><div data-strip style="display:flex;gap:8px"></div></div>`;
      await W(60);
      const box = $('[data-box]'), cur = $('[data-cur]'), L = $('[data-log]');
      const field = $('[data-field]'), apply = $('[data-apply]'), total = $('[data-total]');

      log(L, 'agent-1 · haiku · TC-03', '#8A8A8A');
      log(L, '› coupon takes 10% off the total');
      await W(700);
      log(L, 'see: coupon field → type SAVE10');
      await moveTo(W, cur, field, box);
      field.textContent = '';
      field.style.color = '#0B0B0B';
      for (const ch of 'SAVE10') {
        field.textContent += ch;
        await W(90);
      }
      log(L, 'click Apply');
      await moveTo(W, cur, apply, box);
      await press(W, apply);
      await W(350);
      total.innerHTML = '<s>$46.00</s>$41.40';
      await W(500);
      log(L, 'expected result visible', '#C6FF00');
      log(L, 'decision: take a screenshot', '#C6FF00');
      await W(500);
      await flash(W, $('[data-flash]'));

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.textContent = 'TC-03_01.png';
      $('[data-strip]').appendChild(thumb);
      show(thumb);
      await W(400);
      log(L, 'mark: ① field ② button');
      markStep(box, rel(field, box), 1);
      await W(350);
      markStep(box, rel(apply, box), 2);
      await W(500);
      log(L, 'mark: □ total → expected');
      const p = rel(total, box);
      markBox($('[data-ov]'), p, '#C6FF00');
      await W(500);
      markArrow($('[data-ov]'), Math.max(4, p.x - 80), p.y - 26, p.x - 10, p.y + p.h / 2);
      await W(800);
      thumb.textContent = 'TC-03_01.png · 4 marks';
      log(L, 'verdict: PASS · 1 png · 4 marks', '#C6FF00');
      await W(2200);
    }

    const flows = [
      { path: '/login', tier: 'haiku', target: 'Sign in', lines: ['› TC-01 · valid login', 'click Sign in → capture'], verdict: 'PASS', color: '#C6FF00' },
      { path: '/cart', tier: 'haiku', target: 'Total $41.40', lines: ['› TC-03 · coupon 10%', 'total updated → capture'], verdict: 'PASS', color: '#C6FF00' },
      { path: '/checkout', tier: 'sonnet', target: 'Pay now', lines: ['› TC-07 · pay with card', 'error toast → capture'], verdict: 'FAIL · needs review', color: '#FF3EA5' },
    ];

    async function agent(W, f, i) {
      const el = scene.querySelectorAll('.mini')[i];
      const box = el.querySelector('.body'), L = el.querySelector('.log'), target = el.querySelector('.target');
      await W(i * 450);
      log(L, f.lines[0], '#8A8A8A');
      await W(400);
      await moveTo(W, el.querySelector('[data-cur]'), target, box);
      log(L, f.lines[1]);
      await flash(W, el.querySelector('.fl'));
      markBox(el.querySelector('.ov'), rel(target, box), f.color);
      markStep(box, rel(target, box), 1);
      await W(600);
      log(L, f.verdict, f.color);
    }

    async function act2(W) {
      label.textContent = 'act 2 · three agents, three flows, one system';
      scene.innerHTML = `
        <div class="act2">${flows
          .map(
            (f, i) => `
          <div class="mini">
            <div class="who-line">agent-${i + 1} · ${f.tier}</div>
            <div class="win"><div class="ub mono">acme.shop${f.path}</div>
              <div class="body">
                <div class="bar" style="width:62%"></div><div class="bar" style="width:84%"></div><div class="bar" style="width:40%"></div>
                <span class="target">${f.target}</span>
                <svg class="ov"></svg>
                ${agentCursor(i + 1)}
                <div class="fl"></div>
              </div>
            </div>
            <div class="log"></div>
          </div>`,
          )
          .join('')}</div>
        <p class="summary in" data-summary>3 isolated browsers · 3 png · <span class="hot">1 FAIL waiting for your sign-off</span></p>`;
      await W(60);
      await Promise.all(flows.map((f, i) => agent(W, f, i)));
      await W(400);
      show($('[data-summary]'));
      await W(3000);
    }

    player(figure, [act1, act2]);
  }

  // § 02: you answer, review, approve lessons, and watch cost and questions fall.
  function signOff(section) {
    const figure = section.querySelector('.stage');
    const label = figure.querySelector('[data-label]');
    const viewer = figure.querySelector('[data-viewer]');
    const memory = figure.querySelector('[data-memory]');
    const caption = figure.querySelector('[data-caption]');
    const steps = section.querySelectorAll('[data-steps] li');
    const $ = (sel) => viewer.querySelector(sel);

    function stage(n, text) {
      label.textContent = `0${n} / 04 · ${text}`;
      steps.forEach((li, i) => li.classList.toggle('on', i === n - 1));
      caption.textContent = '';
    }

    function view(title, body) {
      viewer.innerHTML = `<div class="vbar"><span>viewer · ${title}</span><span>127.0.0.1:4321</span></div><div class="vbody">${body}</div>${humanCursor()}`;
    }

    const go = (W, el) => moveTo(W, $('[data-cur]'), el, viewer);

    function remember(title, sub) {
      const d = document.createElement('div');
      d.className = 'mem in';
      d.innerHTML = '<div></div><div></div>';
      d.firstChild.textContent = title;
      d.lastChild.textContent = sub;
      memory.appendChild(d);
      show(d);
    }

    async function answer(W) {
      stage(1, 'answer once');
      memory.innerHTML = '';
      view(
        'SHOP-42 · run 1',
        `<div class="card in" data-q>
          <div class="k">agent-2 · TC-05 · waiting for you</div>
          <div class="q">Which account can approve a refund?</div>
          <div class="inrow"><span class="input" data-input>user</span><span class="ui-btn" data-send>Send</span></div>
          <div class="check"><span class="box" data-check></span>Remember for later runs</div>
        </div>
        <p class="in mono small" data-resume>agent-2 resumes TC-05 ▸</p>`,
      );
      await W(80);
      show($('[data-q]'));
      await W(700);
      const input = $('[data-input]');
      await go(W, input);
      input.textContent = '';
      input.style.color = '#0B0B0B';
      for (const ch of 'qa-approver-01 · env:QA_APPROVER') {
        input.textContent += ch;
        await W(40);
      }
      const check = $('[data-check]');
      await go(W, check);
      await press(W, check);
      check.style.background = '#C6FF00';
      check.textContent = '✓';
      await W(300);
      const send = $('[data-send]');
      await go(W, send);
      await press(W, send);
      send.style.background = '#C6FF00';
      remember('approver account', 'qa-approver-01 · secret env:QA_APPROVER');
      show($('[data-resume]'));
      caption.textContent = 'Saved as a memory. The password stays an env:NAME reference.';
      await W(2400);
    }

    async function review(W) {
      stage(2, 'review every verdict');
      const rows = [
        ['TC-01', 'login', 'PASS'],
        ['TC-03', 'coupon 10%', 'PASS'],
        ['TC-05', 'refund approval', 'PASS'],
        ['TC-07', 'pay with card', 'FAIL'],
      ];
      view(
        'SHOP-42 · review',
        rows
          .map(
            ([id, name, v]) => `<div class="rev"><span class="id">${id}</span><span class="name">${name}</span>
              <span class="chip ${v === 'PASS' ? 'pass' : 'fail'}" data-v>${v}</span>
              <span class="ui-btn" data-a>Approve</span><span class="ui-btn" data-r>Reject</span></div>`,
          )
          .join('') + `<p class="in mono small" data-retest style="margin-top:10px">retest · 1 of 4 cases · agent-3 · sonnet ▸ <span data-rv>running</span></p>`,
      );
      await W(500);
      const approve = viewer.querySelectorAll('[data-a]');
      for (let i = 0; i < 3; i++) {
        await go(W, approve[i]);
        await press(W, approve[i]);
        approve[i].style.background = '#0B0B0B';
        approve[i].style.color = '#C6FF00';
        approve[i].textContent = 'Approved ✓';
      }
      const reject = viewer.querySelectorAll('[data-r]')[3];
      await go(W, reject);
      await press(W, reject);
      reject.classList.add('fail');
      reject.textContent = 'Needs retest';
      show($('[data-retest]'));
      caption.textContent = 'Only the case you rejected runs again.';
      await W(1400);
      const chip = viewer.querySelectorAll('[data-v]')[3];
      chip.className = 'chip pass';
      chip.textContent = 'PASS';
      $('[data-rv]').textContent = 'PASS ✓';
      caption.textContent = 'Approved cases become scripts that replay later with no agent.';
      await W(2200);
    }

    async function lessons(W) {
      stage(3, 'approve what agents learn');
      const proposals = [
        ['Coupon codes are case-sensitive', 'agent-1 · from TC-03'],
        ['Pay button needs 2s after the toast', 'agent-3 · from TC-07'],
      ];
      view(
        'SHOP-42 · lessons',
        proposals
          .map(
            ([text, from]) => `<div class="card in" data-l>
              <div class="k">proposed lesson · ${from}</div><div class="q">${text}</div>
              <div class="inrow"><span class="ui-btn" data-ok>Approve</span><span class="ui-btn" data-no>Discard</span></div></div>`,
          )
          .join(''),
      );
      await W(80);
      const cards = viewer.querySelectorAll('[data-l]');
      show(cards[0]);
      await W(300);
      show(cards[1]);
      await W(700);
      const ok = cards[0].querySelector('[data-ok]');
      await go(W, ok);
      await press(W, ok);
      ok.style.background = '#C6FF00';
      ok.textContent = 'Approved ✓';
      remember('coupon codes are case-sensitive', 'learned · TC-03 · approved by you');
      await W(500);
      const no = cards[1].querySelector('[data-no]');
      await go(W, no);
      await press(W, no);
      cards[1].style.opacity = '.35';
      no.textContent = 'Discarded';
      caption.textContent = 'Nothing is reused until you approve it. Commit .qa/memory/ and your team shares it.';
      await W(2600);
    }

    const runs = [
      { cost: 1.84, questions: 5, kind: 'agent' },
      { cost: 1.12, questions: 3, kind: 'agent' },
      { cost: 0.61, questions: 1, kind: 'agent' },
      { cost: 0, questions: 0, kind: 'replay' },
      { cost: 0, questions: 0, kind: 'replay' },
      { cost: 0, questions: 0, kind: 'replay' },
    ];

    async function dashboard(W) {
      stage(4, 'see how agents are doing');
      viewer.innerHTML = `
        <div class="vbar"><span>viewer · dashboard · last 6 runs</span><span>all plans</span></div>
        <div class="tiles">
          <div class="tile"><b data-d>0%</b>pass rate</div>
          <div class="tile"><b data-d class="hot">0</b>failures</div>
          <div class="tile"><b data-d>0s</b>agent time / case</div>
          <div class="tile"><b data-d>0%</b>reviewer agreement</div>
        </div>
        <div class="chart">
          <div class="legend"><span>cost per run</span><span class="hot">questions asked ↓</span></div>
          <div class="bars">${runs
            .map(
              (r) => `<div><span class="q">${r.questions ? `${r.questions}?` : ''}</span><span>${r.kind === 'agent' ? `$${r.cost.toFixed(2)}` : '$0'}</span><i style="background:${r.kind === 'agent' ? '#0B0B0B' : '#C6FF00'}"></i></div>`,
            )
            .join('')}</div>
          <div class="labels">${runs.map((r, i) => `<span>${r.kind === 'agent' ? `run ${i + 1}` : 'replay'}</span>`).join('')}</div>
        </div>`;
      await W(80);
      const d = viewer.querySelectorAll('[data-d]');
      await Promise.all([
        count(W, d[0], 92, (v) => `${Math.round(v)}%`, 900),
        count(W, d[1], 1, (v) => `${Math.round(v)}`, 900),
        count(W, d[2], 48, (v) => `${Math.round(v)}s`, 900),
        count(W, d[3], 96, (v) => `${Math.round(v)}%`, 900),
      ]);
      const bars = viewer.querySelectorAll('.bars i');
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        bars[i].style.height = `${r.kind === 'agent' ? Math.max(6, (r.cost / 1.84) * 62) : 4}px`;
        await W(250);
      }
      caption.textContent = 'Every answer and lesson you approve means fewer questions next run. Approved cases replay at $0.';
      await W(3600);
    }

    player(figure, [answer, review, lessons, dashboard]);
  }

  function tabs(root) {
    const list = [...root.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      for (const t of list) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
    };
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab) select(tab);
    });
    root.addEventListener('keydown', (e) => {
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = list[(i + step + list.length) % list.length];
      select(next);
      next.focus();
      e.preventDefault();
    });
  }

  function copyButtons() {
    for (const btn of document.querySelectorAll('[data-copy]')) {
      btn.addEventListener('click', async () => {
        const text = document.getElementById(btn.dataset.copy).textContent.trim();
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied';
        } catch {
          btn.textContent = 'Select it';
        }
        btn.dataset.done = '';
        setTimeout(() => {
          btn.textContent = 'Copy';
          delete btn.dataset.done;
        }, 1600);
      });
    }
  }

  watchIt(document.querySelector('#watch .stage'));
  signOff(document.querySelector('#signoff'));
  document.querySelectorAll('[data-tabs]').forEach(tabs);
  copyButtons();
})();
