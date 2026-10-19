import { useState, useRef, type ChangeEvent } from 'react'
import {
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  ShieldAlert,
  X,
  RefreshCw,
  Database,
} from 'lucide-react'
import type {
  MoneyMateBackup,
  BackupDataScope,
  RestoreMode,
  BackupValidationResult,
  RestoreResult,
} from '../types/backup'
import {
  exportBackup,
  downloadBackupFile,
  restoreBackup,
} from '../services/backupService'
import { validateBackupPayload } from '../utils/backupValidation'

interface BackupModalProps {
  isOpen: boolean
  onClose: () => void
  currentScope: BackupDataScope
  onRestoreComplete: (result: RestoreResult) => Promise<void>
  notify: (msg: string) => void
}

export function BackupModal({
  isOpen,
  onClose,
  currentScope,
  onRestoreComplete,
  notify,
}: BackupModalProps) {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export')
  const [isExporting, setIsExporting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  // Import states
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedBackup, setParsedBackup] = useState<MoneyMateBackup | null>(null)
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null)
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('merge')
  const [replaceConfirmInput, setReplaceConfirmInput] = useState('')
  const [createPreSafetyBackup, setCreatePreSafetyBackup] = useState(true)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  // 1. Export Action
  const handleExport = async () => {
    try {
      setIsExporting(true)
      const backup = await exportBackup({ dataScope: currentScope })
      downloadBackupFile(backup)
      notify(`Downloaded backup (${backup.metadata.recordCounts.transactions} transactions)`)
    } catch (err: any) {
      console.error('Export failed:', err)
      notify(`Export failed: ${err.message || 'Unknown error'}`)
    } finally {
      setIsExporting(false)
    }
  }

  // 2. File Selection & Parsing
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setParsedBackup(null)
    setValidationResult(null)
    setReplaceConfirmInput('')

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const parsed = JSON.parse(text)
        const validation = validateBackupPayload(parsed, { expectedScope: currentScope })
        setParsedBackup(parsed)
        setValidationResult(validation)
      } catch (err: any) {
        setValidationResult({
          isValid: false,
          errors: [`Malformed JSON: Could not parse file (${err.message}).`],
          warnings: [],
        })
      }
    }
    reader.readAsText(file)
  }

  // 3. Restore Action
  const handleRestore = async () => {
    if (!parsedBackup || !validationResult?.isValid) return

    if (restoreMode === 'replace' && replaceConfirmInput.trim() !== 'RESTORE') {
      notify('Type "RESTORE" to confirm complete database replacement.')
      return
    }

    try {
      setIsRestoring(true)

      // Optional Safety Backup prior to replacement
      if (restoreMode === 'replace' && createPreSafetyBackup) {
        try {
          const safetyBackup = await exportBackup({ dataScope: currentScope })
          downloadBackupFile(safetyBackup, `moneymate-safety-pre-restore-${currentScope}.json`)
        } catch (e) {
          console.warn('Pre-restore safety backup skipped or failed:', e)
        }
      }

      const result = await restoreBackup(parsedBackup, {
        mode: restoreMode,
        targetScope: currentScope,
      })

      if (result.success) {
        await onRestoreComplete(result)
        notify(
          `Restored ${result.recordsRestored.transactions} transactions, ${result.recordsRestored.inventory} items, and ${result.recordsRestored.billInstances} bills (${restoreMode} mode).`
        )
        onClose()
      } else {
        notify(`Restoration failed: ${result.errors.join(', ')}`)
      }
    } catch (err: any) {
      console.error('Restoration error:', err)
      notify(`Restoration failed: ${err.message || 'Unknown error'}`)
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: 'min(100%, 540px)', maxHeight: '90vh', overflowY: 'auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={20} style={{ color: 'var(--purple)' }} />
            <div>
              <h2 style={{ fontSize: '16px', margin: 0 }}>Data Backup & Recovery</h2>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Active Scope: <b>{currentScope === 'demo' ? 'Demo Workspace' : 'Live IndexedDB Database'}</b>
              </span>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>

        {/* Tab Toggle */}
        <div className="planner-tabs" style={{ marginBottom: '16px' }}>
          <button
            className={`planner-tab ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            <Download size={14} /> Download Backup
          </button>
          <button
            className={`planner-tab ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <Upload size={14} /> Restore from File
          </button>
        </div>

        {/* TAB 1: EXPORT */}
        {activeTab === 'export' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <FileCheck size={18} style={{ color: 'var(--mint)' }} />
                <strong style={{ fontSize: '13px' }}>Complete Local Snapshot</strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.5 }}>
                Exports a versioned, cryptographically checksummed JSON file containing all ledger transactions, inventory items, shopping lists, recurring schedules, bills, planner tasks, and preferences.
              </p>
              <div style={{ fontSize: '10px', color: 'var(--muted)', background: 'var(--card)', padding: '8px 10px', borderRadius: '8px' }}>
                🛡️ <b>Privacy & Security:</b> API keys, passwords, and cloud tokens are strictly excluded from the backup payload.
              </div>
            </div>

            <button
              className="primary-button"
              id="export-backup-btn"
              onClick={handleExport}
              disabled={isExporting}
              style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
            >
              <Download size={16} />
              {isExporting ? 'Generating Verified Backup...' : `Export ${currentScope === 'demo' ? 'Demo' : 'Live'} Backup (.json)`}
            </button>
          </div>
        )}

        {/* TAB 2: IMPORT & RESTORE */}
        {activeTab === 'import' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* File Selector */}
            <div
              id="backup-file-dropzone"
              style={{
                border: '2px dashed var(--line)',
                borderRadius: '12px',
                padding: '20px',
                textAlign: 'center',
                background: 'var(--deep)',
                cursor: 'pointer',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={28} style={{ color: 'var(--muted)', marginBottom: '8px' }} />
              <strong style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                {selectedFile ? selectedFile.name : 'Select Money Mate Backup (.json)'}
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Click to browse or drag and drop a valid backup file
              </span>
              <input
                ref={fileInputRef}
                id="backup-file-input"
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* Validation Errors */}
            {validationResult && !validationResult.isValid && (
              <div
                id="backup-validation-errors"
                style={{ padding: '12px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '11px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '6px' }}>
                  <AlertTriangle size={16} /> Backup Validation Failed ({validationResult.errors.length}):
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {validationResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Validation Success & Inspection Summary */}
            {validationResult && validationResult.isValid && validationResult.summary && (
              <div id="backup-validation-success" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--mint)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={16} />
                  <span><b>Verified Backup:</b> Integrity checksum and schema version {validationResult.summary.schemaVersion} confirmed.</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', padding: '10px', background: 'var(--deep)', borderRadius: '10px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase' }}>Transactions</span>
                    <strong style={{ display: 'block', fontSize: '14px' }}>{validationResult.summary.recordCounts.transactions}</strong>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase' }}>Inventory</span>
                    <strong style={{ display: 'block', fontSize: '14px' }}>{validationResult.summary.recordCounts.inventory}</strong>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase' }}>Bills / Sched</span>
                    <strong style={{ display: 'block', fontSize: '14px' }}>
                      {validationResult.summary.recordCounts.billInstances + validationResult.summary.recordCounts.recurringSchedules}
                    </strong>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase' }}>Tasks</span>
                    <strong style={{ display: 'block', fontSize: '14px' }}>{validationResult.summary.recordCounts.plannerTasks}</strong>
                  </div>
                </div>

                {validationResult.warnings.length > 0 && (
                  <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: '10px' }}>
                    ⚠️ {validationResult.warnings.length} reference warning(s): {validationResult.warnings[0]}
                  </div>
                )}

                {/* Restoration Mode Selector */}
                <div style={{ marginTop: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                    Restoration Policy
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      id="mode-merge-btn"
                      className={`planner-tab ${restoreMode === 'merge' ? 'active' : ''}`}
                      style={{ padding: '10px', borderRadius: '8px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px' }}
                      onClick={() => setRestoreMode('merge')}
                    >
                      <strong style={{ fontSize: '12px' }}>Merge Records</strong>
                      <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Keep existing & add new</span>
                    </button>

                    <button
                      type="button"
                      id="mode-replace-btn"
                      className={`planner-tab ${restoreMode === 'replace' ? 'active' : ''}`}
                      style={{ padding: '10px', borderRadius: '8px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px', borderColor: restoreMode === 'replace' ? '#ef4444' : undefined }}
                      onClick={() => setRestoreMode('replace')}
                    >
                      <strong style={{ fontSize: '12px', color: restoreMode === 'replace' ? '#ef4444' : undefined }}>Replace All Data</strong>
                      <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Clean overwrite</span>
                    </button>
                  </div>
                </div>

                {/* Replace Mode Safeguard & Confirmation */}
                {restoreMode === 'replace' && (
                  <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>
                      <ShieldAlert size={16} /> Destructive Replace Protection
                    </div>
                    <p style={{ margin: 0, fontSize: '10px', color: 'var(--text2)', lineHeight: 1.4 }}>
                      Replace mode will wipe existing <b>{currentScope}</b> transactions, inventory, and commitments before applying the backup.
                    </p>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer', margin: '4px 0' }}>
                      <input
                        type="checkbox"
                        checked={createPreSafetyBackup}
                        onChange={(e) => setCreatePreSafetyBackup(e.target.checked)}
                      />
                      <span>Download automatic pre-restore safety backup first</span>
                    </label>

                    <div>
                      <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Type "RESTORE" to enable:</span>
                      <input
                        id="replace-confirm-input"
                        type="text"
                        placeholder="RESTORE"
                        value={replaceConfirmInput}
                        onChange={(e) => setReplaceConfirmInput(e.target.value)}
                        style={{
                          width: '100%',
                          height: '32px',
                          marginTop: '4px',
                          padding: '0 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                          background: 'var(--deep)',
                          color: 'var(--text)',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Restore Submit Button */}
                <button
                  id="execute-restore-btn"
                  className="primary-button"
                  onClick={handleRestore}
                  disabled={isRestoring || (restoreMode === 'replace' && replaceConfirmInput.trim() !== 'RESTORE')}
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    padding: '10px',
                    background: restoreMode === 'replace' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : undefined,
                    borderColor: restoreMode === 'replace' ? '#ef4444' : undefined,
                  }}
                >
                  <RefreshCw size={15} className={isRestoring ? 'spin' : ''} />
                  {isRestoring
                    ? 'Restoring Records...'
                    : restoreMode === 'replace'
                    ? 'Confirm & Replace All Data'
                    : 'Merge Backup Records'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
