import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const ARTIFACT_DIR = 'C:\\Users\\anger\\.gemini\\antigravity-ide\\brain\\5024dac0-8e80-49b7-bd39-5ba962c38377'

// Pure checksum calculation matching computeBackupChecksum
function computeBackupChecksum(data) {
  const str = JSON.stringify(data)
  let h1 = 0xdeadbeef
  let h2 = 0x41c64e6d
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

async function runMilestone7BackupVerification() {
  console.log('=== MONEY MATE AI: MILESTONE 7.6 BACKUP & RECOVERY BROWSER ACCEPTANCE TEST ===')
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('Restor') || msg.text().includes('Backup')) {
      console.log('BROWSER CONSOLE:', msg.type(), msg.text())
    }
  })
  page.on('pageerror', (err) => {
    console.error('BROWSER PAGE ERROR:', err.message)
  })

  const results = {
    test1_settings_backup_card: false,
    test2_modal_open_and_scope: false,
    test3_export_download_flow: false,
    test4_validation_rejection_malformed: false,
    test5_validation_success_inspection: false,
    test6_replace_safeguard_confirmation: false,
    test7_demo_live_isolation_enforcement: false,
    test8_merge_restoration_execution: false,
    details: [],
    screenshots: [],
  }

  // Create temporary test backup files for import testing
  const tempDir = path.join(ARTIFACT_DIR, 'scratch')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  // Valid Live Backup payload
  const validLivePayload = {
    transactions: [
      {
        id: 'tx-live-backup-01',
        type: 'expense',
        amount: 250000,
        currency: 'INR',
        date: '2026-10-10T12:00:00.000Z',
        description: 'Office Supplies & Stationery',
        category: 'Utilities',
        paymentMethod: 'UPI',
        status: 'completed',
        isDemo: false,
        createdAt: '2026-10-10T12:00:00.000Z',
        updatedAt: '2026-10-10T12:00:00.000Z',
      },
      {
        id: 'tx-live-backup-02',
        type: 'income',
        amount: 1500000,
        currency: 'INR',
        date: '2026-10-12T10:00:00.000Z',
        description: 'Consulting Honorarium',
        category: 'Income',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        isDemo: false,
        createdAt: '2026-10-12T10:00:00.000Z',
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
    ],
    inventory: [
      {
        id: 'inv-item-01',
        name: 'A4 Printing Paper',
        category: 'Household essentials',
        quantity: 5,
        unit: 'packs',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    shoppingList: [
      {
        id: 'shop-item-01',
        productName: 'Ballpoint Pens 10-pack',
        quantity: 2,
        unit: 'packs',
        priority: 'medium',
        status: 'planned',
        isDemo: false,
        createdAt: '2026-10-02T10:00:00.000Z',
      },
    ],
    receiptLinks: [],
    recurringSchedules: [
      {
        id: 'sched-backup-01',
        title: 'Office Cloud Storage',
        category: 'Utilities',
        amountPaise: 80000,
        commitmentType: 'expense',
        frequency: 'monthly',
        startDate: '2026-10-01',
        nextDueDate: '2026-11-01',
        status: 'active',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    billInstances: [
      {
        id: 'bill-backup-01',
        scheduleId: 'sched-backup-01',
        title: 'Office Cloud Storage - Oct',
        category: 'Utilities',
        amountPaise: 80000,
        commitmentType: 'expense',
        dueDate: '2026-10-01',
        status: 'paid',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    plannerTasks: [
      {
        id: 'task-backup-01',
        title: 'Quarterly Ledger Reconciliation',
        status: 'pending',
        priority: 'high',
        category: 'task',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    dismissedAlerts: [],
    preferences: { theme: 'dark' },
  }

  const validLiveBackup = {
    metadata: {
      schemaVersion: 1,
      appVersion: '0.7.0',
      exportedAt: new Date().toISOString(),
      dataScope: 'live',
      checksum: computeBackupChecksum(validLivePayload),
      recordCounts: {
        transactions: 2,
        inventory: 1,
        shoppingList: 1,
        receiptLinks: 0,
        recurringSchedules: 1,
        billInstances: 1,
        plannerTasks: 1,
        dismissedAlerts: 0,
      },
    },
    data: validLivePayload,
  }

  const validLiveFilePath = path.join(tempDir, 'valid_live_backup.json')
  fs.writeFileSync(validLiveFilePath, JSON.stringify(validLiveBackup, null, 2))

  // Malformed / Corrupted Checksum Backup
  const malformedBackup = {
    metadata: {
      schemaVersion: 1,
      appVersion: '0.7.0',
      exportedAt: new Date().toISOString(),
      dataScope: 'live',
      checksum: 'bad_tampered_checksum_123',
      recordCounts: {
        transactions: 1,
        inventory: 0,
        shoppingList: 0,
        receiptLinks: 0,
        recurringSchedules: 0,
        billInstances: 0,
        plannerTasks: 0,
        dismissedAlerts: 0,
      },
    },
    data: {
      transactions: [
        {
          id: 'tx-bad-1',
          type: 'expense',
          amount: -500, // Invalid negative paise
          currency: 'INR',
          date: '2026-10-01',
          status: 'invalid_status',
        },
      ],
      inventory: [],
      shoppingList: [],
      receiptLinks: [],
      recurringSchedules: [],
      billInstances: [],
      plannerTasks: [],
      dismissedAlerts: [],
    },
  }
  const malformedFilePath = path.join(tempDir, 'malformed_backup.json')
  fs.writeFileSync(malformedFilePath, JSON.stringify(malformedBackup, null, 2))

  // Demo Backup (to test demo vs live isolation)
  const demoPayload = { ...validLivePayload }
  const demoBackup = {
    metadata: {
      schemaVersion: 1,
      appVersion: '0.7.0',
      exportedAt: new Date().toISOString(),
      dataScope: 'demo',
      checksum: computeBackupChecksum(demoPayload),
      recordCounts: {
        transactions: 2,
        inventory: 1,
        shoppingList: 1,
        receiptLinks: 0,
        recurringSchedules: 1,
        billInstances: 1,
        plannerTasks: 1,
        dismissedAlerts: 0,
      },
    },
    data: demoPayload,
  }
  const demoFilePath = path.join(tempDir, 'demo_scope_backup.json')
  fs.writeFileSync(demoFilePath, JSON.stringify(demoBackup, null, 2))

  try {
    // ------------------------------------------------------------------------
    // STEP 0: Load Application & Go to Live Workspace
    // ------------------------------------------------------------------------
    console.log('Step 0: Navigating to Money Mate AI (http://localhost:5173/) ...')
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Ensure we are in Real / Live Workspace
    const demoButton = page.locator('button:has-text("Demo"), button:has-text("Live")')
    const buttonText = await demoButton.innerText()
    if (buttonText.includes('Demo')) {
      console.log('Currently in Demo Mode, switching to Live / Real Data mode...')
      await demoButton.click()
      await page.waitForTimeout(800)
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 1: Navigate to Settings & Verify Backup Card
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 1: Settings Navigation & Backup Card Presence ---')
    const settingsNav = page.locator('button[title="Settings"]')
    await settingsNav.click()
    await page.waitForTimeout(800)

    const backupModalBtn = page.locator('#open-backup-modal-btn')
    const btnVisible = await backupModalBtn.isVisible()
    console.log(`"Backup & Recovery" button visible in Settings: ${btnVisible}`)

    const shot1 = path.join(ARTIFACT_DIR, 'm7_backup_01_settings_entry.png')
    await page.screenshot({ path: shot1 })
    results.screenshots.push(shot1)

    if (btnVisible) {
      results.test1_settings_backup_card = true
      results.details.push('Settings page contains Data Backup & Recovery card and launch button.')
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 2: Open Backup Modal & Verify Scope
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 2: Open Backup Modal & Check Active Scope ---')
    await backupModalBtn.click()
    await page.waitForTimeout(500)

    const modalTitle = await page.locator('.modal h2').innerText()
    const scopeText = await page.locator('.modal header span').innerText()
    console.log(`Modal Title: "${modalTitle}", Scope: "${scopeText}"`)

    const shot2 = path.join(ARTIFACT_DIR, 'm7_backup_02_export_tab.png')
    await page.screenshot({ path: shot2 })
    results.screenshots.push(shot2)

    if (modalTitle.includes('Data Backup & Recovery') && scopeText.includes('Live')) {
      results.test2_modal_open_and_scope = true
      results.details.push('Backup modal opened successfully displaying Live IndexedDB scope.')
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 3: Test Export Download Flow
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 3: Test Export Download Flow ---')
    const exportBtn = page.locator('#export-backup-btn')
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 })
    await exportBtn.click()
    const download = await downloadPromise
    const downloadedFilename = download.suggestedFilename()
    console.log(`Downloaded backup filename: ${downloadedFilename}`)

    const downloadedPath = path.join(tempDir, downloadedFilename)
    await download.saveAs(downloadedPath)
    const exportedRaw = fs.readFileSync(downloadedPath, 'utf-8')
    const exportedJson = JSON.parse(exportedRaw)

    console.log(`Exported Schema Version: ${exportedJson.metadata?.schemaVersion}`)
    console.log(`Exported Data Scope: ${exportedJson.metadata?.dataScope}`)
    console.log(`Exported Checksum: ${exportedJson.metadata?.checksum}`)
    console.log(`Exported Transactions: ${exportedJson.metadata?.recordCounts?.transactions}`)

    if (
      exportedJson.metadata?.schemaVersion === 1 &&
      exportedJson.metadata?.dataScope === 'live' &&
      exportedJson.metadata?.checksum &&
      exportedJson.data?.transactions !== undefined
    ) {
      results.test3_export_download_flow = true
      results.details.push(`Exported verified backup file (${downloadedFilename}) with valid metadata and checksum.`)
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 4: Switch to Restore Tab & Test Malformed Rejection
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 4: Switch to Restore Tab & Test Malformed Rejection ---')
    const restoreTabBtn = page.locator('button:has-text("Restore from File")')
    await restoreTabBtn.click()
    await page.waitForTimeout(400)

    // Upload malformed/tampered file
    const fileInput = page.locator('#backup-file-input')
    await fileInput.setInputFiles(malformedFilePath)
    await page.waitForTimeout(600)

    const errorsVisible = await page.locator('#backup-validation-errors').isVisible()
    const errorText = await page.locator('#backup-validation-errors').innerText()
    console.log(`Validation errors visible: ${errorsVisible}`)
    console.log(`Error preview: ${errorText.split('\n').slice(0, 3).join(' | ')}`)

    const shot3 = path.join(ARTIFACT_DIR, 'm7_backup_03_malformed_rejection.png')
    await page.screenshot({ path: shot3 })
    results.screenshots.push(shot3)

    if (errorsVisible && errorText.includes('Checksum mismatch')) {
      results.test4_validation_rejection_malformed = true
      results.details.push('Malformed payload with invalid checksum and negative amounts rejected before import.')
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 5: Upload Demo Backup in Live Workspace (Isolation Check)
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 5: Demo vs Live Isolation Check ---')
    await fileInput.setInputFiles(demoFilePath)
    await page.waitForTimeout(600)

    const scopeErrorVisible = await page.locator('#backup-validation-errors').isVisible()
    const scopeErrorText = await page.locator('#backup-validation-errors').innerText()
    console.log(`Scope mismatch error: "${scopeErrorText}"`)

    const shot4 = path.join(ARTIFACT_DIR, 'm7_backup_04_scope_mismatch_rejection.png')
    await page.screenshot({ path: shot4 })
    results.screenshots.push(shot4)

    if (scopeErrorVisible && scopeErrorText.includes('Workspace mismatch')) {
      results.test7_demo_live_isolation_enforcement = true
      results.details.push('Attempt to restore Demo backup into Live workspace rejected cleanly.')
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 6: Upload Valid Live Backup & Verify Inspection Summary
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 6: Valid Backup Inspection Summary ---')
    await fileInput.setInputFiles(validLiveFilePath)
    await page.waitForTimeout(600)

    const successVisible = await page.locator('#backup-validation-success').isVisible()
    console.log(`Inspection summary visible: ${successVisible}`)

    const shot5 = path.join(ARTIFACT_DIR, 'm7_backup_05_valid_inspection_summary.png')
    await page.screenshot({ path: shot5 })
    results.screenshots.push(shot5)

    if (successVisible) {
      results.test5_validation_success_inspection = true
      results.details.push('Valid backup loaded: displayed integrity verification badge and collection counts.')
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 7: Test Replace Mode Safeguard & Confirmation
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 7: Test Replace Mode Safeguard & Confirmation ---')
    const replaceModeBtn = page.locator('#mode-replace-btn')
    await replaceModeBtn.click()
    await page.waitForTimeout(400)

    const executeBtn = page.locator('#execute-restore-btn')
    const isDisabledInitially = await executeBtn.isDisabled()
    console.log(`Execute button disabled before typing RESTORE: ${isDisabledInitially}`)

    const confirmInput = page.locator('#replace-confirm-input')
    await confirmInput.fill('RESTORE')
    await page.waitForTimeout(300)

    const isEnabledAfter = await executeBtn.isEnabled()
    console.log(`Execute button enabled after typing RESTORE: ${isEnabledAfter}`)

    const shot6 = path.join(ARTIFACT_DIR, 'm7_backup_06_replace_safeguard_typed.png')
    await page.screenshot({ path: shot6 })
    results.screenshots.push(shot6)

    if (isDisabledInitially && isEnabledAfter) {
      results.test6_replace_safeguard_confirmation = true
      results.details.push('Replace mode safeguard strictly disabled submit until "RESTORE" was typed.')
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 8: Switch to Merge Mode and Execute Restoration
    // ------------------------------------------------------------------------
    console.log('\n--- WORKFLOW 8: Switch to Merge Mode and Execute Restoration ---')
    const mergeModeBtn = page.locator('#mode-merge-btn')
    await mergeModeBtn.click()
    await page.waitForTimeout(400)

    console.log('Triggering restoration in Merge mode...')
    await executeBtn.click()
    await page.waitForTimeout(1500)

    const isModalStillVisible = await page.locator('.modal').isVisible()
    console.log(`Modal still open after restore? ${isModalStillVisible}`)

    if (isModalStillVisible) {
      // If modal is still open, check if there is an error message displayed or if we can close it
      const modalText = await page.locator('.modal').innerText()
      console.log('Modal text inside after click:', modalText)
      const closeBtn = page.locator('.modal header button[aria-label="Close dialog"]')
      await closeBtn.click()
      await page.waitForTimeout(500)
    }

    const shot7 = path.join(ARTIFACT_DIR, 'm7_backup_07_restored_toast.png')
    await page.screenshot({ path: shot7 })
    results.screenshots.push(shot7)

    // Navigate to Transactions page to verify the restored transaction appears
    console.log('Navigating to Transactions to check imported records...')
    const txNav = page.locator('.sidebar nav button[title="Transactions"]')
    await txNav.click()
    await page.waitForTimeout(1000)

    const pageContent = await page.content()
    const isVisibleInDom = await page.locator('text=Office Supplies').isVisible()
    const hasRestoredTx = isVisibleInDom || pageContent.includes('Office Supplies')
    console.log(`Restored transaction "Office Supplies & Stationery" found in UI: ${hasRestoredTx}`)

    const shot8 = path.join(ARTIFACT_DIR, 'm7_backup_08_transactions_verified.png')
    await page.screenshot({ path: shot8 })
    results.screenshots.push(shot8)

    if (hasRestoredTx) {
      results.test8_merge_restoration_execution = true
      results.details.push('Restoration merged records into IndexedDB and refreshed transactions UI seamlessly.')
    }
  } catch (err) {
    console.error('Test execution error:', err)
    results.details.push(`Error: ${err.message}`)
  } finally {
    await browser.close()
  }

  console.log('\n=== FINAL BROWSER VERIFICATION SUMMARY ===')
  console.log(JSON.stringify(results, null, 2))
  return results
}

runMilestone7BackupVerification()
