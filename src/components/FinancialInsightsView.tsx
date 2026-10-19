import { useState } from 'react'
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Download,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PieChart as PieChartIcon,
  Store,
  Clock,
  Info,
  CheckCircle2,
  FileText,
  BarChart2 as BarChartIcon,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type { UseFinancialInsightsReturn } from '../hooks/useFinancialInsights'
import { formatPaise } from '../utils/money'
import { CATEGORY_COLORS } from '../utils/calculations'

interface FinancialInsightsViewProps {
  insights: UseFinancialInsightsReturn
  onNavigateToTransactions?: () => void
  onNavigateToPlanner?: () => void
}

const NEEDS_WANTS_COLORS: Record<string, string> = {
  Needs: '#10b981', // Emerald green
  Wants: '#8b5cf6', // Violet
  Savings: '#3b82f6', // Blue
  Transfers: '#64748b', // Slate
  Unclassified: '#f59e0b', // Amber
}

export function FinancialInsightsView({
  insights,
  onNavigateToTransactions,
  onNavigateToPlanner,
}: FinancialInsightsViewProps) {
  const {
    selectedYear,
    selectedMonth,
    selectedMonthLabel,
    availablePeriods,
    setSelectedPeriod,
    goToPreviousMonth,
    goToNextMonth,
    resetToCurrentMonth,
    monthlyReport,
    monthOverMonth,
    weekOverWeek,
    categoryShifts,
    needsWants,
    anomaliesResult,
    merchantAnalytics,
    narrative,
    isEmpty,
    hasNoTransactionsInPeriod,
    dataQualityWarnings,
    isDemoMode,
    downloadMonthlyReport,
  } = insights

  const [activeTab, setActiveTab] = useState<'overview' | 'categories' | 'needs_wants' | 'merchants' | 'report'>('overview')

  // Prepare chart data for Needs vs Wants
  const pieData = [
    { name: 'Needs', value: needsWants.needsPaise / 100, color: NEEDS_WANTS_COLORS.Needs },
    { name: 'Wants', value: needsWants.wantsPaise / 100, color: NEEDS_WANTS_COLORS.Wants },
    ...(needsWants.unclassifiedPaise > 0
      ? [{ name: 'Unclassified', value: needsWants.unclassifiedPaise / 100, color: NEEDS_WANTS_COLORS.Unclassified }]
      : []),
  ].filter((d) => d.value > 0)

  // Prepare category comparison chart data (top 6 categories by spend)
  const categoryChartData = categoryShifts.slice(0, 6).map((c) => ({
    name: c.category.length > 12 ? `${c.category.slice(0, 10)}...` : c.category,
    current: c.currentPaise / 100,
    previous: c.previousPaise / 100,
    delta: c.deltaPaise / 100,
  }))

  return (
    <section className="section-page">
      {/* Page Header */}
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <i /> FINANCIAL INTELLIGENCE & PERSONALIZED INSIGHTS
          </div>
          <h1>
            Financial <span>Insights</span>
          </h1>
          <p>
            Deterministic accounting analytics and grounded explanations for <b>{selectedMonthLabel}</b>.
          </p>
        </div>

        {/* Action Controls & Month Navigation */}
        <div className="heading-actions" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div className="period-selector" style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--card)', padding: '2px 4px', borderRadius: '10px', border: '1px solid var(--line)' }}>
            <button
              className="icon-button"
              style={{ width: '28px', height: '28px' }}
              onClick={goToPreviousMonth}
              title="Previous Month"
              aria-label="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>

            <select
              id="reporting-period-select"
              value={`${selectedYear}-${selectedMonth}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number)
                setSelectedPeriod(y, m)
              }}
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--text)',
                fontWeight: 700,
                fontSize: '11px',
                padding: '4px 6px',
                outline: 0,
                cursor: 'pointer',
              }}
              aria-label="Select reporting month"
            >
              {availablePeriods.map((p) => (
                <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`} style={{ background: '#191c28', color: '#fff' }}>
                  {p.label}
                </option>
              ))}
            </select>

            <button
              className="icon-button"
              style={{ width: '28px', height: '28px' }}
              onClick={goToNextMonth}
              title="Next Month"
              aria-label="Next Month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button className="outline-button" onClick={resetToCurrentMonth} style={{ fontSize: '11px' }}>
            <Calendar size={13} /> Current
          </button>

          <button className="primary-button" onClick={() => downloadMonthlyReport()} style={{ fontSize: '11px' }}>
            <Download size={14} /> Export Report (.md)
          </button>
        </div>
      </div>

      {/* Empty State when no transactions at all in ledger */}
      {isEmpty && (
        <div className="panel empty-state" style={{ padding: '36px 20px', marginBottom: '20px', textAlign: 'center' }}>
          <Clock size={40} style={{ color: 'var(--muted)', marginBottom: '12px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No Ledger Transactions Found</h3>
          <p style={{ fontSize: '12px', color: 'var(--muted)', maxWidth: '420px', margin: '0 auto 16px' }}>
            Your transaction ledger is currently empty. Record your first income or expense to activate intelligent spending comparisons, anomaly detection, and cash-flow insights.
          </p>
          {onNavigateToTransactions && (
            <button className="primary-button" onClick={onNavigateToTransactions} style={{ fontSize: '12px', margin: '0 auto' }}>
              Go to Transactions
            </button>
          )}
        </div>
      )}

      {/* Period has no transactions warning */}
      {hasNoTransactionsInPeriod && !isEmpty && (
        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={16} />
            <span>No transactions recorded for <b>{selectedMonthLabel}</b>. Switch reporting month or record new entries.</span>
          </div>
          {onNavigateToTransactions && (
            <button className="outline-button" onClick={onNavigateToTransactions} style={{ fontSize: '10px', padding: '4px 8px' }}>
              Add Transaction
            </button>
          )}
        </div>
      )}

      {/* Workspace Isolation Indicator Banner if Demo */}
      {isDemoMode && (
        <div style={{ padding: '8px 14px', borderRadius: '10px', background: 'rgba(255,168,91,0.12)', border: '1px solid rgba(255,168,91,0.3)', color: 'var(--orange)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <Info size={15} />
          <span><b>Demo Workspace Active:</b> All insights below are generated strictly from demo records. Your real financial database in IndexedDB is isolated.</span>
        </div>
      )}

      {/* Data Quality Warnings Banner if any */}
      {dataQualityWarnings.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
            <AlertTriangle size={15} /> Accounting Audit Notices ({dataQualityWarnings.length}):
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {dataQualityWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. Monthly Overview Summary Grid */}
      <div className="summary-grid">
        <div className="summary-card balance">
          <span className="summary-label">
            NET CASH FLOW
            <span className="round green" style={{ width: '22px', height: '22px' }}>
              <TrendingUp size={12} />
            </span>
          </span>
          <strong style={{ color: monthlyReport.netSavingsCashFlowPaise >= 0 ? 'var(--mint)' : '#f87171' }}>
            {formatPaise(monthlyReport.netSavingsCashFlowPaise, { showSign: true })}
          </strong>
          <span className="card-footer">
            Income minus net confirmed expenses
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-label">CONFIRMED INCOME</span>
          <strong>{formatPaise(monthlyReport.confirmedIncomePaise)}</strong>
          <span className="card-footer muted">
            {monthlyReport.savingsRatePct !== undefined
              ? `Savings rate: ${monthlyReport.savingsRatePct}%`
              : 'Earned & verified income'}
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-label">NET CONFIRMED EXPENSES</span>
          <strong style={{ color: '#f87171' }}>{formatPaise(monthlyReport.netConfirmedExpensesPaise)}</strong>
          <span className="card-footer muted">
            Gross {formatPaise(monthlyReport.grossConfirmedExpensesPaise)}
            {monthlyReport.refundsPaise > 0 && ` − Refunds ${formatPaise(monthlyReport.refundsPaise)}`}
          </span>
        </div>

        <div className="summary-card spendable">
          <span className="summary-label">UPCOMING COMMITMENTS</span>
          <strong>{formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingBillsPaise + monthlyReport.upcomingCommitmentsSummary.upcomingSipsPaise)}</strong>
          <span className="card-footer">
            <b>{monthlyReport.upcomingCommitmentsSummary.count} upcoming</b> in {selectedMonthLabel}
          </span>
        </div>
      </div>

      {/* Grounded AI / Deterministic Narrative Banner */}
      <article className="ai-card" style={{ marginBottom: '16px' }}>
        <div className="ai-top">
          <div className="ai-avatar">
            <Sparkles size={16} />
          </div>
          <div>
            <b>Money Mate Financial Intelligence</b>
            <span>{isDemoMode ? 'Verified on demo dataset' : 'Grounded in authoritative IndexedDB records'}</span>
          </div>
        </div>

        <h2>{narrative.headline}</h2>
        <p>{narrative.summaryText}</p>

        {narrative.driverExplanations.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {narrative.driverExplanations.map((exp, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '11px', color: '#e2ddff' }}>
                <span style={{ color: 'var(--mint)' }}>•</span>
                <span>{exp}</span>
              </div>
            ))}
          </div>
        )}

        {narrative.actionableSuggestions.length > 0 && (
          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <strong style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--mint)' }}>
              Actionable Observation
            </strong>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#fff', lineHeight: 1.5 }}>
              {narrative.actionableSuggestions[0]}
            </p>
          </div>
        )}
      </article>

      {/* Navigation Sub-Tabs */}
      <div className="planner-tabs" style={{ marginBottom: '16px' }}>
        <button
          className={`planner-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <TrendingUp size={14} /> Spending Comparisons
        </button>
        <button
          className={`planner-tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          <BarChartIcon size={14} /> Category Shifts ({categoryShifts.length})
        </button>
        <button
          className={`planner-tab ${activeTab === 'needs_wants' ? 'active' : ''}`}
          onClick={() => setActiveTab('needs_wants')}
        >
          <PieChartIcon size={14} /> Needs vs. Wants
        </button>
        <button
          className={`planner-tab ${activeTab === 'merchants' ? 'active' : ''}`}
          onClick={() => setActiveTab('merchants')}
        >
          <Store size={14} /> Merchants ({merchantAnalytics.uniqueMerchantCount})
        </button>
        <button
          className={`planner-tab ${activeTab === 'report' ? 'active' : ''}`}
          onClick={() => setActiveTab('report')}
        >
          <FileText size={14} /> Full Monthly Report
        </button>
      </div>

      {/* TAB 1: Spending Comparisons */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="dashboard-grid">
            {/* Month-over-Month Card */}
            <article className="panel" style={{ padding: '20px' }}>
              <div className="panel-heading" style={{ marginBottom: '14px' }}>
                <div>
                  <h2>Month-over-Month Comparison</h2>
                  <p>{selectedMonthLabel} vs. {monthOverMonth.previousPeriodLabel}</p>
                </div>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '10px',
                    fontWeight: 700,
                    background:
                      monthOverMonth.direction === 'decreased'
                        ? 'rgba(16,185,129,0.15)'
                        : monthOverMonth.direction === 'increased'
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(148,163,184,0.15)',
                    color:
                      monthOverMonth.direction === 'decreased'
                        ? '#10b981'
                        : monthOverMonth.direction === 'increased'
                        ? '#ef4444'
                        : 'var(--muted)',
                  }}
                >
                  {monthOverMonth.percentageChangeState === 'new_spending'
                    ? 'New spending'
                    : monthOverMonth.percentageChangeState === 'no_change'
                    ? 'No change'
                    : `${monthOverMonth.percentageChange! > 0 ? '+' : ''}${monthOverMonth.percentageChange}%`}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '14px 0' }}>
                <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                  <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                    {monthOverMonth.previousPeriodLabel}
                  </span>
                  <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0' }}>
                    {formatPaise(monthOverMonth.previousSpendingPaise)}
                  </strong>
                </div>

                <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                  <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                    {selectedMonthLabel}
                  </span>
                  <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0', color: 'var(--text)' }}>
                    {formatPaise(monthOverMonth.currentSpendingPaise)}
                  </strong>
                </div>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text2)', margin: '8px 0 0' }}>
                Net spending {monthOverMonth.direction === 'increased' ? 'rose' : monthOverMonth.direction === 'decreased' ? 'declined' : 'held steady'} by{' '}
                <b>{formatPaise(Math.abs(monthOverMonth.deltaPaise))}</b>.
                {monthOverMonth.percentageChangeState === 'new_spending' && (
                  <span> Note: Baseline is zero; new spending recorded without prior baseline.</span>
                )}
              </p>
            </article>

            {/* Week-over-Week Card */}
            <article className="panel" style={{ padding: '20px' }}>
              <div className="panel-heading" style={{ marginBottom: '14px' }}>
                <div>
                  <h2>Week-over-Week Comparison</h2>
                  <p>Rolling 7-day pace vs. prior 7 days</p>
                </div>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '10px',
                    fontWeight: 700,
                    background:
                      weekOverWeek.direction === 'decreased'
                        ? 'rgba(16,185,129,0.15)'
                        : weekOverWeek.direction === 'increased'
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(148,163,184,0.15)',
                    color:
                      weekOverWeek.direction === 'decreased'
                        ? '#10b981'
                        : weekOverWeek.direction === 'increased'
                        ? '#ef4444'
                        : 'var(--muted)',
                  }}
                >
                  {weekOverWeek.percentageChangeState === 'new_spending'
                    ? 'New spending'
                    : weekOverWeek.percentageChangeState === 'no_change'
                    ? 'No change'
                    : `${weekOverWeek.percentageChange! > 0 ? '+' : ''}${weekOverWeek.percentageChange}%`}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '14px 0' }}>
                <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                  <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                    Prior 7 Days
                  </span>
                  <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0' }}>
                    {formatPaise(weekOverWeek.previousSpendingPaise)}
                  </strong>
                </div>

                <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                  <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                    Past 7 Days
                  </span>
                  <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0', color: 'var(--text)' }}>
                    {formatPaise(weekOverWeek.currentSpendingPaise)}
                  </strong>
                </div>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text2)', margin: '8px 0 0' }}>
                Recent weekly spend is{' '}
                <b>{formatPaise(Math.abs(weekOverWeek.deltaPaise))}</b> {weekOverWeek.direction === 'increased' ? 'higher' : 'lower'} than the preceding week.
              </p>
            </article>
          </div>

          {/* Spending Anomalies & Spikes Section */}
          <article className="panel" style={{ padding: '20px' }}>
            <div className="panel-heading" style={{ marginBottom: '12px' }}>
              <div>
                <h2>Spending Anomaly & Spike Detection</h2>
                <p>Statistical heuristic alerts highlighting unusually high purchases</p>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                {anomaliesResult.insufficientHistory
                  ? 'Baseline pending (requires 5+ entries)'
                  : `${anomaliesResult.anomalies.length} flagged`}
              </span>
            </div>

            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--deep)', fontSize: '11px', color: 'var(--muted)', marginBottom: '14px' }}>
              ℹ️ <b>Heuristic Notice:</b> These alerts identify purchases that deviate significantly from category median baselines or represent large portions of monthly spend. They indicate items worth reviewing, not fraudulent activity.
            </div>

            {anomaliesResult.insufficientHistory ? (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <Clock size={32} />
                <h3 style={{ fontSize: '13px' }}>Establishing Historical Baseline</h3>
                <p style={{ fontSize: '11px' }}>
                  At least 5 completed transactions in a category are required to compute robust median benchmarks and avoid false alerts.
                </p>
              </div>
            ) : anomaliesResult.anomalies.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px', borderRadius: '10px', background: 'rgba(16,185,129,0.1)', color: '#10b981', fontSize: '12px' }}>
                <CheckCircle2 size={18} />
                <span>All transactions in <b>{selectedMonthLabel}</b> are consistent with typical spending ranges. No spikes detected.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {anomaliesResult.anomalies.map((a) => (
                  <div key={a.transactionId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.05)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 800, background: '#ef4444', color: '#fff' }}>
                          SPIKE
                        </span>
                        <strong style={{ fontSize: '12px' }}>{a.description}</strong>
                        {a.merchant && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>· {a.merchant}</span>}
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                        {a.date} · {a.category} · {a.explanation}
                      </p>
                    </div>
                    <strong style={{ fontSize: '14px', color: '#ef4444' }}>
                      {formatPaise(a.amountPaise)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* Section 7: Upcoming Commitments & Recurring Bills */}
          <article className="panel" style={{ padding: '20px' }}>
            <div className="panel-heading" style={{ marginBottom: '12px' }}>
              <div>
                <h2>Upcoming Commitments & Recurring Bills</h2>
                <p>Scheduled expenses due in {selectedMonthLabel} (excluding already settled/linked transactions)</p>
              </div>
              {onNavigateToPlanner && (
                <button className="outline-button" onClick={onNavigateToPlanner} style={{ fontSize: '11px' }}>
                  Manage Bills in Planner
                </button>
              )}
            </div>

            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--deep)', fontSize: '11px', color: 'var(--muted)', marginBottom: '14px' }}>
              ℹ️ <b>Commitment Safeguard:</b> Only active, unlinked upcoming bills for {selectedMonthLabel} are projected. Paid, skipped, and cancelled bills—as well as bills already settled as transactions—are strictly excluded to prevent double-counting.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Upcoming Bills</span>
                <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0' }}>
                  {formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingBillsPaise)}
                </strong>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  {monthlyReport.upcomingCommitmentsSummary.count} schedule(s) pending
                </span>
              </div>

              <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Upcoming Investments / SIPs</span>
                <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0', color: 'var(--mint)' }}>
                  {formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingSipsPaise)}
                </strong>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  Dedicated wealth commitments
                </span>
              </div>

              <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Total Expected Cash Outflow</span>
                <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 0', color: 'var(--text)' }}>
                  {formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingBillsPaise + monthlyReport.upcomingCommitmentsSummary.upcomingSipsPaise)}
                </strong>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  Cash obligation schedule (not bank balance)
                </span>
              </div>
            </div>
          </article>
        </div>
      )}

      {/* TAB 2: Category Shifts & Attribution */}
      {activeTab === 'categories' && (
        <article className="panel" style={{ padding: '20px' }}>
          <div className="panel-heading" style={{ marginBottom: '16px' }}>
            <div>
              <h2>Category Spending Shifts & Drivers</h2>
              <p>Comparing {selectedMonthLabel} vs. prior month across all active categories</p>
            </div>
          </div>

          {categoryShifts.length === 0 ? (
            <div className="empty-state">
              <p>No category transactions recorded for {selectedMonthLabel}.</p>
            </div>
          ) : (
            <div>
              {/* Category Shift Chart */}
              {categoryChartData.length > 0 && (
                <div style={{ height: '220px', width: '100%', marginBottom: '24px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                      <Tooltip
                        contentStyle={{ background: 'var(--deep)', border: '1px solid var(--line)', borderRadius: '8px', fontSize: '11px' }}
                        formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, '']}
                      />
                      <Bar dataKey="previous" name="Previous Month" fill="#64748b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="current" name="Current Month" fill="var(--purple)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Category Breakdown Table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {categoryShifts.map((cat) => {
                  const isUp = cat.direction === 'increased'
                  const isDown = cat.direction === 'decreased'
                  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : TrendingUp

                  return (
                    <div
                      key={cat.category}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: '1px solid var(--soft)',
                        background: 'var(--deep)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: CATEGORY_COLORS[cat.category] || '#94a3b8',
                          }}
                        />
                        <div>
                          <strong style={{ fontSize: '12px' }}>{cat.category}</strong>
                          <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--muted)' }}>
                            {cat.transactionCount} transaction(s) · Prev: {formatPaise(cat.previousPaise)}
                          </p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        {cat.contributionToOverallIncreasePct !== undefined && (
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'rgba(239,68,68,0.15)',
                              color: '#ef4444',
                              fontSize: '9px',
                              fontWeight: 700,
                            }}
                          >
                            Drove {cat.contributionToOverallIncreasePct}% of increase
                          </span>
                        )}

                        <div style={{ textAlign: 'right' }}>
                          <strong style={{ fontSize: '13px', display: 'block' }}>
                            {formatPaise(cat.currentPaise)}
                          </strong>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: isUp ? '#ef4444' : isDown ? '#10b981' : 'var(--muted)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                            }}
                          >
                            <Icon size={12} />
                            {isUp ? '+' : ''}
                            {formatPaise(cat.deltaPaise)}
                            {cat.percentageChangeState === 'calculated' && ` (${cat.percentageChange}%)`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </article>
      )}

      {/* TAB 3: Needs vs. Wants Breakdown */}
      {activeTab === 'needs_wants' && (
        <div className="dashboard-grid">
          <article className="panel" style={{ padding: '20px' }}>
            <div className="panel-heading" style={{ marginBottom: '14px' }}>
              <div>
                <h2>Operational Spending Split</h2>
                <p>Essential Needs vs. Discretionary Wants</p>
              </div>
            </div>

            {needsWants.totalOperationalExpensesPaise === 0 ? (
              <div className="empty-state">
                <p>No operational expenses recorded in this period.</p>
              </div>
            ) : (
              <div>
                <div style={{ height: '180px', width: '100%', display: 'flex', justifyContent: 'center' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={3}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'var(--deep)', border: '1px solid var(--line)', borderRadius: '8px', fontSize: '11px' }}
                        formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px' }}>
                  <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)', borderLeft: `3px solid ${NEEDS_WANTS_COLORS.Needs}` }}>
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>ESSENTIAL NEEDS</span>
                    <strong style={{ display: 'block', fontSize: '16px', margin: '4px 0 2px' }}>
                      {formatPaise(needsWants.needsPaise)}
                    </strong>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: NEEDS_WANTS_COLORS.Needs }}>
                      {needsWants.needsPercentageOfExpenses}% of operational spend
                    </span>
                  </div>

                  <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)', borderLeft: `3px solid ${NEEDS_WANTS_COLORS.Wants}` }}>
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>DISCRETIONARY WANTS</span>
                    <strong style={{ display: 'block', fontSize: '16px', margin: '4px 0 2px' }}>
                      {formatPaise(needsWants.wantsPaise)}
                    </strong>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: NEEDS_WANTS_COLORS.Wants }}>
                      {needsWants.wantsPercentageOfExpenses}% of operational spend
                    </span>
                  </div>
                </div>

                {needsWants.unclassifiedPaise > 0 && (
                  <div style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '11px', color: '#f59e0b' }}>
                    ⚠️ <b>Unclassified Expenses:</b> {formatPaise(needsWants.unclassifiedPaise)} ({needsWants.unclassifiedPercentageOfExpenses}%) in categories: {needsWants.unclassifiedCategories.join(', ')}. These are kept distinct and not forced into needs or wants.
                  </div>
                )}
              </div>
            )}
          </article>

          {/* Benchmark Guide & Capital Savings */}
          <article className="panel" style={{ padding: '20px' }}>
            <div className="panel-heading" style={{ marginBottom: '14px' }}>
              <div>
                <h2>Budgeting Benchmark & Savings</h2>
                <p>Optional 50/30/20 guideline comparison</p>
              </div>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text2)', lineHeight: 1.6, marginBottom: '14px' }}>
              The <b>50/30/20 rule</b> is an optional budgeting guideline suggesting up to 50% for essential needs, 30% for discretionary wants, and 20% toward savings/investments.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  SAVINGS & INVESTMENTS ALLOCATED
                </span>
                <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 2px', color: 'var(--mint)' }}>
                  {formatPaise(needsWants.savingsInvestmentsPaise)}
                </strong>
                <p style={{ margin: 0, fontSize: '10px', color: 'var(--muted)' }}>
                  {needsWants.savingsPercentageOfIncome !== undefined
                    ? `${needsWants.savingsPercentageOfIncome}% of verified income`
                    : 'Strictly kept outside operational consumption expenses'}
                </p>
              </div>

              <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--deep)' }}>
                <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  INTERNAL ACCOUNT TRANSFERS
                </span>
                <strong style={{ display: 'block', fontSize: '18px', margin: '4px 0 2px' }}>
                  {formatPaise(needsWants.transfersPaise)}
                </strong>
                <p style={{ margin: 0, fontSize: '10px', color: 'var(--muted)' }}>
                  Excluded from ordinary income and expenses
                </p>
              </div>
            </div>
          </article>
        </div>
      )}

      {/* TAB 4: Merchant Analysis */}
      {activeTab === 'merchants' && (
        <div className="dashboard-grid">
          {/* Top by Spend Volume */}
          <article className="panel" style={{ padding: '20px' }}>
            <div className="panel-heading" style={{ marginBottom: '14px' }}>
              <div>
                <h2>Top Merchants by Spend</h2>
                <p>Highest cumulative spending in {selectedMonthLabel}</p>
              </div>
            </div>

            {merchantAnalytics.topMerchantsBySpend.length === 0 ? (
              <div className="empty-state">
                <p>No merchant records in this period.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {merchantAnalytics.topMerchantsBySpend.map((m, idx) => (
                  <div
                    key={m.merchant}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'var(--deep)',
                      border: '1px solid var(--soft)',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 700 }}>#{idx + 1}</span>
                        <strong style={{ fontSize: '12px' }}>{m.merchant}</strong>
                      </div>
                      <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--muted)' }}>
                        {m.transactionCount} visit(s) · {m.topCategory}
                      </p>
                    </div>
                    <strong style={{ fontSize: '13px' }}>{formatPaise(m.totalPaise)}</strong>
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* Top by Frequency */}
          <article className="panel" style={{ padding: '20px' }}>
            <div className="panel-heading" style={{ marginBottom: '14px' }}>
              <div>
                <h2>Frequent Vendors & Orders</h2>
                <p>Most repeated transaction points</p>
              </div>
            </div>

            {merchantAnalytics.frequentMerchants.length === 0 ? (
              <div className="empty-state">
                <p>No merchant visits in this period.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {merchantAnalytics.frequentMerchants.map((m) => (
                  <div
                    key={m.merchant}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'var(--deep)',
                      border: '1px solid var(--soft)',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '12px' }}>{m.merchant}</strong>
                      <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--muted)' }}>
                        Avg. {formatPaise(m.averagePaise)} / order · Last: {m.lastVisitedDate}
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: 'var(--hover)',
                        fontSize: '11px',
                        fontWeight: 800,
                      }}
                    >
                      {m.transactionCount} orders
                    </span>
                  </div>
                ))}
              </div>
            )}

            {merchantAnalytics.unidentifiedTransactionCount > 0 && (
              <div style={{ marginTop: '14px', padding: '10px', borderRadius: '8px', background: 'var(--deep)', fontSize: '10px', color: 'var(--muted)' }}>
                ℹ️ <b>{merchantAnalytics.unidentifiedTransactionCount} transaction(s)</b> ({formatPaise(merchantAnalytics.unidentifiedMerchantSpendPaise)}) had no merchant name attached and are preserved as unidentified.
              </div>
            )}
          </article>
        </div>
      )}

      {/* TAB 5: Full Monthly Report */}
      {activeTab === 'report' && (
        <article className="panel" style={{ padding: '24px' }}>
          <div className="panel-heading" style={{ marginBottom: '16px' }}>
            <div>
              <h2>Deterministic Financial Statement — {selectedMonthLabel}</h2>
              <p>Generated strictly from verified ledger and recurring commitments</p>
            </div>
            <button className="primary-button" onClick={() => downloadMonthlyReport()} style={{ fontSize: '11px' }}>
              <Download size={14} /> Download (.md)
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Gross Expenses</span>
              <strong style={{ display: 'block', fontSize: '17px', margin: '4px 0' }}>{formatPaise(monthlyReport.grossConfirmedExpensesPaise)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Refund Offsets</span>
              <strong style={{ display: 'block', fontSize: '17px', margin: '4px 0', color: 'var(--mint)' }}>−{formatPaise(monthlyReport.refundsPaise)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Net Expenses</span>
              <strong style={{ display: 'block', fontSize: '17px', margin: '4px 0', color: '#f87171' }}>{formatPaise(monthlyReport.netConfirmedExpensesPaise)}</strong>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--deep)', border: '1px solid var(--soft)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase' }}>Upcoming Bills</span>
              <strong style={{ display: 'block', fontSize: '17px', margin: '4px 0' }}>{formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingBillsPaise)}</strong>
            </div>
          </div>

          <pre
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'var(--deep)',
              border: '1px solid var(--line)',
              color: 'var(--text2)',
              fontSize: '11px',
              lineHeight: 1.6,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
            }}
          >
            {insights.exportMonthlyReportMarkdown()}
          </pre>
        </article>
      )}
    </section>
  )
}
