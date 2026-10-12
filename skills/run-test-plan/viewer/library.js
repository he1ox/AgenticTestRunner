// Test library and Test plans. Every case an agent passed is a replayable script ("Tests"); a
// Test plan is a name, free tags and a list of those tests, run deterministically (no agent, no
// tokens) with one click. Data comes from /api/tests and /api/suites.

const STATUS_LABEL = { draft: 'Draft', verified: 'Verified' };

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const counts = (c = {}) =>
  [c.pass && `${c.pass} pass`, c.fail && `${c.fail} fail`, c.blocked && `${c.blocked} blocked`, (c.running || c.pending) && `${(c.running || 0) + (c.pending || 0)} in progress`]
    .filter(Boolean)
    .join(' · ') || `${c.total || 0} cases`;

export function createLibrary({ host, api, icon, toast, onOpenRun }) {
  const state = {
    tests: [],
    suites: [],
    suite: null,
    draft: null,
    route: null,
    filters: { query: '', tag: '', status: '', plan: '' },
    pick: new Set(),
  };
  const runStatus = (s) => `<span class="badge s-${esc(s)}">${icon(s)}${esc(s)}</span>`;
  const testStatus = (s) =>
    `<span class="badge lib-status ${s === 'verified' ? 's-pass' : 's-pending'}" title="${s === 'verified' ? 'A reviewer approved the run it was recorded from' : 'Recorded from a passing run nobody has approved yet'}">${icon(s === 'verified' ? 'approved' : 'pending')}${esc(STATUS_LABEL[s] || s)}</span>`;
  const tagList = (tags) => (tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
  const allTags = () => [...new Set(state.tests.flatMap((t) => t.tags || []))].sort();
  const plans = () => [...new Set(state.tests.map((t) => t.planId))].sort();

  function matches(t, f = state.filters) {
    const q = f.query.trim().toLowerCase();
    return (
      (!f.tag || (t.tags || []).includes(f.tag)) &&
      (!f.status || t.status === f.status) &&
      (!f.plan || t.planId === f.plan) &&
      (!q || [t.id, t.title, ...(t.tags || [])].join(' ').toLowerCase().includes(q))
    );
  }

  function filterBar(prefix) {
    const f = state.filters;
    return `
      <div class="lib-filters" role="search">
        <label class="search lib-search">${icon('search')}<span class="sr-only">Filter tests</span>
          <input type="search" data-filter="query" placeholder="Filter by id, title, tag…" value="${esc(f.query)}" autocomplete="off" id="${prefix}-query" /></label>
        <label class="dash-inline-select"><span>Tag</span><select data-filter="tag"><option value="">All tags</option>${allTags()
          .map((t) => `<option value="${esc(t)}" ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`)
          .join('')}</select></label>
        <label class="dash-inline-select"><span>Status</span><select data-filter="status"><option value="">Any</option>${Object.entries(STATUS_LABEL)
          .map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`)
          .join('')}</select></label>
        <label class="dash-inline-select"><span>From plan</span><select data-filter="plan"><option value="">All</option>${plans()
          .map((p) => `<option value="${esc(p)}" ${f.plan === p ? 'selected' : ''}>${esc(p)}</option>`)
          .join('')}</select></label>
      </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // Tests

  function renderTests() {
    const list = state.tests.filter((t) => matches(t));
    host.innerHTML = `
      <div class="dash-head">
        <div><h1>Tests</h1><p class="dash-muted">Every case a Test Agent passed is saved as a script that replays without an agent: same steps, same screenshots and marks, same recording. ${state.tests.length} in the library.</p></div>
        <div class="lib-actions"><button type="button" class="btn" data-export-tests ${list.length ? '' : 'disabled'} title="Write the tests shown as Playwright Test files (.spec.ts)">${icon('file')}Export to Playwright</button><a class="btn" href="#/plans">${icon('file')}Test plans</a></div>
      </div>
      ${filterBar('tests')}
      ${
        state.tests.length
          ? `<div class="card lib-card"><div class="table-wrap"><table class="dash-table lib-table">
          <thead><tr><th scope="col">Test</th><th scope="col">Tags</th><th scope="col">Status</th><th scope="col" class="num">Steps</th><th scope="col">Last replay</th><th scope="col">Recorded from</th></tr></thead>
          <tbody>${
            list
              .map(
                (t) => `<tr>
              <td><div class="run-title">${esc(t.title)}</div><span class="mono">${esc(t.id)}</span> <span class="dash-muted">v${esc(t.version)}</span></td>
              <td><div class="lib-tags">${tagList(t.tags)}<button type="button" class="icon-btn small" data-edit-tags="${esc(t.id)}" aria-label="Edit tags of ${esc(t.id)}" title="Edit tags">${icon('pencil')}</button></div></td>
              <td><div class="lib-tags">${testStatus(t.status)}<button type="button" class="btn small" data-toggle-status="${esc(t.id)}">${t.status === 'verified' ? 'Unverify' : 'Verify'}</button></div></td>
              <td class="num">${t.steps.length}</td>
              <td>${t.lastReplay ? `<a href="#/run/${encodeURIComponent(t.lastReplay.runId)}">${runStatus(t.lastReplay.status)}</a> <span class="dash-muted">${esc(fmtDate(t.lastReplay.at))}</span>` : '<span class="dash-muted">Never replayed</span>'}</td>
              <td><a class="mono" href="#/run/${encodeURIComponent(t.recordedFrom.runId)}/tc/${encodeURIComponent(t.recordedFrom.tcId)}">${esc(t.recordedFrom.runId)}</a>${t.recordedFrom.model ? ` <span class="dash-muted">${esc(t.recordedFrom.model)}</span>` : ''}</td>
            </tr>`,
              )
              .join('') || '<tr><td colspan="6" class="dash-muted">No test matches the filters.</td></tr>'
          }</tbody></table></div></div>`
          : `<p class="empty">No tests yet. They are saved automatically when a Test Agent passes a case and the orchestrator records the batch with <span class="mono">qa-runs usage --batch … --transcript …</span>.</p>`
      }`;
  }

  async function editTags(id) {
    const test = state.tests.find((t) => t.id === id);
    const value = prompt(`Tags for ${id} (comma separated)`, (test?.tags || []).join(', '));
    if (value === null) return;
    const [planId, tcId] = id.split('/');
    try {
      await api(`/api/tests/${encodeURIComponent(planId)}/${encodeURIComponent(tcId)}`, { method: 'PUT', body: JSON.stringify({ tags: value }) });
      await reload();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function toggleStatus(id) {
    const test = state.tests.find((t) => t.id === id);
    const [planId, tcId] = id.split('/');
    try {
      await api(`/api/tests/${encodeURIComponent(planId)}/${encodeURIComponent(tcId)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: test.status === 'verified' ? 'draft' : 'verified' }),
      });
      await reload();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Test plans

  function lastRun(suite) {
    const run = suite.runs?.[0];
    return run
      ? `<a href="#/run/${encodeURIComponent(run.id)}">${esc(counts(run.counts))}</a> <span class="dash-muted">${esc(fmtDate(run.createdAt))}</span>`
      : '<span class="dash-muted">Never run</span>';
  }

  function renderPlans() {
    host.innerHTML = `
      <div class="dash-head">
        <div><h1>Test plans</h1><p class="dash-muted">Group library tests under a name and your own tags (smoke, regression, a release…), then run them deterministically: no agent, no tokens.</p></div>
        <a class="btn" href="#/tests">${icon('file')}Tests <span class="count">${state.tests.length}</span></a>
      </div>
      <form class="card lib-new" id="lib-new" aria-label="New test plan">
        <div class="card-body lib-new-row">
          <label class="lib-field"><span>Name</span><input name="name" required placeholder="Release 1.0.1" autocomplete="off" /></label>
          <label class="lib-field"><span>Tags</span><input name="tags" placeholder="smoke, regression" autocomplete="off" /></label>
          <button type="submit" class="btn primary">${icon('plus')}New test plan</button>
        </div>
      </form>
      ${
        state.suites.length
          ? `<div class="card lib-card"><div class="table-wrap"><table class="dash-table lib-table">
        <thead><tr><th scope="col">Test plan</th><th scope="col">Tags</th><th scope="col" class="num">Tests</th><th scope="col">Last run</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${state.suites
          .map(
            (s) => `<tr>
            <td><a class="run-title" href="#/plan/${encodeURIComponent(s.id)}">${esc(s.name)}</a><div class="mono dash-muted">${esc(s.id)}</div></td>
            <td><div class="lib-tags">${tagList(s.tags) || '<span class="dash-muted">—</span>'}</div></td>
            <td class="num">${s.tests.length}</td>
            <td>${lastRun(s)}</td>
            <td><div class="lib-actions"><a class="btn small" href="#/plan/${encodeURIComponent(s.id)}">Edit</a><button type="button" class="btn small primary" data-run-suite="${esc(s.id)}" ${s.tests.length ? '' : 'disabled'}>${icon('running')}Run</button></div></td>
          </tr>`,
          )
          .join('')}</tbody></table></div></div>`
          : '<p class="empty">No test plans yet. Name one above, then pick the tests it runs.</p>'
      }`;
  }

  async function createSuite(form) {
    const data = new FormData(form);
    try {
      const suite = await api('/api/suites', { method: 'POST', body: JSON.stringify({ name: data.get('name'), tags: data.get('tags'), tests: [] }) });
      location.hash = `#/plan/${encodeURIComponent(suite.id)}`;
    } catch (error) {
      toast(error.message, true);
    }
  }

  // The tests the filters show → Playwright Test files (export-playwright.mjs); a file changed by
  // hand is skipped, and the CLI's --force is the only way to replace it.
  async function exportTests() {
    const ids = state.tests.filter((t) => matches(t)).map((t) => t.id);
    try {
      const { lines, files } = await api('/api/tests/export', { method: 'POST', body: JSON.stringify({ ids }) });
      const skipped = files.filter((f) => f.state === 'exists').length;
      const folder = files[0] ? ` in ${files[0].file.split('/').slice(0, -2).join('/')}/` : '';
      const why = skipped ? ' Skipped files were changed by hand; `qa-runs.mjs export --force` replaces them.' : '';
      toast(`Playwright${folder}: ${lines.at(-2)}${why}`, skipped > 0);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function runSuite(id) {
    try {
      if (state.draft?.id === id && dirty()) await saveDraft();
      const { runId, warnings } = await api(`/api/suites/${encodeURIComponent(id)}/run`, { method: 'POST', body: '{}' });
      toast(warnings?.length ? `Started ${runId} · ${warnings.length} warning(s): ${warnings[0]}` : `Started ${runId}`);
      onOpenRun(runId);
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // One test plan: name, tags, the tests it runs, a picker to add more, and its runs

  const dirty = () =>
    state.draft &&
    state.suite &&
    (state.draft.name !== state.suite.name ||
      state.draft.tags.join() !== state.suite.tags.join() ||
      state.draft.tests.join() !== state.suite.tests.join());

  function renderPlan() {
    const d = state.draft;
    const byId = new Map(state.tests.map((t) => [t.id, t]));
    const included = new Set(d.tests);
    const candidates = state.tests.filter((t) => !included.has(t.id) && matches(t));
    const tagCounts = allTags().map((tag) => [tag, candidates.filter((t) => t.tags.includes(tag)).length]);
    host.innerHTML = `
      <div class="dash-head">
        <div><a class="dash-muted lib-back" href="#/plans">← Test plans</a><h1>${esc(d.name || 'Untitled')}</h1>
          <p class="dash-muted">${d.tests.length} test${d.tests.length === 1 ? '' : 's'} · runs in recorded order, grouped by the session they were recorded in.</p></div>
        <div class="lib-actions">
          <span class="${dirty() ? 'dirty' : 'saved'}" id="lib-save-state">${dirty() ? 'Unsaved changes' : `Saved ${esc(fmtDate(state.suite.updatedAt))}`}</span>
          <button type="button" class="btn" data-save ${dirty() ? '' : 'disabled'}>Save</button>
          <button type="button" class="btn primary" data-run-suite="${esc(d.id)}" ${d.tests.length ? '' : 'disabled'}>${icon('running')}Run test plan</button>
        </div>
      </div>

      <div class="card"><div class="card-body lib-new-row">
        <label class="lib-field"><span>Name</span><input data-draft="name" value="${esc(d.name)}" autocomplete="off" /></label>
        <div class="lib-field"><span id="lib-tags-label">Tags</span>
          <div class="lib-tag-input" role="group" aria-labelledby="lib-tags-label">
            ${d.tags.map((t) => `<span class="tag">${esc(t)}<button type="button" class="tag-x" data-remove-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}
            <input id="lib-tag-new" placeholder="${d.tags.length ? 'Add tag' : 'smoke, regression…'}" autocomplete="off" aria-label="Add a tag and press Enter" />
          </div>
        </div>
      </div></div>

      <div class="lib-columns">
        <section class="card" aria-labelledby="lib-included-h">
          <h3 id="lib-included-h">Included tests <span class="count">${d.tests.length}</span></h3>
          ${
            d.tests.length
              ? `<ol class="lib-list">${d.tests
                  .map((id, i) => {
                    const t = byId.get(id);
                    return `<li class="lib-item">
                  <div class="lib-item-main">${t ? `<span class="run-title">${esc(t.title)}</span> <span class="mono dash-muted">${esc(id)}</span><div class="lib-tags">${testStatus(t.status)} ${tagList(t.tags)}</div>` : `<span class="mono">${esc(id)}</span> <span class="badge s-fail">missing from the library</span>`}</div>
                  <div class="lib-item-actions">
                    <button type="button" class="icon-btn small" data-move="${i}" data-dir="-1" aria-label="Move ${esc(id)} up" ${i ? '' : 'disabled'}>${icon('chevron-left')}</button>
                    <button type="button" class="icon-btn small" data-move="${i}" data-dir="1" aria-label="Move ${esc(id)} down" ${i < d.tests.length - 1 ? '' : 'disabled'}>${icon('chevron-right')}</button>
                    <button type="button" class="icon-btn small" data-remove-test="${esc(id)}" aria-label="Remove ${esc(id)}">${icon('close')}</button>
                  </div></li>`;
                  })
                  .join('')}</ol>`
              : '<p class="empty">No tests yet. Pick them on the right, or add every test with a tag.</p>'
          }
        </section>

        <section class="card" aria-labelledby="lib-add-h">
          <h3 id="lib-add-h">Add tests</h3>
          <div class="card-body">
            ${filterBar('plan')}
            ${
              tagCounts.some(([, n]) => n)
                ? `<div class="chips lib-quick" role="group" aria-label="Add every test with a tag">${tagCounts
                    .filter(([, n]) => n)
                    .map(([tag, n]) => `<button type="button" class="chip" data-add-tag="${esc(tag)}">${icon('plus')}all ${esc(tag)} <b>${n}</b></button>`)
                    .join('')}</div>`
                : ''
            }
            ${
              candidates.length
                ? `<ul class="lib-list lib-pick">${candidates
                    .map(
                      (t) => `<li class="lib-item"><label class="lib-check"><input type="checkbox" data-pick="${esc(t.id)}" ${state.pick.has(t.id) ? 'checked' : ''} />
                  <span><span class="run-title">${esc(t.title)}</span> <span class="mono dash-muted">${esc(t.id)}</span><span class="lib-tags">${testStatus(t.status)} ${tagList(t.tags)}</span></span></label></li>`,
                    )
                    .join('')}</ul>
                  <div class="lib-pick-actions"><button type="button" class="btn" data-pick-all>Select all ${candidates.length}</button><button type="button" class="btn primary" data-add-picked ${state.pick.size ? '' : 'disabled'}>${icon('plus')}Add ${state.pick.size || ''} selected</button></div>`
                : `<p class="dash-muted">${state.tests.length ? 'Every matching test is already in this plan.' : 'The library is empty: tests appear here once an agent passes a case.'}</p>`
            }
          </div>
        </section>
      </div>

      <section class="card" aria-labelledby="lib-runs-h">
        <h3 id="lib-runs-h">Runs</h3>
        ${
          state.suite.runs?.length
            ? `<div class="table-wrap"><table class="dash-table"><thead><tr><th scope="col">Run</th><th scope="col">Started</th><th scope="col">Outcome</th></tr></thead><tbody>${state.suite.runs
                .map(
                  (r) =>
                    `<tr class="clickable" data-open-run="${esc(r.id)}" tabindex="0"><td class="mono">${esc(r.id)}</td><td>${esc(fmtDate(r.createdAt))}</td><td>${esc(counts(r.counts))}</td></tr>`,
                )
                .join('')}</tbody></table></div>`
            : '<p class="dash-muted card-body">Not run yet.</p>'
        }
      </section>
      <p class="lib-danger"><button type="button" class="btn" data-delete-suite>${icon('close')}Delete this test plan</button></p>`;
  }

  async function saveDraft() {
    try {
      const saved = await api(`/api/suites/${encodeURIComponent(state.draft.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: state.draft.name, tags: state.draft.tags, tests: state.draft.tests }),
      });
      state.suite = { ...state.suite, ...saved };
      state.draft = { ...state.draft, ...saved, tags: [...saved.tags], tests: [...saved.tests] };
      toast('Test plan saved');
      renderPlan();
    } catch (error) {
      toast(error.message, true);
    }
  }

  const change = (fn) => {
    fn(state.draft);
    renderPlan();
  };

  // ---------------------------------------------------------------------------------------------

  async function reload() {
    const [tests, suites] = await Promise.all([api('/api/tests'), api('/api/suites')]);
    state.tests = tests;
    state.suites = suites;
    render();
  }

  function render() {
    if (state.route?.view === 'tests') return renderTests();
    if (state.route?.view === 'plans') return renderPlans();
    if (state.route?.view === 'plan' && state.draft) return renderPlan();
  }

  async function show(route) {
    const samePlan = route.view === 'plan' && state.route?.view === 'plan' && state.route.id === route.id;
    state.route = route;
    state.pick.clear();
    const [tests, suites] = await Promise.all([api('/api/tests'), api('/api/suites')]);
    state.tests = tests;
    state.suites = suites;
    if (route.view === 'plan') {
      state.suite = await api(`/api/suites/${encodeURIComponent(route.id)}`);
      if (!samePlan || !dirty()) state.draft = { ...state.suite, tags: [...state.suite.tags], tests: [...state.suite.tests] };
    }
    render();
  }

  host.addEventListener('submit', (event) => {
    if (event.target.id !== 'lib-new') return;
    event.preventDefault();
    createSuite(event.target);
  });

  host.addEventListener('input', (event) => {
    const filter = event.target.dataset.filter;
    if (filter === 'query') {
      state.filters.query = event.target.value;
      const { selectionStart } = event.target;
      render();
      const input = host.querySelector(`[data-filter="query"]`);
      input?.focus();
      input?.setSelectionRange(selectionStart, selectionStart);
    } else if (event.target.dataset.draft === 'name') {
      state.draft.name = event.target.value;
      const saveState = host.querySelector('#lib-save-state');
      if (saveState) saveState.textContent = dirty() ? 'Unsaved changes' : 'Saved';
      host.querySelector('[data-save]')?.toggleAttribute('disabled', !dirty());
    }
  });

  host.addEventListener('change', (event) => {
    const filter = event.target.dataset.filter;
    if (filter && filter !== 'query') {
      state.filters[filter] = event.target.value;
      render();
    } else if (event.target.dataset.pick) {
      if (event.target.checked) state.pick.add(event.target.dataset.pick);
      else state.pick.delete(event.target.dataset.pick);
      render();
    } else if (event.target.dataset.draft === 'name') renderPlan();
  });

  host.addEventListener('keydown', (event) => {
    if (event.target.id !== 'lib-tag-new' || (event.key !== 'Enter' && event.key !== ',')) return;
    event.preventDefault();
    const tags = event.target.value
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!tags.length) return;
    change((d) => (d.tags = [...new Set([...d.tags, ...tags])]));
    host.querySelector('#lib-tag-new')?.focus();
  });

  host.addEventListener('click', (event) => {
    const target = event.target.closest('button, tr[data-open-run]');
    if (!target) return;
    const data = target.dataset;
    if (data.editTags) return editTags(data.editTags);
    if (data.toggleStatus) return toggleStatus(data.toggleStatus);
    if (data.exportTests !== undefined) return exportTests();
    if (data.runSuite) return runSuite(data.runSuite);
    if (data.openRun) return onOpenRun(data.openRun);
    if (data.save !== undefined) return saveDraft();
    if (data.removeTag) return change((d) => (d.tags = d.tags.filter((t) => t !== data.removeTag)));
    if (data.removeTest) return change((d) => (d.tests = d.tests.filter((t) => t !== data.removeTest)));
    if (data.move !== undefined)
      return change((d) => {
        const i = Number(data.move);
        const j = i + Number(data.dir);
        [d.tests[i], d.tests[j]] = [d.tests[j], d.tests[i]];
      });
    if (data.addTag)
      return change((d) => {
        const ids = state.tests.filter((t) => t.tags.includes(data.addTag) && matches(t)).map((t) => t.id);
        d.tests = [...new Set([...d.tests, ...ids])];
      });
    if (data.pickAll !== undefined) {
      const included = new Set(state.draft.tests);
      for (const t of state.tests.filter((t) => !included.has(t.id) && matches(t))) state.pick.add(t.id);
      return renderPlan();
    }
    if (data.addPicked !== undefined)
      return change((d) => {
        d.tests = [...new Set([...d.tests, ...state.pick])];
        state.pick.clear();
      });
    if (data.deleteSuite !== undefined) {
      if (!confirm(`Delete the test plan "${state.draft.name}"? Its runs stay in .qa/runs.`)) return;
      return api(`/api/suites/${encodeURIComponent(state.draft.id)}`, { method: 'DELETE' })
        .then(() => (location.hash = '#/plans'))
        .catch((error) => toast(error.message, true));
    }
  });

  return { show, isDirty: () => state.route?.view === 'plan' && dirty() };
}
