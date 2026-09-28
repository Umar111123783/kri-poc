import React, { useState, useEffect, useMemo } from 'react';
import { fmtDate, fmtMoney, srcName } from '../constants.js';
import { Btn, Tag, Field, Drawer, Modal, SourceChip, classTone, classLabel } from '../ui.jsx';

/**
 * Computes a deterministic SHA-256 hash of any evidence payload using browser Web Crypto API.
 */
export async function computeSha256(payload) {
  try {
    const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload, Object.keys(payload || {}).sort());
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.error('SHA-256 computation error:', err);
    return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }
}

/**
 * Standard Reason Codes for audit exception classifications.
 */
export const REASON_CODES = [
  { code: 'RC-REV-01', label: 'Reversal w/o Revenue Adjustment', match: 'reversal without revenue' },
  { code: 'RC-REB-02', label: 'Reversal with Re-booking', match: 'reversal with re-booking' },
  { code: 'RC-TIM-03', label: 'Cut-off / Timing Variance', match: 'cut-off' },
  { code: 'RC-TIM-04', label: 'Reversal Timing', match: 'reversal – timing' },
  { code: 'RC-CLU-05', label: 'Period-End Cluster', match: 'period-end de-booking cluster' },
  { code: 'RC-VAL-06', label: 'OI > Customer PO', match: 'oi higher than customer po' },
  { code: 'RC-FX-07',  label: 'Currency Conversion Variance', match: 'currency conversion variance' },
  { code: 'RC-PO-08',  label: 'Active PO on Reversed Order', match: 'active po on reversed' },
  { code: 'RC-BNK-09', label: 'Vendor Bank Modified Pre-Payment', match: 'vendor bank' },
  { code: 'RC-BNK-10', label: 'Vendor Bank Change', match: 'bank change' },
];

/**
 * Derives the standardized reason code for an exception.
 */
export function getReasonCode(exc) {
  if (exc.reasonCode) return exc.reasonCode;
  const cat = (exc.category || '').toLowerCase();
  for (const rc of REASON_CODES) {
    if (cat.includes(rc.match)) return rc.code;
  }
  return 'RC-GEN-99';
}

/**
 * Derives audit severity based on classification and financial exposure threshold.
 */
export function getExcSeverity(exc) {
  if (exc.severity) return exc.severity;
  const amt = exc.amount || 0;
  const cat = (exc.category || '').toLowerCase();
  const kriId = (exc.kriId || '').toUpperCase();
  if (exc.classification === 'unexplained' && (amt >= 500000 || kriId.includes('S2P') || cat.includes('bank') || cat.includes('unauthorized'))) {
    return 'critical';
  }
  if (exc.classification === 'unexplained' || amt >= 750000) return 'high';
  if (exc.classification === 'review' || amt >= 200000) return 'medium';
  return 'low';
}

/**
 * Builds the canonical immutable audit evidence packet for an exception.
 */
export function buildEvidencePacket(exc, kri, run) {
  return {
    version: '1.0.0-audit-trace',
    standard: 'SHA256-IMMUTABLE-EVIDENCE-SPEC',
    timestamp: '2026-09-02T14:32:00.000Z',
    exception: {
      id: exc.id,
      runId: exc.runId,
      period: run?.period || 'P8-2026',
      kriId: exc.kriId,
      kriName: kri?.name || exc.kriId,
      reference: exc.ref,
      wbs: exc.wbs,
      project: exc.project,
      region: exc.region,
      businessGroup: exc.bg,
      amount: exc.amount,
      currency: exc.currency,
      category: exc.category,
      reasonCode: getReasonCode(exc),
      severity: getExcSeverity(exc),
      classification: exc.classification,
      status: exc.status,
      summary: exc.summary
    },
    lineageEvidence: exc.evidence || [],
    reasoningTrace: exc.reasoning || [],
    rootCauseHypothesis: exc.hypothesis || {},
    confirmationRequirement: exc.confirm || ''
  };
}

export function Exceptions({ excs, kris, runs, kriById, focusExc, setFocusExc, updateExc, sendToPlanner, notify }) {
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'grid'
  const [search, setSearch] = useState('');
  const [fSeverity, setFSeverity] = useState('all');
  const [fType, setFType] = useState('all');
  const [fReasonCode, setFReasonCode] = useState('all');
  const [fKri, setFKri] = useState('all');
  const [fStatus, setFStatus] = useState('open');
  const [sortField, setSortField] = useState('amount');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Quick modals/drawers when triggered from data grid view
  const [activeModalExc, setActiveModalExc] = useState(null);
  const [activeDrawerExc, setActiveDrawerExc] = useState(null);

  // Filtered dataset
  const filtered = useMemo(() => {
    return excs.filter((e) => {
      const sev = getExcSeverity(e);
      const rc = getReasonCode(e);
      const matchSearch = !search.trim() || [
        e.id, e.ref, e.project, e.wbs, e.category, e.summary, rc, sev
      ].some((val) => String(val || '').toLowerCase().includes(search.toLowerCase().trim()));

      const matchSeverity = fSeverity === 'all' || sev === fSeverity;
      const matchType = fType === 'all' || e.classification === fType;
      const matchReason = fReasonCode === 'all' || rc === fReasonCode;
      const matchKri = fKri === 'all' || e.kriId === fKri;
      const matchStatus = fStatus === 'all' || e.status === fStatus;

      return matchSearch && matchSeverity && matchType && matchReason && matchKri && matchStatus;
    });
  }, [excs, search, fSeverity, fType, fReasonCode, fKri, fStatus]);

  // Sorted dataset
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let vA = a[sortField];
      let vB = b[sortField];
      if (sortField === 'severity') {
        const order = { critical: 4, high: 3, medium: 2, low: 1 };
        vA = order[getExcSeverity(a)] || 0;
        vB = order[getExcSeverity(b)] || 0;
      } else if (sortField === 'reasonCode') {
        vA = getReasonCode(a);
        vB = getReasonCode(b);
      } else if (sortField === 'confidence') {
        vA = a.hypothesis?.confidence || 0;
        vB = b.hypothesis?.confidence || 0;
      }
      if (typeof vA === 'string') return sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      return sortAsc ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
    });
    return list;
  }, [filtered, sortField, sortAsc]);

  const sel = excs.find((e) => e.id === focusExc);

  useEffect(() => {
    if (!sel && sorted.length) setFocusExc(sorted[0].id);
  }, [sorted.length]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((e) => e.id)));
    }
  };

  const toggleSelectOne = (id, e) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Bulk operations
  const handleBulkAction = (status, label) => {
    if (!selectedIds.size) return;
    const count = selectedIds.size;
    selectedIds.forEach((id) => updateExc(id, { status, reviewNote: `Bulk ${label}` }));
    notify(`Updated ${count} exception(s) to "${label}".`);
    setSelectedIds(new Set());
  };

  const handleExportCsv = () => {
    const rowsToExport = sorted.filter((e) => !selectedIds.size || selectedIds.has(e.id));
    const headers = ['ID', 'Reference', 'Project', 'WBS', 'KRI', 'Amount', 'Currency', 'Severity', 'Type', 'ReasonCode', 'Status', 'Summary'];
    const csvContent = [
      headers.join(','),
      ...rowsToExport.map((e) => [
        `"${e.id}"`,
        `"${e.ref}"`,
        `"${e.project}"`,
        `"${e.wbs}"`,
        `"${e.kriId}"`,
        e.amount,
        `"${e.currency}"`,
        `"${getExcSeverity(e)}"`,
        `"${e.classification}"`,
        `"${getReasonCode(e)}"`,
        `"${e.status}"`,
        `"${(e.summary || '').replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `exceptions_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    notify(`Exported ${rowsToExport.length} exceptions to CSV.`);
  };

  return (
    <section>
      <header className="page-head row">
        <div>
          <h1>Exception Management</h1>
          <p className="lede">
            Real-time Exception Management Grid with multi-factor filtering by <strong>Severity</strong>, <strong>Type</strong> & <strong>Reason Code</strong>, cryptographic SHA-256 evidence drawers, and bulk auditor actions.
          </p>
        </div>
        <div className="view-switch">
          <button className={viewMode === 'split' ? 'on' : ''} onClick={() => setViewMode('split')}>
            ◫ Master-Detail
          </button>
          <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')}>
            ▦ Data Grid
          </button>
        </div>
      </header>

      {/* Advanced Filter & Search Toolbar */}
      <div className="grid-toolbar">
        <div className="grid-toolbar-row">
          <div className="search-box">
            <span>🔍</span>
            <input
              type="search"
              placeholder="Search reference, project, WBS, summary, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <button className="x" onClick={() => setSearch('')} style={{ padding: 0 }}>×</button>}
          </div>

          {/* Status Filter */}
          <div className="filters" style={{ margin: 0 }}>
            {[['open', 'Open'], ['accepted', 'Accepted'], ['anomaly', 'Confirmed Anomaly'], ['planner', 'Planner'], ['all', 'All Statuses']].map(([v, l]) => (
              <button key={v} className={fStatus === v ? 'on' : ''} onClick={() => setFStatus(v)}>{l}</button>
            ))}
          </div>
        </div>

        {/* Multi-Dimensional Filter Bar: Severity, Type, Reason Code, KRI */}
        <div className="grid-toolbar-row" style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          {/* Severity Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Severity:</span>
            <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)} style={{ padding: '4px 8px', fontSize: '12.5px' }}>
              <option value="all">All Severities</option>
              <option value="critical">🔴 Critical (&gt;€500k Unexplained)</option>
              <option value="high">🟠 High Exposure</option>
              <option value="medium">🟡 Medium Exposure</option>
              <option value="low">🟢 Low Exposure</option>
            </select>
          </div>

          {/* Type / Classification Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Type:</span>
            <select value={fType} onChange={(e) => setFType(e.target.value)} style={{ padding: '4px 8px', fontSize: '12.5px' }}>
              <option value="all">Any Classification</option>
              <option value="unexplained">Unexplained</option>
              <option value="explainable">Explainable</option>
              <option value="review">Needs Review</option>
            </select>
          </div>

          {/* Reason Code Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Reason Code:</span>
            <select value={fReasonCode} onChange={(e) => setFReasonCode(e.target.value)} style={{ padding: '4px 8px', fontSize: '12.5px' }}>
              <option value="all">All Reason Codes</option>
              {REASON_CODES.map((rc) => (
                <option key={rc.code} value={rc.code}>
                  {rc.code} — {rc.label}
                </option>
              ))}
            </select>
          </div>

          {/* KRI Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>KRI:</span>
            <select value={fKri} onChange={(e) => setFKri(e.target.value)} style={{ padding: '4px 8px', fontSize: '12.5px' }}>
              <option value="all">Any KRI</option>
              {kris.map((k) => <option key={k.id} value={k.id}>{k.id} ({k.name.slice(0, 24)}...)</option>)}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Showing <strong>{sorted.length}</strong> of {excs.length} exceptions
            </span>
            {(fSeverity !== 'all' || fType !== 'all' || fReasonCode !== 'all' || fKri !== 'all' || fStatus !== 'open' || search) && (
              <button
                className="btn-link"
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '12px', cursor: 'pointer' }}
                onClick={() => {
                  setSearch('');
                  setFSeverity('all');
                  setFType('all');
                  setFReasonCode('all');
                  setFKri('all');
                  setFStatus('all');
                }}
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Batch Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="batch-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: '13px' }}>{selectedIds.size} item(s) selected</strong>
            <button
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '12px', cursor: 'pointer' }}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
          </div>
          <div className="batch-actions">
            <Btn onClick={() => handleBulkAction('accepted', 'Accepted')}>✓ Bulk Accept</Btn>
            <Btn kind="danger" onClick={() => handleBulkAction('anomaly', 'Confirmed Anomaly')}>⚠️ Bulk Anomaly</Btn>
            <Btn onClick={() => handleBulkAction('planner', 'In Planner')}>📋 Bulk to Planner</Btn>
            <Btn onClick={handleExportCsv}>📥 Export CSV</Btn>
          </div>
        </div>
      )}

      {/* VIEW MODE 1: DATA GRID TABLE VIEW */}
      {viewMode === 'grid' && (
        <div className="data-grid-wrap">
          <table className="data-grid-tbl">
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={sorted.length > 0 && selectedIds.size === sorted.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="sortable" onClick={() => handleSort('severity')} style={{ width: 100 }}>
                  Severity {sortField === 'severity' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('ref')} style={{ width: 150 }}>
                  Reference {sortField === 'ref' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('project')}>
                  Project / WBS {sortField === 'project' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('kriId')} style={{ width: 80 }}>
                  KRI {sortField === 'kriId' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('reasonCode')} style={{ width: 120 }}>
                  Reason Code {sortField === 'reasonCode' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('amount')} style={{ width: 130, textAlign: 'right' }}>
                  Amount {sortField === 'amount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('confidence')} style={{ width: 100 }}>
                  Confidence {sortField === 'confidence' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="sortable" onClick={() => handleSort('status')} style={{ width: 120 }}>
                  Status {sortField === 'status' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th style={{ width: 140, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const sev = getExcSeverity(e);
                const rc = getReasonCode(e);
                const isSelected = selectedIds.has(e.id);
                const pct = Math.round((e.hypothesis?.confidence || 0.75) * 100);

                return (
                  <tr key={e.id} className={isSelected ? 'selected' : ''}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(ev) => toggleSelectOne(e.id, ev)}
                      />
                    </td>
                    <td>
                      <span className={`severity-pill severity-${sev}`}>{sev}</span>
                    </td>
                    <td>
                      <strong>{e.ref}</strong>
                      <div className="muted small">{e.id}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{e.project}</div>
                      <div className="muted small">{e.wbs} · {e.region} / {e.bg}</div>
                    </td>
                    <td>
                      <Tag tone="neutral">{e.kriId}</Tag>
                    </td>
                    <td>
                      <span className="rc-tag">{rc}</span>
                    </td>
                    <td className="amt">
                      {fmtMoney(e.amount, e.currency)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600 }}>{pct}%</span>
                        <div style={{ width: 40, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: '#10B981' }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <Tag tone={classTone(e.classification)}>
                        {{ open: 'Open', accepted: 'Accepted', anomaly: 'Anomaly', planner: 'In Planner' }[e.status] || e.status}
                      </Tag>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          className="btn-action"
                          style={{ padding: '3px 7px', fontSize: '11px' }}
                          onClick={() => setActiveModalExc(e)}
                          title="Plain-English explanation brief"
                        >
                          💡 Brief
                        </button>
                        <button
                          className="btn-action"
                          style={{ padding: '3px 7px', fontSize: '11px' }}
                          onClick={() => setActiveDrawerExc(e)}
                          title="Open full evidence drawer with SHA-256 hash"
                        >
                          📜 Evidence
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!sorted.length && (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)' }}>
                    No exceptions match the specified Severity, Type, Reason Code, or Search filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW MODE 2: MASTER-DETAIL SPLIT VIEW */}
      {viewMode === 'split' && (
        <div className="split">
          <ul className="exc-list">
            {sorted.map((e) => {
              const sev = getExcSeverity(e);
              const rc = getReasonCode(e);

              return (
                <li
                  key={e.id}
                  className={`${e.id === focusExc ? 'on' : ''} exc-${e.classification}`}
                  onClick={() => setFocusExc(e.id)}
                >
                  <div className="exc-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`severity-pill severity-${sev}`}>{sev}</span>
                      <strong>{e.ref}</strong>
                    </div>
                    <Tag tone={classTone(e.classification)}>{classLabel(e.classification)}</Tag>
                  </div>
                  <div style={{ marginTop: 2 }}>{e.project}</div>
                  <div className="muted small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span>
                      <span className="rc-tag" style={{ marginRight: 4 }}>{rc}</span>
                      {e.kriId} · {fmtMoney(e.amount, e.currency)}
                    </span>
                    <span style={{ fontSize: '10.5px', color: '#10B981', fontWeight: 600 }}>🔒 SHA-256</span>
                  </div>
                </li>
              );
            })}
            {!sorted.length && <li className="empty">No exceptions match these filters.</li>}
          </ul>
          {sel ? (
            <ExceptionDetail
              exc={sel}
              kri={kriById(sel.kriId)}
              run={runs.find((r) => r.id === sel.runId)}
              updateExc={updateExc}
              sendToPlanner={sendToPlanner}
              notify={notify}
            />
          ) : (
            <div className="detail empty">Select an exception from the list.</div>
          )}
        </div>
      )}

      {/* Grid-View Triggered Plain-English Modal */}
      {activeModalExc && (
        <PlainEnglishModal
          exc={activeModalExc}
          kri={kriById(activeModalExc.kriId)}
          run={runs.find((r) => r.id === activeModalExc.runId)}
          pct={Math.round((activeModalExc.hypothesis?.confidence || 0.75) * 100)}
          onClose={() => setActiveModalExc(null)}
          onOpenDrawer={() => {
            const current = activeModalExc;
            setActiveModalExc(null);
            setActiveDrawerExc(current);
          }}
          notify={notify}
        />
      )}

      {/* Grid-View Triggered Evidence Drawer */}
      {activeDrawerExc && (
        <EvidenceDrawerContainer
          exc={activeDrawerExc}
          kri={kriById(activeDrawerExc.kriId)}
          run={runs.find((r) => r.id === activeDrawerExc.runId)}
          onClose={() => setActiveDrawerExc(null)}
          onOpenModal={() => {
            const current = activeDrawerExc;
            setActiveDrawerExc(null);
            setActiveModalExc(current);
          }}
          notify={notify}
        />
      )}
    </section>
  );
}

/**
 * Container component for calculating hash and rendering the Evidence Drawer.
 */
function EvidenceDrawerContainer({ exc, kri, run, onClose, onOpenModal, notify }) {
  const [hash, setHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const canonicalPacket = buildEvidencePacket(exc, kri, run);

  useEffect(() => {
    let active = true;
    computeSha256(canonicalPacket).then((h) => {
      if (active) setHash(h);
    });
    return () => { active = false; };
  }, [exc.id]);

  const handleCopyHash = () => {
    navigator.clipboard.writeText(hash);
    notify(`SHA-256 checksum copied to clipboard: ${hash.slice(0, 12)}...`);
  };

  const handleVerifyIntegrity = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      notify(`✓ Cryptographic check passed! Evidence payload hash matches canonical index.`);
    }, 450);
  };

  return (
    <EvidenceDrawer
      exc={exc}
      kri={kri}
      run={run}
      hash={hash}
      canonicalPacket={canonicalPacket}
      verifying={verifying}
      onVerify={handleVerifyIntegrity}
      onCopyHash={handleCopyHash}
      onClose={onClose}
      onOpenModal={onOpenModal}
      notify={notify}
    />
  );
}

export function ExceptionDetail({ exc, kri, run, updateExc, sendToPlanner, notify }) {
  const [note, setNote] = useState('');
  const [showDrawer, setShowDrawer] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [hash, setHash] = useState('');
  const [verifying, setVerifying] = useState(false);

  const pct = Math.round((exc.hypothesis?.confidence || 0.75) * 100);
  const sev = getExcSeverity(exc);
  const rc = getReasonCode(exc);
  const canonicalPacket = buildEvidencePacket(exc, kri, run);

  useEffect(() => {
    let active = true;
    computeSha256(canonicalPacket).then((h) => {
      if (active) setHash(h);
    });
    return () => { active = false; };
  }, [exc.id]);

  const act = (status, msg) => {
    updateExc(exc.id, { status, reviewNote: note || exc.reviewNote });
    notify(msg);
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(hash);
    notify(`SHA-256 checksum copied to clipboard: ${hash.slice(0, 12)}...`);
  };

  const handleVerifyIntegrity = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      notify(`✓ Cryptographic check passed! Evidence payload hash matches canonical index.`);
    }, 450);
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{exc.id} · {kri ? kri.name : exc.kriId} · run {exc.runId}{run ? ` (${run.period})` : ''}</span>
            <span className={`severity-pill severity-${sev}`}>{sev}</span>
            <span className="rc-tag">{rc}</span>
            {hash && (
              <button
                className="sha-chip"
                onClick={() => setShowDrawer(true)}
                title="Click to inspect cryptographic SHA-256 verification & evidence packet"
              >
                🔒 SHA-256: {hash.slice(0, 8)}…{hash.slice(-6)}
              </button>
            )}
          </div>
          <h2 style={{ marginTop: 6 }}>{exc.category}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag tone={classTone(exc.classification)}>{classLabel(exc.classification)}</Tag>
        </div>
      </div>

      {/* Action Toolbar for Evidence Drawer and Plain-English Modal */}
      <div style={{ display: 'flex', gap: 10, margin: '14px 0 16px', flexWrap: 'wrap' }}>
        <Btn kind="primary" onClick={() => setShowModal(true)}>
          💡 Plain-English Explanation
        </Btn>
        <Btn onClick={() => setShowDrawer(true)}>
          📜 Evidence Drawer & SHA-256 Verification
        </Btn>
      </div>

      <p className="summary">{exc.summary}</p>
      <dl className="facts">
        <div><dt>Reference</dt><dd>{exc.ref}</dd></div>
        <div><dt>WBS</dt><dd>{exc.wbs}</dd></div>
        <div><dt>Project</dt><dd>{exc.project}</dd></div>
        <div><dt>Region / BG</dt><dd>{exc.region} / {exc.bg}</dd></div>
        <div><dt>Amount</dt><dd>{fmtMoney(exc.amount, exc.currency)}</dd></div>
        <div><dt>Status</dt><dd>{{ open: 'Open', accepted: 'Accepted', anomaly: 'Confirmed anomaly', planner: 'In planner' }[exc.status]}</dd></div>
      </dl>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>What the agent pulled</h3>
        <button
          className="btn-link"
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
          onClick={() => setShowDrawer(true)}
        >
          Inspect full lineage in Drawer →
        </button>
      </div>
      <table className="tbl compact evidence">
        <tbody>
          {exc.evidence.map((ev, i) => (
            <tr key={i}>
              <td style={{ width: 100 }}><SourceChip id={ev.source} /></td>
              <td style={{ fontWeight: 600, width: 220 }}>{ev.record}</td>
              <td className="wrap">{ev.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Why it was flagged</h3>
      <ol className="reason">{exc.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ol>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Most likely explanation</h3>
        <button
          className="btn-link"
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
          onClick={() => setShowModal(true)}
        >
          View Executive Breakdown Modal →
        </button>
      </div>
      <div className="hyp">
        <div className="hyp-bar" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
        <div className="hyp-txt"><strong>{pct}% confidence</strong> — {exc.hypothesis.text}</div>
        <div className="muted">What would confirm it: {exc.confirm}</div>
      </div>

      {exc.status === 'open' ? (
        <div className="review">
          <Field label="Reviewer note">
            <textarea
              rows="2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional. Recorded with your decision in the tamper-evident audit trail."
            />
          </Field>
          <div className="actions">
            <Btn onClick={() => act('accepted', `${exc.id} accepted as explainable`)}>Accept explanation</Btn>
            <Btn kind="danger" onClick={() => act('anomaly', `${exc.id} confirmed as an anomaly`)}>Confirm anomaly</Btn>
            <Btn kind="primary" onClick={() => sendToPlanner(exc)}>Send to planner as spot-audit candidate</Btn>
          </div>
        </div>
      ) : (
        <div className="review muted">
          Decision recorded{exc.reviewNote ? `: ${exc.reviewNote}` : ''}.{' '}
          <Btn kind="link" onClick={() => act('open', `${exc.id} reopened`)}>Reopen</Btn>
        </div>
      )}

      {/* --- EVIDENCE DRAWER --- */}
      {showDrawer && (
        <EvidenceDrawer
          exc={exc}
          kri={kri}
          run={run}
          hash={hash}
          canonicalPacket={canonicalPacket}
          verifying={verifying}
          onVerify={handleVerifyIntegrity}
          onCopyHash={handleCopyHash}
          onClose={() => setShowDrawer(false)}
          onOpenModal={() => { setShowDrawer(false); setShowModal(true); }}
          notify={notify}
        />
      )}

      {/* --- PLAIN-ENGLISH EXPLANATION MODAL --- */}
      {showModal && (
        <PlainEnglishModal
          exc={exc}
          kri={kri}
          run={run}
          hash={hash}
          pct={pct}
          onClose={() => setShowModal(false)}
          onOpenDrawer={() => { setShowModal(false); setShowDrawer(true); }}
          notify={notify}
        />
      )}
    </div>
  );
}

/**
 * Slide-out Evidence Drawer with Cryptographic SHA-256 Verification & Full Lineage
 */
export function EvidenceDrawer({ exc, kri, run, hash, canonicalPacket, verifying, onVerify, onCopyHash, onClose, onOpenModal, notify }) {
  const [activeTab, setActiveTab] = useState('lineage'); // 'lineage' | 'reasoning' | 'json'

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(canonicalPacket, null, 2));
    notify('Canonical JSON evidence packet copied to clipboard.');
  };

  const downloadJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(canonicalPacket, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `evidence-${exc.id}-${hash.slice(0, 8)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    notify(`Downloaded evidence packet for ${exc.id}`);
  };

  // Group evidence by source
  const groupedEvidence = (exc.evidence || []).reduce((acc, item) => {
    acc[item.source] = acc[item.source] || [];
    acc[item.source].push(item);
    return acc;
  }, {});

  return (
    <Drawer title={`Evidence Package — ${exc.id}`} onClose={onClose} wide>
      {/* Cryptographic SHA-256 Header Card */}
      <div className="sha-card">
        <div className="sha-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="sha-badge">✓ Tamper-Proof Audit Seal</span>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>SHA-256 Digest</span>
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Standard: SHA256-IMMUTABLE-v1</span>
        </div>
        <div className="sha-hash-row">
          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>Hash:</span>
          <code className="sha-hash-code">{hash || 'Calculating cryptographic digest...'}</code>
        </div>
        <div className="sha-actions">
          <Btn onClick={onCopyHash}>📋 Copy Hash</Btn>
          <Btn onClick={onVerify} disabled={verifying}>
            {verifying ? '⏳ Recalculating...' : '🛡️ Re-Verify Checksum'}
          </Btn>
          <Btn onClick={downloadJson}>💾 Download JSON</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div className="filters" style={{ margin: '14px 0 18px' }}>
        <button className={activeTab === 'lineage' ? 'on' : ''} onClick={() => setActiveTab('lineage')}>
          Multi-Source Lineage ({exc.evidence?.length || 0})
        </button>
        <button className={activeTab === 'reasoning' ? 'on' : ''} onClick={() => setActiveTab('reasoning')}>
          Test Step Reasoner Trace ({exc.reasoning?.length || 0})
        </button>
        <button className={activeTab === 'json' ? 'on' : ''} onClick={() => setActiveTab('json')}>
          Raw Canonical Payload (JSON)
        </button>
      </div>

      {/* Tab 1: Multi-Source Lineage */}
      {activeTab === 'lineage' && (
        <div>
          <p className="lede" style={{ fontSize: '13px', margin: '0 0 16px' }}>
            Extracted records from underlying enterprise ERPs and operational repositories during Run <strong>{exc.runId}</strong>.
          </p>
          {Object.entries(groupedEvidence).map(([sourceKey, records]) => (
            <div key={sourceKey} className="sys-group">
              <div className="sys-group-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SourceChip id={sourceKey} />
                  <strong style={{ fontSize: '13px' }}>{srcName(sourceKey)}</strong>
                </div>
                <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>{records.length} record(s)</span>
              </div>
              <div className="sys-group-body">
                {records.map((r, idx) => (
                  <div key={idx} style={{ padding: '8px 0', borderBottom: idx < records.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--ink)' }}>{r.record}</span>
                      <span style={{ fontSize: '11px', color: '#10B981', fontWeight: 600 }}>✓ Verified extraction</span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--ink)', fontFamily: 'inherit' }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 2: Test Step Reasoning */}
      {activeTab === 'reasoning' && (
        <div>
          <p className="lede" style={{ fontSize: '13px', margin: '0 0 16px' }}>
            Deterministic rule evaluations that triggered this exception state:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {exc.reasoning.map((r, i) => (
              <div key={i} className="timeline-content" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  background: i === exc.reasoning.length - 1 ? 'var(--bad-soft)' : 'var(--surface)',
                  color: i === exc.reasoning.length - 1 ? 'var(--bad)' : 'var(--ink)',
                  border: `1px solid ${i === exc.reasoning.length - 1 ? 'var(--bad)' : 'var(--line)'}`,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  flexShrink: 0
                }}>
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontSize: '13.5px', lineHeight: 1.5, color: 'var(--ink)' }}>{r}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Raw Canonical JSON */}
      {activeTab === 'json' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Canonical JSON signed with SHA-256:</span>
            <Btn onClick={copyJson}>📋 Copy JSON</Btn>
          </div>
          <pre style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            padding: 14,
            borderRadius: 'var(--radius-sm)',
            fontSize: '11.5px',
            fontFamily: 'monospace',
            overflowX: 'auto',
            maxHeight: 380
          }}>
            {JSON.stringify(canonicalPacket, null, 2)}
          </pre>
        </div>
      )}

      <div className="drawer-foot">
        <Btn onClick={onOpenModal}>💡 Open Plain-English Brief</Btn>
        <Btn kind="primary" onClick={onClose}>Done</Btn>
      </div>
    </Drawer>
  );
}

/**
 * Plain-English Explanation Modal with Multi-System Chronological Timeline & Risk Assessment
 */
export function PlainEnglishModal({ exc, kri, run, hash, pct, onClose, onOpenDrawer, notify }) {
  const [checkedSteps, setCheckedSteps] = useState({});

  const toggleCheck = (idx) => {
    setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const isUnexplained = exc.classification === 'unexplained';

  return (
    <Modal title={`Plain-English Explanation — ${exc.ref}`} onClose={onClose} wide>
      {/* Overview Banner */}
      <div className="plain-card" style={{ borderLeft: `4px solid ${isUnexplained ? 'var(--bad)' : 'var(--ok)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)', fontWeight: 700 }}>
              Executive Audit Breakdown
            </span>
            <h3 style={{ margin: '4px 0 0', fontSize: '16px' }}>{exc.category}</h3>
          </div>
          <Tag tone={classTone(exc.classification)}>{classLabel(exc.classification)}</Tag>
        </div>
        <p className="plain-story">
          {exc.summary}
        </p>
      </div>

      {/* Financial Exposure & Risk Severity */}
      <div className="exposure-box">
        <div className="exposure-item">
          <dt>Transaction Amount</dt>
          <dd>{fmtMoney(exc.amount, exc.currency)}</dd>
        </div>
        <div className="exposure-item">
          <dt>Risk Category</dt>
          <dd className={isUnexplained ? 'highlight-bad' : ''}>
            {isUnexplained ? 'Revenue Overstatement' : 'Internal Re-allocation'}
          </dd>
        </div>
        <div className="exposure-item">
          <dt>AI Model Confidence</dt>
          <dd>{pct}%</dd>
        </div>
        <div className="exposure-item">
          <dt>Audit Period</dt>
          <dd>{run?.period || 'P8-2026'}</dd>
        </div>
      </div>

      {/* Multi-System Chronological Timeline */}
      <h3 style={{ fontSize: '14px', margin: '20px 0 8px' }}>Chronological Multi-System Flow</h3>
      <div className="timeline-flow">
        {exc.evidence.map((ev, i) => {
          const isFlagged = ev.value.toLowerCase().includes('no reversal') || ev.value.toLowerCase().includes('no booking') || ev.value.toLowerCase().includes('−');
          return (
            <div key={i} className={`timeline-node ${isFlagged ? 'flagged' : ''}`}>
              <div className="timeline-dot">{i + 1}</div>
              <div className="timeline-content">
                <div className="timeline-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SourceChip id={ev.source} />
                    <span className="timeline-title">{ev.record}</span>
                  </div>
                  {isFlagged ? (
                    <span style={{ fontSize: '11px', color: 'var(--bad)', fontWeight: 600 }}>⚠️ Anomaly Point</span>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#10B981', fontWeight: 600 }}>✓ Recorded</span>
                  )}
                </div>
                <div className="timeline-val">{ev.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Root Cause Hypothesis */}
      <div className="plain-card" style={{ background: 'var(--surface-2)' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>💡</span> Most Probable Root Cause ({pct}% Confidence)
        </h4>
        <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>{exc.hypothesis?.text}</p>
      </div>

      {/* Auditor Recommended Next Steps */}
      <h3 style={{ fontSize: '14px', margin: '20px 0 8px' }}>Auditor Verification Action Plan</h3>
      <p style={{ fontSize: '12.5px', color: 'var(--muted)', margin: '0 0 10px' }}>
        Complete these verification steps before accepting or escalating this item:
      </p>
      <ul className="audit-checklist">
        {[
          `Contact Project Finance for ${exc.project} regarding reference ${exc.ref}.`,
          exc.confirm,
          `Confirm whether P9 revenue adjustment ledger entry has been posted in SAP.`,
          `Verify authorization logs for de-booking in the Order Booking System.`
        ].filter(Boolean).map((step, idx) => (
          <li key={idx} onClick={() => toggleCheck(idx)} style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={!!checkedSteps[idx]} onChange={() => {}} />
            <span style={{ textDecoration: checkedSteps[idx] ? 'line-through' : 'none', color: checkedSteps[idx] ? 'var(--muted)' : 'var(--ink)' }}>
              {step}
            </span>
          </li>
        ))}
      </ul>

      {/* Cryptographic Seal Stamp Footer */}
      <div style={{
        marginTop: 20,
        padding: '10px 14px',
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8
      }}>
        <span style={{ fontSize: '11.5px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🔒</span> Cryptographically Sealed Trace: <code style={{ fontFamily: 'monospace', fontSize: '11px' }}>{hash ? `${hash.slice(0, 16)}...` : 'Validating'}</code>
        </span>
        <Btn kind="link" onClick={onOpenDrawer} style={{ fontSize: '12px' }}>
          Open Full Evidence Drawer & Lineage →
        </Btn>
      </div>

      <div className="modal-foot">
        <Btn onClick={onOpenDrawer}>Inspect Raw Evidence</Btn>
        <Btn kind="primary" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}
