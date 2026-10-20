import fs from 'fs'
import { parseStatementPdf } from '../src/utils/statementParsers/index.ts'
import { createInitialReconciliationDecisions } from '../src/utils/reconciliationRules.ts'

async function inspectDirections() {
  const pdfPath = 'c:/Users/anger/Downloads/PhonePe_Statement_Jul2026_Oct2026.pdf'
  const fileBytes = new Uint8Array(fs.readFileSync(pdfPath))

  const parsed = await parseStatementPdf(fileBytes, {
    sourceAccountId: 'acc-phonepe-primary',
    targetScope: 'demo',
  })

  console.log('=== Parser Statistics ===')
  console.log(JSON.stringify(parsed.statistics, null, 2))

  const debits = parsed.records.filter(r => r.direction === 'debit')
  const credits = parsed.records.filter(r => r.direction === 'credit')

  console.log(`\nFiltered from records:`)
  console.log(`- Debits count: ${debits.length}`)
  console.log(`- Credits count: ${credits.length}`)
  console.log(`- Total: ${debits.length + credits.length}`)

  // Count by proposedType
  const byProposedType: Record<string, number> = {}
  parsed.records.forEach(r => {
    byProposedType[r.proposedType] = (byProposedType[r.proposedType] || 0) + 1
  })
  console.log('\nBy proposedType:', byProposedType)

  // Count by direction and proposedType
  const crossTab: Record<string, Record<string, number>> = { debit: {}, credit: {} }
  parsed.records.forEach(r => {
    crossTab[r.direction][r.proposedType] = (crossTab[r.direction][r.proposedType] || 0) + 1
  })
  console.log('\nDirection vs ProposedType:', crossTab)

  // Initial decisions
  const decisions = createInitialReconciliationDecisions(parsed.records, [])
  const byDecisionState: Record<string, number> = {}
  decisions.forEach(d => {
    byDecisionState[d.state] = (byDecisionState[d.state] || 0) + 1
  })
  console.log('\nInitial Decision States:', byDecisionState)

  const debitsByDecision: Record<string, number> = {}
  const creditsByDecision: Record<string, number> = {}
  parsed.records.forEach(r => {
    const d = decisions.get(r.id)
    const state = d?.state || 'none'
    if (r.direction === 'debit') {
      debitsByDecision[state] = (debitsByDecision[state] || 0) + 1
    } else {
      creditsByDecision[state] = (creditsByDecision[state] || 0) + 1
    }
  })
  console.log('\nDebits by decision state:', debitsByDecision)
  console.log('Credits by decision state:', creditsByDecision)
}

inspectDirections().catch(console.error)
