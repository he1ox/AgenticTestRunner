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

  // Scene header for a section with a numbered step list: sets the label, lights the step and
  // clears the caption.
  function stepper(section, figure) {
    const label = figure.querySelector('[data-label]');
    const caption = figure.querySelector('[data-caption]');
    const steps = section.querySelectorAll('[data-steps] li');
    return (n, text) => {
      label.textContent = `0${n} / 0${steps.length} · ${text}`;
      steps.forEach((li, i) => li.classList.toggle('on', i === n - 1));
      caption.textContent = '';
    };
  }

  async function typeInto(W, el, text, ms = 40) {
    el.textContent = '';
    el.classList.add('typed');
    for (const ch of text) {
      el.textContent += ch;
      await W(ms);
    }
  }

  // § 02: you answer a question once, review every verdict and approve what agents learn.
  function signOff(section) {
    const figure = section.querySelector('.stage');
    const viewer = figure.querySelector('[data-viewer]');
    const memory = figure.querySelector('[data-memory]');
    const caption = figure.querySelector('[data-caption]');
    const stage = stepper(section, figure);
    const $ = (sel) => viewer.querySelector(sel);

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
      await typeInto(W, input, 'qa-approver-01 · env:QA_APPROVER');
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

    player(figure, [answer, review, lessons]);
  }

  // § 03: the dashboard's insights, a chat about one case, a Test plan replayed with no agent,
  // and how approved feedback adds up over runs.
  function smarter(section) {
    const figure = section.querySelector('.stage');
    const viewer = figure.querySelector('[data-viewer]');
    const caption = figure.querySelector('[data-caption]');
    const stage = stepper(section, figure);
    const $ = (sel) => viewer.querySelector(sel);
    const go = (W, el) => moveTo(W, $('[data-cur]'), el, viewer);

    function view(title, right, body, cursor = true) {
      viewer.innerHTML = `<div class="dbar"><span>${title}</span><span>${right}</span></div><div class="dbody">${body}</div>${cursor ? humanCursor() : ''}`;
    }

    const hbar = (name, width, value, color) =>
      `<div class="hbar"><span>${name}</span><i style="width:${width}%;background:${color}"></i><span>${value}</span></div>`;

    async function insights(W) {
      stage(1, 'insights');
      view(
        'dashboard · test agents',
        '12 runs · last 30 days',
        `<div class="kpis">
          <div class="kpi"><b data-k>0%</b>pass rate</div>
          <div class="kpi"><b data-k class="hot">0</b>failed</div>
          <div class="kpi"><b data-k>0s</b>time per case</div>
          <div class="kpi"><b data-k>$0.00</b>cost</div>
        </div>
        <div class="insights">
          <div class="icard in"><p class="ih">cases that need attention</p>
            <div class="flip" data-tc7><span>TC-07 pay with card</span><span class="mono"><span class="acid">P</span> <span class="hot">F</span> <span class="acid">P</span> <span class="hot">F</span></span></div>
            <p class="ins">↳ flip-flops between runs</p></div>
          <div class="icard in"><p class="ih">outcomes by device</p>
            ${hbar('desktop', 62, '96%', '#C6FF00')}${hbar('mobile', 42, '71%', '#FF3EA5')}
            <p class="ins">↳ mobile fails 4× more</p></div>
          <div class="icard in"><p class="ih">slowest cases</p>
            ${hbar('TC-12', 70, '2m10s', '#E8E8E8')}${hbar('TC-05', 26, '48s', '#555')}
            <p class="ins">↳ the refund flow waits on email</p></div>
          <div class="icard in"><p class="ih">where agent context goes</p>
            <div class="stack"><i style="width:58%;background:#C6FF00"></i><i style="width:24%;background:#FF3EA5"></i><i style="width:18%;background:#555"></i></div>
            <p class="mono small-m">snapshots 58% · screenshots 24%</p>
            <p class="ins">↳ trim page snapshots first</p></div>
        </div>`,
      );
      await W(60);
      const k = viewer.querySelectorAll('[data-k]');
      await Promise.all([
        count(W, k[0], 91, (v) => `${Math.round(v)}%`, 800),
        count(W, k[1], 3, (v) => `${Math.round(v)}`, 800),
        count(W, k[2], 52, (v) => `${Math.round(v)}s`, 800),
        count(W, k[3], 4.1, (v) => `$${v.toFixed(2)}`, 800),
      ]);
      for (const card of viewer.querySelectorAll('.icard')) {
        show(card);
        await W(650);
      }
      caption.textContent = 'The dashboard tells you where to look: unstable cases, weak variants, slow flows, wasted context.';
      await W(1400);
      const tc = $('[data-tc7]');
      await go(W, tc);
      await press(W, tc);
      tc.classList.add('picked');
      await W(500);
    }

    async function chat(W) {
      stage(2, 'ask the agent');
      view(
        'SHOP-42 · TC-07 · FAIL',
        'chat with your agent',
        `<div class="chatgrid">
          <div class="shot">
            <p class="mono shot-name">TC-07_02.png · mobile</p>
            <div class="shot-body">
              <div class="bar" style="width:70%"></div><div class="bar" style="width:50%"></div>
              <div class="toast" data-toast>Address saved ✓</div>
              <div class="pay">Pay now</div>
            </div>
            <svg class="ov" data-ov></svg>
          </div>
          <div class="chatcol">
            <div class="msgs" data-msgs></div>
            <div class="chatin"><span class="mono" data-ci>Ask, or request a mark…</span><span class="dbtn mono" data-cs>Send</span></div>
          </div>
        </div>`,
      );
      await W(60);
      const msgs = $('[data-msgs]'), input = $('[data-ci]'), send = $('[data-cs]');
      const say = (who, text) => {
        const b = document.createElement('div');
        b.className = `bub in ${who}`;
        b.textContent = text;
        msgs.appendChild(b);
        show(b);
      };
      async function ask(text) {
        await go(W, input);
        await typeInto(W, input, text, 35);
        await go(W, send);
        await press(W, send);
        say('you', text);
        input.textContent = '';
        await W(700);
      }
      await ask('Why did Pay fail on mobile?');
      say('agent', 'A toast covered Pay for about 2s. I clicked before it closed. Screenshot 02 shows it.');
      await W(1600);
      await ask('Box the toast and propose a lesson');
      const shot = $('.shot');
      const p = rel($('[data-toast]'), shot);
      markBox($('[data-ov]'), { x: p.x, y: p.y, w: p.w, h: p.h + 26 }, '#FF3EA5');
      await W(700);
      say('agent', 'Marked. Proposed lesson: wait for the toast to close before paying.');
      caption.textContent = 'Chat per case: ask what the agent saw, have it mark the screenshot, turn the answer into a lesson.';
      await W(2600);
    }

    const library = [
      ['TC-01', 'login', 'smoke'],
      ['TC-03', 'coupon 10%', 'smoke'],
      ['TC-05', 'refund approval', 'regression'],
      ['TC-07', 'pay with card', 'smoke'],
      ['TC-09', 'order history', 'regression'],
      ['TC-12', 'refund email', 'regression'],
    ];

    async function testPlan(W) {
      stage(3, 'replay a Test plan');
      view(
        'tests · test plans',
        'library · 6 scripts',
        `<div class="newplan"><span class="mono field-d" data-name>Name</span><span class="mono field-d tags" data-tags>tags</span><span class="dbtn mono" data-save>New test plan</span></div>
        ${library
          .map(
            ([id, name, tag]) => `<div class="lrow"><span class="cb" data-cb></span><span class="mono id">${id}</span><span class="name">${name}</span><span class="tg mono">${tag}</span><span class="mono res" data-res>script v2</span></div>`,
          )
          .join('')}
        <div class="runrow"><span class="mono in" data-sum>6 passed · 41s · <span class="acid">$0.00 · 0 tokens</span></span><span class="dbtn run mono" data-run>▶ Run</span></div>`,
      );
      await W(60);
      const name = $('[data-name]'), tags = $('[data-tags]');
      await go(W, name);
      await typeInto(W, name, 'Release 1.0.1', 45);
      await go(W, tags);
      await typeInto(W, tags, 'smoke, regression', 30);
      const boxes = viewer.querySelectorAll('[data-cb]');
      for (const i of [0, 1, 3, 5]) {
        await go(W, boxes[i]);
        boxes[i].classList.add('on');
        boxes[i].textContent = '✓';
        await W(120);
      }
      const save = $('[data-save]');
      await go(W, save);
      await press(W, save);
      save.textContent = 'Saved ✓';
      await W(400);
      const run = $('[data-run]');
      await go(W, run);
      await press(W, run);
      caption.textContent = 'No agent runs here. Each script replays in its own headless browser.';
      for (const res of viewer.querySelectorAll('[data-res]')) {
        res.textContent = 'replaying…';
        res.classList.add('live');
        await W(380);
        res.innerHTML = '<span class="acid">PASS</span> · Deterministic';
      }
      show($('[data-sum]'));
      await W(800);
      caption.textContent = 'Same plan in CI: suite run release-1.0.1 --ci exits 0 and writes a JUnit report.';
      await W(2400);
    }

    const trend = { questions: [5, 3, 2, 1, 0, 0], agreement: [72, 81, 88, 93, 96, 97], memories: [0, 3, 5, 7, 8, 9] };
    const feed = [
      'you answered “approver?” → remembered',
      'you rejected TC-07 → retest',
      'you approved a lesson → memory',
      'agents read memory before run 4',
      'TC-07 stable on mobile',
      'run 6: 0 questions to you',
    ];

    async function compound(W) {
      stage(4, 'your feedback compounds');
      const X = (i) => 30 + i * 72;
      const Yq = (v) => 150 - v * 22;
      const Ya = (v) => 150 - (v - 60) * 3.2;
      view(
        'dashboard · trend',
        'runs 1–6',
        `<div class="trend">
          <div>
            <svg viewBox="0 0 420 175" class="trend-chart" role="presentation">
              <line x1="20" y1="150" x2="410" y2="150" stroke="#333"/>
              ${trend.memories
                .map(
                  (v, i) => `<rect class="in" x="${X(i) - 9}" y="${150 - v * 8}" width="18" height="${v * 8}" fill="#2a2a2a"/><text x="${X(i)}" y="168" fill="#8A8A8A" font-size="11" text-anchor="middle" font-family="JetBrains Mono, monospace">run ${i + 1}</text>`,
                )
                .join('')}
              <polyline class="mk" data-line fill="none" stroke="#C6FF00" stroke-width="2.5" points="${trend.agreement.map((v, i) => `${X(i)},${Ya(v)}`).join(' ')}"/>
              <polyline class="mk" data-line fill="none" stroke="#FF3EA5" stroke-width="2.5" points="${trend.questions.map((v, i) => `${X(i)},${Yq(v)}`).join(' ')}"/>
              <text x="${X(5)}" y="${Ya(97) - 8}" fill="#C6FF00" font-size="11" text-anchor="end" font-family="JetBrains Mono, monospace">agreement 72→97%</text>
              <text x="${X(0) + 4}" y="${Yq(5) - 8}" fill="#FF3EA5" font-size="11" font-family="JetBrains Mono, monospace">questions 5→0</text>
            </svg>
            <p class="mono small-m dim">bars: approved memories 0→9</p>
          </div>
          <div class="feed mono" data-feed></div>
        </div>`,
        false,
      );
      await W(60);
      const bars = viewer.querySelectorAll('.trend-chart rect');
      const list = $('[data-feed]');
      for (let i = 0; i < feed.length; i++) {
        show(bars[i]);
        const line = document.createElement('div');
        line.className = 'in';
        line.textContent = `› ${feed[i]}`;
        if (i > 3) line.classList.add('acid');
        list.appendChild(line);
        show(line);
        await W(550);
      }
      for (const line of viewer.querySelectorAll('[data-line]')) show(line);
      await W(1200);
      caption.textContent = 'Agents read the memory you approved before every run. They ask you less and agree with you more.';
      await W(3600);
    }

    player(figure, [insights, chat, testPlan, compound]);
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
  smarter(document.querySelector('#smarter'));
  document.querySelectorAll('[data-tabs]').forEach(tabs);
  copyButtons();
})();
