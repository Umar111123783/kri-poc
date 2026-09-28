import React, { useState, useEffect } from 'react';
import { fmtDate, fmtMoney, FREQ, SOURCES, CLOSE_CALENDAR, nextRunFor } from '../constants.js';
import { Btn, Tag, Field, Drawer, SourceChip, statusTone, statusLabel } from '../ui.jsx';
export function KriLibrary({ kris, runs = [], excs = [], saveKri, deleteKri, setKriStatus, setRunReq }) {
  const [edit, setEdit] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [filter, setFilter] = useState('all');
  const shown = kris.filter((k) => filter === 'all' || k.area === filter || k.status === filter);

  // KRI Metrics Summary Calculations
  const totalTransactions = runs.reduce((acc, r) => acc + (r.tested || 0), 0);
  const totalExceptions = runs.reduce((acc, r) => acc + (r.exceptions || 0), 0) || excs.length;
  const exceptionRate = totalTransactions > 0 ? ((totalExceptions / totalTransactions) * 100).toFixed(2) : '0.00';
  const totalMismatchDollar = excs.reduce((acc, e) => acc + (e.amount || 0), 0);
  const activeKris = kris.filter((k) => k.status === 'active').length;

  const blank = () => ({
    id: `KRI-${String(kris.length + 1).padStart(2, '0')}`, name: '', area: 'O2C', kind: 'Lagging', status: 'draft', risk: '', objective: '',
    sources: ['sap'], steps: ['Extract the population for the period.', 'Apply the test and classify each item.'],
    thresholds: [{ key: 'minAmount', label: 'Minimum amount', value: 10000, unit: 'EUR' }, { key: 'residual', label: 'Planner trigger: unexplained items per region', value: 5, unit: 'items' }],
    frequency: 'monthly', alignToClose: true, fetchOffsetDays: 3, sampling: 100, reviewer: 'Audit Manager', hitl: 'exceptions', owner: 'Internal Audit', lastRun: null,
  });

  const upsert = (k) => saveKri(k).then((saved) => { if (saved) setEdit(null); });
  const handleDelete = (id) => {
    if (confirm(`Are you sure you want to delete KRI ${id}?`)) {
      deleteKri(id).then(() => setEdit(null));
    }
  };
  const setStatus = (id, status) => setKriStatus(id, status, statusLabel(status).toLowerCase());

  return (
    <section>
      <header className="page-head row">
        <div><h1>KRI library</h1><p className="lede">Nothing here is hard-coded. Each KRI is a configuration: what to pull, which steps to perform, what counts as an exception, and when to run.</p></div>
        <div className="actions"><Btn onClick={() => setShowJson(true)}>View config file</Btn><Btn kind="primary" onClick={() => setEdit(blank())}>Add a KRI</Btn></div>
      </header>

      {/* KRI Metrics Summary Cards */}
      <div className="stats" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="stat-n">{totalTransactions.toLocaleString()}</div>
          <div className="stat-l">Total Transactions Monitored (100% population)</div>
        </div>
        <div className="stat">
          <div className="stat-n" style={{ color: Number(exceptionRate) > 0.5 ? 'var(--bad)' : 'var(--ink)' }}>
            {exceptionRate}%
          </div>
          <div className="stat-l">Exception Rate ({totalExceptions} flagged anomalies)</div>
        </div>
        <div className="stat">
          <div className="stat-n" style={{ color: '#F97316' }}>
            {fmtMoney(totalMismatchDollar, 'EUR')}
          </div>
          <div className="stat-l">Total Mismatch Exposure ($ / € Flagged)</div>
        </div>
        <div className="stat">
          <div className="stat-n" style={{ color: 'var(--accent)' }}>
            {activeKris}<span className="stat-of">/{kris.length}</span>
          </div>
          <div className="stat-l">Continuous KRIs Active</div>
        </div>
      </div>

      <div className="filters">
        {[['all', 'All'], ['O2C', 'O2C'], ['S2P', 'S2P'], ['active', 'Active'], ['paused', 'Paused'], ['draft', 'In assessment']].map(([v, l]) => (
          <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      <table className="tbl">
        <thead><tr><th>KRI</th><th>Risk</th><th>Sources</th><th>Runs</th><th>Next run</th><th>Status</th><th /></tr></thead>
        <tbody>
          {shown.map((k) => {
            const nr = nextRunFor(k); return (
              <tr key={k.id}>
                <td><strong>{k.id}</strong><div>{k.name}</div><div className="muted small">{k.area} · {k.kind} · reviewer {k.reviewer}</div></td>
                <td className="wrap">{k.risk}{k.note && <div className="note">{k.note}</div>}</td>
                <td><div className="srcs">{k.sources.map((s) => <SourceChip key={s} id={s} />)}</div></td>
                <td>{FREQ[k.frequency]}<div className="muted small">{k.sampling}% of population{k.alignToClose ? ` · +${k.fetchOffsetDays}d after close` : ''}</div></td>
                <td className="nowrap">{nr ? fmtDate(nr) : <span className="muted">—</span>}<div className="muted small">{k.lastRun ? `last ${fmtDate(k.lastRun)}` : 'never run'}</div></td>
                <td><Tag tone={statusTone(k.status)}>{statusLabel(k.status)}</Tag></td>
                <td className="row-actions">
                  <Btn kind="link" onClick={() => setEdit({ ...k, steps: [...k.steps], thresholds: k.thresholds.map((t) => ({ ...t })), sources: [...k.sources] })}>Configure</Btn>
                  {k.status === 'active' && <Btn kind="link" onClick={() => setRunReq({ kriId: k.id })}>Run now</Btn>}
                  {k.status === 'active' ? <Btn kind="link" onClick={() => setStatus(k.id, 'paused')}>Pause</Btn> : k.status === 'paused' ? <Btn kind="link" onClick={() => setStatus(k.id, 'active')}>Resume</Btn> : null}
                  {k.status === 'active' && <Btn kind="link" onClick={() => setStatus(k.id, 'handed')}>Hand to business</Btn>}
                  <Btn kind="link" onClick={() => handleDelete(k.id)} style={{ color: 'var(--bad)' }}>Delete</Btn>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {edit && <KriEditor kri={edit} onCancel={() => setEdit(null)} onSave={upsert} onDelete={handleDelete} />}
      {showJson && (
        <Drawer title="Configuration file (read-only view)" onClose={() => setShowJson(false)} wide>
          <p className="muted">This is what the agent reads. Business users edit it through the form; nothing is specific to a single KRI in code.</p>
          <pre className="code">{JSON.stringify(kris.map(({ lastRun, note, ...k }) => k), null, 2)}</pre>
        </Drawer>
      )}
    </section>
  );
}

export function StepBuilder({ steps, onChange }) {
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const STEP_TEMPLATES = [
    { label: '+ Extract Population', text: 'Extract all records for the period from the source systems (full population, 100% sampling).' },
    { label: '+ Multi-Way Reconcile', text: 'Match each record against downstream systems on reference ID, amount, and date.' },
    { label: '+ Variance Tolerance', text: 'Flag records where the difference exceeds the configured tolerance threshold.' },
    { label: '+ Cut-off & Timing', text: 'Flag transactions where the booking date falls after the period close date.' },
    { label: '+ Unexplained Classification', text: 'Classify each exception as explainable or unexplained and hand over with evidence.' },
  ];

  const updateStep = (i, val) => {
    const next = [...steps];
    next[i] = val;
    onChange(next);
  };

  const removeStep = (i) => {
    onChange(steps.filter((_, idx) => idx !== i));
  };

  const addStep = (text = '') => {
    onChange([...steps, text]);
  };

  const moveStep = (from, to) => {
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const handleDragStart = (e, index) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === dropIndex) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }
    moveStep(draggedIdx, dropIndex);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="step-builder">
      <div className="step-templates">
        <span className="step-templates-title">Quick-add natural language audit templates:</span>
        <div className="step-template-chips">
          {STEP_TEMPLATES.map((tmpl, idx) => (
            <button
              key={idx}
              type="button"
              className="step-template-btn"
              onClick={() => addStep(tmpl.text)}
              title="Click to insert pre-built test step"
            >
              {tmpl.label}
            </button>
          ))}
        </div>
      </div>

      <div className="step-list">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className={`step-card ${draggedIdx === idx ? 'is-dragging' : ''} ${dragOverIdx === idx ? 'drag-over' : ''}`}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
          >
            <div className="step-card-header">
              <div className="step-drag-handle" title="Drag to reorder step">
                <span className="drag-icon">⠿</span>
                <span className="step-badge">Step {idx + 1}</span>
              </div>
              <div className="step-card-actions">
                <button
                  type="button"
                  className="step-icon-btn"
                  disabled={idx === 0}
                  onClick={() => moveStep(idx, idx - 1)}
                  title="Move step up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="step-icon-btn"
                  disabled={idx === steps.length - 1}
                  onClick={() => moveStep(idx, idx + 1)}
                  title="Move step down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="step-icon-btn step-remove-btn"
                  onClick={() => removeStep(idx)}
                  title="Delete step"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="step-card-body">
              <textarea
                rows={2}
                value={step}
                onChange={(e) => updateStep(idx, e.target.value)}
                placeholder="Enter audit testing instructions for the agent..."
              />
            </div>
          </div>
        ))}
      </div>

      <div className="step-builder-footer">
        <Btn kind="default" onClick={() => addStep('')}>
          ＋ Add Step
        </Btn>
      </div>
    </div>
  );
}

export function KriEditor({ kri, onCancel, onSave, onDelete }) {
  const [k, setK] = useState(kri);
  const set = (patch) => setK((x) => ({ ...x, ...patch }));
  const setThr = (i, v) => set({ thresholds: k.thresholds.map((t, j) => (j === i ? { ...t, value: v } : t)) });
  const toggleSrc = (id) => set({ sources: k.sources.includes(id) ? k.sources.filter((s) => s !== id) : [...k.sources, id] });
  const valid = k.name.trim() && k.steps.filter((s) => s.trim()).length >= 1;

  return (
    <Drawer title={kri.name ? `Configure ${kri.id}` : 'Add a KRI'} onClose={onCancel} wide>
      <div className="grid2">
        <Field label="Identifier"><input value={k.id} onChange={(e) => set({ id: e.target.value })} /></Field>
        <Field label="Name"><input value={k.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. OI reversals vs revenue linkage" /></Field>
        <Field label="Process area"><select value={k.area} onChange={(e) => set({ area: e.target.value })}>{['O2C', 'S2P', 'R2R', 'H2R'].map((a) => <option key={a}>{a}</option>)}</select></Field>
        <Field label="Indicator type"><select value={k.kind} onChange={(e) => set({ kind: e.target.value })}>{['Leading', 'Lagging', 'Assurance'].map((a) => <option key={a}>{a}</option>)}</select></Field>
      </div>
      <Field label="Risk this KRI watches" hint="Anchor on the risk, not the process."><textarea rows="2" value={k.risk} onChange={(e) => set({ risk: e.target.value })} /></Field>
      <Field label="End goal (stays constant across regions and business groups)"><textarea rows="2" value={k.objective} onChange={(e) => set({ objective: e.target.value })} /></Field>

      <h3>Data sources</h3>
      <div className="src-pick">
        {SOURCES.map((s) => (
          <label key={s.id} className={`src-opt${k.sources.includes(s.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={k.sources.includes(s.id)} onChange={() => toggleSrc(s.id)} /> <strong>{s.name}</strong><span className="muted small">{s.kind}</span>
          </label>
        ))}
      </div>

      <h3>Test steps <span className="muted small">— the natural language instructions the agent follows, in order</span></h3>
      <StepBuilder steps={k.steps} onChange={(steps) => set({ steps })} />

      <h3>Thresholds</h3>
      <div className="grid2">
        {k.thresholds.map((t, i) => (
          <Field key={t.key} label={t.label}><div className="unit-in"><input type="number" value={t.value} onChange={(e) => setThr(i, Number(e.target.value))} /><span>{t.unit}</span></div></Field>
        ))}
      </div>

      <h3>Schedule</h3>
      <div className="grid2">
        <Field label="Run"><select value={k.frequency} onChange={(e) => set({ frequency: e.target.value })}>{Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        {k.frequency === 'custom' ? (
          <Field label="Date"><input type="date" value={k.customDate || ''} onChange={(e) => set({ customDate: e.target.value })} /></Field>
        ) : (
          <Field label="Fetch data" hint="Days after the close date in the financial calendar."><div className="unit-in"><input type="number" min="0" value={k.fetchOffsetDays} onChange={(e) => set({ fetchOffsetDays: Number(e.target.value) })} /><span>days after close</span></div></Field>
        )}
        <Field label="Population"><div className="unit-in"><input type="number" min="1" max="100" value={k.sampling} onChange={(e) => set({ sampling: Number(e.target.value) })} /><span>% of items</span></div></Field>
        <Field label="Align to close calendar"><select value={k.alignToClose ? 'yes' : 'no'} onChange={(e) => set({ alignToClose: e.target.value === 'yes' })}><option value="yes">Yes – follow the {CLOSE_CALENDAR.pattern} calendar</option><option value="no">No – calendar months</option></select></Field>
      </div>

      <h3>Review</h3>
      <div className="grid2">
        <Field label="Reviewer"><select value={k.reviewer} onChange={(e) => set({ reviewer: e.target.value })}>{['Audit Manager', 'Senior Auditor', 'Audit Director'].map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Human review of"><select value={k.hitl} onChange={(e) => set({ hitl: e.target.value })}><option value="exceptions">Exceptions only – clean items auto-close</option><option value="all">Every tested item</option></select></Field>
        <Field label="Status"><select value={k.status} onChange={(e) => set({ status: e.target.value })}>{['active', 'paused', 'draft', 'handed'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></Field>
      </div>
      <div className="drawer-foot" style={{ justifyContent: 'space-between' }}>
        {onDelete && kri.name ? (
          <Btn kind="danger" onClick={() => onDelete(k.id)}>Delete KRI</Btn>
        ) : <span />}
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn kind="primary" disabled={!valid} onClick={() => onSave({ ...k, steps: k.steps.filter((s) => s.trim()) })}>Save KRI</Btn>
        </div>
      </div>
    </Drawer>
  );
}

