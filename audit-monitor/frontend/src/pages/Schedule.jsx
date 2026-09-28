import React, { useState, useEffect, useRef } from 'react';
import { fmtDate, fmtMoney, addDays, TODAY, CLOSE_CALENDAR, STAGES, srcName, nextRunFor, periodLabelFor } from '../constants.js';
import { Btn, Tag, Field, Modal } from '../ui.jsx';

export function Schedule({ kris, runs = [], excs = [], setRunReq, kriById, setView, setFocusExc, completeRun }) {
  const [searchRun, setSearchRun] = useState('');
  const [filterKri, setFilterKri] = useState('all');
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [selectedLaunchKri, setSelectedLaunchKri] = useState(kris[0]?.id || 'OI-02');

  const active = kris.filter((k) => k.status === 'active');
  const upcoming = active.map((k) => ({ k, d: nextRunFor(k) })).filter((x) => x.d).sort((a, b) => a.d - b.d);

  // Metrics summary
  const totalTransactions = runs.reduce((acc, r) => acc + (r.tested || 0), 0);
  const totalExceptions = runs.reduce((acc, r) => acc + (r.exceptions || 0), 0) || excs.length;
  const exceptionRate = totalTransactions > 0 ? ((totalExceptions / totalTransactions) * 100).toFixed(2) : '0.00';
  const totalMismatchDollar = excs.reduce((acc, e) => acc + (e.amount || 0), 0);

  // Filtered runs
  const filteredRuns = runs.filter((r) => {
    const matchKri = filterKri === 'all' || r.kriId === filterKri;
    const matchSearch = !searchRun.trim() || [
      r.id, r.kriId, r.period, r.trigger, r.status
    ].some((v) => String(v || '').toLowerCase().includes(searchRun.toLowerCase().trim()));
    return matchKri && matchSearch;
  });

  return (
    <section>
      <header className="page-head row">
        <div>
          <h1>Schedule & Run Execution Dashboard</h1>
          <p className="lede">
            Execute continuous autonomous audit pipelines on the {CLOSE_CALENDAR.pattern} close schedule, or launch on-demand audit runs with custom date range windows and real-time execution tracking.
          </p>
        </div>
        <div className="actions">
          <Btn kind="primary" onClick={() => setShowLaunchModal(true)}>
            🚀 Launch On-Demand Run
          </Btn>
        </div>
      </header>

      {/* KRI Metrics Summary Cards */}
      <div className="stats" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="stat-n">{totalTransactions.toLocaleString()}</div>
          <div className="stat-l">Total Population Tested ({runs.length} runs)</div>
        </div>
        <div className="stat">
          <div className="stat-n" style={{ color: Number(exceptionRate) > 0.5 ? 'var(--bad)' : 'var(--ink)' }}>
            {exceptionRate}%
          </div>
          <div className="stat-l">Overall Exception Rate ({totalExceptions} anomalies)</div>
        </div>
        <div className="stat">
          <div className="stat-n" style={{ color: '#F97316' }}>
            {fmtMoney(totalMismatchDollar, 'EUR')}
          </div>
          <div className="stat-l">Total Flagged Mismatch Value</div>
        </div>
        <div className="stat">
          <div className="stat-n" style={{ color: 'var(--accent)' }}>
            {runs.length}
          </div>
          <div className="stat-l">Audit Execution Cycles Complete</div>
        </div>
      </div>

      <div className="cols">
        <div className="col">
          <h3>Close calendar & trigger rules</h3>
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Period</th>
                <th>Close date</th>
                <th>Triggered KRIs</th>
              </tr>
            </thead>
            <tbody>
              {CLOSE_CALENDAR.periods.filter((p) => new Date(p.close) >= addDays(TODAY, -20)).map((p) => {
                const trig = active.filter((k) => k.frequency === 'monthly' || (k.frequency === 'quarterly' && p.quarterEnd));
                return (
                  <tr key={p.p}>
                    <td>
                      <strong>{p.p}</strong> {p.label}
                      {p.quarterEnd && <Tag tone="info" style={{ marginLeft: 6 }}>{p.q} end</Tag>}
                    </td>
                    <td>{fmtDate(p.close)}</td>
                    <td className="wrap">
                      {trig.map((k) => `${k.id} (+${k.fetchOffsetDays}d)`).join(', ') || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="col">
          <h3>Upcoming automated runs</h3>
          <ul className="list">
            {upcoming.map(({ k, d }) => (
              <li key={k.id} className="list-row">
                <div>
                  <strong>{k.id}</strong> · {k.name}
                  <div className="muted small">{periodLabelFor(k)} · reviewer: {k.reviewer}</div>
                </div>
                <div className="right">
                  <div>{fmtDate(d)}</div>
                  <Btn kind="link" onClick={() => { setSelectedLaunchKri(k.id); setShowLaunchModal(true); }}>
                    Run now
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Audit Run Execution History</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Search run ID, period, trigger..."
            value={searchRun}
            onChange={(e) => setSearchRun(e.target.value)}
            style={{ padding: '5px 10px', fontSize: '12.5px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)' }}
          />
          <select
            value={filterKri}
            onChange={(e) => setFilterKri(e.target.value)}
            style={{ padding: '5px 8px', fontSize: '12.5px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)' }}
          >
            <option value="all">All KRIs</option>
            {kris.map((k) => <option key={k.id} value={k.id}>{k.id}</option>)}
          </select>
        </div>
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th>Run ID</th>
            <th>KRI</th>
            <th>Period & Date Range</th>
            <th>Trigger</th>
            <th>Started</th>
            <th>Population Tested</th>
            <th>Exceptions & Findings</th>
            <th style={{ textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredRuns.map((r) => {
            const k = kriById(r.kriId);
            return (
              <tr key={r.id}>
                <td>
                  <strong>{r.id}</strong>
                  <div className="muted small">{r.duration}</div>
                </td>
                <td>
                  <strong>{r.kriId}</strong>
                  <div className="muted small">{k ? k.name : ''}</div>
                </td>
                <td>
                  <Tag tone="neutral">{r.period}</Tag>
                </td>
                <td>{r.trigger}</td>
                <td>{fmtDate(r.startedAt)}</td>
                <td>
                  <strong>{r.tested.toLocaleString()}</strong>{' '}
                  <span className="muted">of {r.population.toLocaleString()} (100%)</span>
                </td>
                <td>
                  {r.exceptions === 0 ? (
                    <Tag tone="ok">✓ 0 exceptions</Tag>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Tag tone="bad">{r.unexplained} unexplained</Tag>
                      <Tag tone="ok">{r.explainable} explainable</Tag>
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {r.exceptions > 0 && (
                    <Btn kind="link" onClick={() => { setFocusExc(null); setView('exceptions'); }}>
                      Inspect exceptions →
                    </Btn>
                  )}
                </td>
              </tr>
            );
          })}
          {!filteredRuns.length && (
            <tr>
              <td colSpan="8" style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--muted)' }}>
                No run execution records match the current filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Launch On-Demand Audit Run Modal */}
      {showLaunchModal && (
        <RunModal
          kri={kriById(selectedLaunchKri) || kris[0]}
          kris={kris}
          onClose={() => setShowLaunchModal(false)}
          onDone={(kri, opts) => {
            setShowLaunchModal(false);
            if (completeRun) {
              completeRun(kri, opts);
            }
          }}
        />
      )}
    </section>
  );
}

/**
 * Audit Run Execution Modal with Date Pickers, Presets, and Real-Time Stage Progress
 */
export function RunModal({ kri, kris = [], onClose, onDone }) {
  const [selectedKriId, setSelectedKriId] = useState(kri?.id || 'OI-02');
  const activeKri = (kris.find((k) => k.id === selectedKriId)) || kri;

  const [datePreset, setDatePreset] = useState('P9');
  const [startDate, setStartDate] = useState('2026-09-01');
  const [endDate, setEndDate] = useState('2026-09-16');

  const [opts, setOpts] = useState({
    period: 'P9 · Sep 2026 (to date)',
    region: 'All regions',
    bg: 'BG-A + BG-B',
    sampling: activeKri?.sampling || 100
  });

  const [stage, setStage] = useState(-1);
  const [progressPct, setProgressPct] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState({ tested: 0, exceptions: 0, speed: 0 });
  const [logs, setLogs] = useState([]);

  const running = stage >= 0;
  const timer = useRef(null);
  const elapsedTimer = useRef(null);
  const terminalRef = useRef(null);

  const applyPreset = (preset) => {
    setDatePreset(preset);
    if (preset === 'P9') {
      setStartDate('2026-09-01');
      setEndDate('2026-09-16');
      setOpts((prev) => ({ ...prev, period: 'P9 · Sep 2026 (to date)' }));
    } else if (preset === 'P8') {
      setStartDate('2026-08-01');
      setEndDate('2026-08-31');
      setOpts((prev) => ({ ...prev, period: 'P8 · Aug 2026' }));
    } else if (preset === 'Q3') {
      setStartDate('2026-07-01');
      setEndDate('2026-09-30');
      setOpts((prev) => ({ ...prev, period: 'Q3 FY26 (to date)' }));
    } else if (preset === 'custom') {
      setOpts((prev) => ({ ...prev, period: `Custom: ${startDate} → ${endDate}` }));
    }
  };

  const addLog = (level, msg) => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    setLogs((prev) => [...prev, { ts, level, msg }]);
  };

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const start = () => {
    setStage(0);
    setProgressPct(5);
    setElapsedSecs(0);
    setLogs([]);
    setLiveMetrics({ tested: 0, exceptions: 0, speed: 0 });

    addLog('info', `Starting autonomous audit execution pipeline for ${activeKri.id} (${activeKri.name})...`);
    addLog('info', `Audit Date Range: ${startDate} to ${endDate} | Sampling: ${opts.sampling}% | Scope: ${opts.region} / ${opts.bg}`);

    // Elapsed timer
    elapsedTimer.current = setInterval(() => {
      setElapsedSecs((s) => s + 1);
    }, 1000);

    let currentStage = 0;
    const totalStages = STAGES.length;

    timer.current = setInterval(() => {
      currentStage += 1;
      setStage(currentStage);
      const pct = Math.min(100, Math.round((currentStage / totalStages) * 100));
      setProgressPct(pct);

      if (currentStage === 1) {
        addLog('info', `[SAP RFC] Connecting to SAP ECC gateway. Service account authenticated.`);
        setLiveMetrics({ tested: 380, exceptions: 0, speed: 280 });
      } else if (currentStage === 2) {
        addLog('info', `[OBS DB] Ingesting Order Intake records from Order Booking System... Extracted 1,420 entries.`);
        setLiveMetrics({ tested: 1420, exceptions: 1, speed: 420 });
      } else if (currentStage === 3) {
        addLog('info', `Executing configured KRI test steps & automated reconciliation rules...`);
        addLog('warn', `[Threshold Trigger] De-booking detected without matching revenue journal adjustment.`);
        setLiveMetrics({ tested: 1420, exceptions: 3, speed: 380 });
      } else if (currentStage === 4) {
        addLog('info', `Cross-referencing Project Master and Management Reporting view...`);
        setLiveMetrics({ tested: 1420, exceptions: 4, speed: 355 });
      } else if (currentStage === 5) {
        addLog('info', `Generating plain-English root-cause reasoning hypotheses and confidence ratings...`);
      } else if (currentStage >= totalStages) {
        addLog('ok', `✓ Audit execution complete. Cryptographic SHA-256 seal computed and tamper-proof trail recorded.`);
        clearInterval(timer.current);
        clearInterval(elapsedTimer.current);
        setTimeout(() => {
          onDone(activeKri, { ...opts, startDate, endDate });
        }, 800);
      }
    }, 750);
  };

  useEffect(() => {
    return () => {
      clearInterval(timer.current);
      clearInterval(elapsedTimer.current);
    };
  }, []);

  const formatElapsed = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <Modal title={running ? `Audit Execution in Progress — ${activeKri.id}` : `Launch Audit Run — ${activeKri.id}`} onClose={running ? undefined : onClose} wide>
      {!running ? (
        <div>
          {/* KRI Selector if multiple */}
          {kris.length > 1 && (
            <Field label="Select KRI to Execute">
              <select value={selectedKriId} onChange={(e) => setSelectedKriId(e.target.value)}>
                {kris.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.id} — {k.name} ({k.area})
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Date Picker Presets */}
          <div style={{ marginBottom: 6 }}>
            <span className="field-label">Audit Period & Date Range Selection</span>
            <div className="date-presets-row">
              {[
                ['P9', 'P9: Sep 2026 (Month-to-Date)'],
                ['P8', 'P8: Aug 2026 (Prior Close)'],
                ['Q3', 'Q3 FY26 (Quarter-to-Date)'],
                ['custom', 'Custom Date Window']
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`preset-btn ${datePreset === key ? 'on' : ''}`}
                  onClick={() => applyPreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date Pickers */}
          <div className="date-range-grid">
            <Field label="Start Date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDatePreset('custom');
                }}
              />
            </Field>
            <Field label="End Date">
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDatePreset('custom');
                }}
              />
            </Field>
          </div>

          {/* Scope Parameters */}
          <div className="grid2">
            <Field label="Region Scope">
              <select value={opts.region} onChange={(e) => setOpts({ ...opts, region: e.target.value })}>
                {['All regions', 'MEA', 'Europe', 'APAC', 'Americas'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Business Group">
              <select value={opts.bg} onChange={(e) => setOpts({ ...opts, bg: e.target.value })}>
                {['BG-A + BG-B', 'BG-A', 'BG-B'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Population Sampling Rate" hint="Audit standards mandate 100% full-population testing for continuous automated KRIs.">
            <div className="unit-in">
              <input
                type="number"
                min="1"
                max="100"
                value={opts.sampling}
                onChange={(e) => setOpts({ ...opts, sampling: Number(e.target.value) })}
              />
              <span>%</span>
            </div>
          </Field>

          <div className="drawer-foot">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" onClick={start}>
              🚀 Execute Audit Run
            </Btn>
          </div>
        </div>
      ) : (
        /* Real-Time Execution Dashboard */
        <div className="live-progress-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="live-pulse" />
              <strong style={{ fontSize: '14.5px' }}>Executing Audit Pipeline: {activeKri.id}</strong>
            </div>
            <Tag tone="warn">Stage {Math.min(stage + 1, STAGES.length)} of {STAGES.length}</Tag>
          </div>

          {/* Animated Progress Bar */}
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>

          {/* Real-Time Live Metrics Counter Strip */}
          <div className="live-metrics-strip">
            <div className="live-metric-item">
              <dt>Elapsed Time</dt>
              <dd>{formatElapsed(elapsedSecs)}</dd>
            </div>
            <div className="live-metric-item">
              <dt>Population Tested</dt>
              <dd>{liveMetrics.tested.toLocaleString()}</dd>
            </div>
            <div className="live-metric-item">
              <dt>Exceptions Found</dt>
              <dd style={{ color: liveMetrics.exceptions > 0 ? 'var(--bad)' : 'var(--ok)' }}>
                {liveMetrics.exceptions}
              </dd>
            </div>
            <div className="live-metric-item">
              <dt>Ingestion Speed</dt>
              <dd>{liveMetrics.speed} rec/s</dd>
            </div>
          </div>

          {/* Stage Stepper */}
          <ol className="progress" style={{ margin: '14px 0' }}>
            {STAGES.map(([label, src], i) => (
              <li key={i} className={i < stage ? 'done' : i === stage ? 'now' : ''}>
                <span className="dot" />
                {label}
                {src && i <= stage && <span className="muted small"> · {srcName(src)}</span>}
              </li>
            ))}
          </ol>

          {/* Streaming Agentic Execution Log Console */}
          <div className="agent-terminal">
            <div className="terminal-head">
              <div className="terminal-dots">
                <span className="terminal-dot red" />
                <span className="terminal-dot yellow" />
                <span className="terminal-dot green" />
              </div>
              <span>agent-worker-01@audit-monitor:~ (Live Trace)</span>
              <span style={{ fontSize: '10.5px' }}>TLS 1.3 / SHA-256</span>
            </div>
            <div className="terminal-body" ref={terminalRef}>
              {logs.map((log, idx) => (
                <div key={idx} className="log-line">
                  <span className="log-ts">[{log.ts}]</span>
                  <span className={`log-${log.level}`}>[{log.level.toUpperCase()}]</span>
                  <span className="log-msg">{log.msg}</span>
                </div>
              ))}
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                <span className="live-pulse" style={{ width: 5, height: 5 }} />
                Listening to audit agent event stream...
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
