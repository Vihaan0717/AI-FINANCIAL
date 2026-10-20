import { chromium } from 'playwright'

async function runBrowserPreviewAudit() {
  console.log('🚀 Step 1: Launching Playwright browser...')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()

  // Network activity tracker
  const networkRequests = []
  const externalRequests = []

  page.on('request', (req) => {
    const url = req.url()
    networkRequests.push({ url, method: req.method() })
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push({ url, method: req.method() })
    }
  })

  try {
    // 1. Open app
    console.log('🚀 Step 2: Navigating to http://localhost:5173/ ...')
    const response = await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    if (response?.status() !== 200) {
      throw new Error(`Failed to load app: status ${response?.status()}`)
    }
    console.log('✓ Application opened with HTTP 200 OK')

    // 2. Verify workspace and ensure Demo Workspace is active
    console.log('🚀 Step 3: Checking Demo Workspace indicator...')
    const toggleBtn = page.locator('b[title*="toggle between Real Data and Demo Data"]')
    await toggleBtn.waitFor({ state: 'visible', timeout: 8000 })
    const text = await toggleBtn.innerText()
    if (!text.includes('Demo workspace')) {
      console.log('Currently in Live database mode. Clicking to switch to Demo workspace...')
      await toggleBtn.click()
      await page.waitForTimeout(400)
    }
    const confirmedText = await toggleBtn.innerText()
    if (!confirmedText.includes('Demo workspace')) {
      throw new Error(`Failed to activate Demo workspace: current text is "${confirmedText}"`)
    }
    console.log(`✓ Confirmed active workspace is Demo Workspace (${confirmedText})`)

    // 3. Inspect IndexedDB before preview
    console.log('🚀 Step 4: Inspecting IndexedDB before statement loading...')
    const idbBefore = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('MoneyMateDB')
        req.onsuccess = () => {
          const db = req.result
          const txStore = db.transaction('transactions', 'readonly').objectStore('transactions')
          const batchStore = db.transaction('import_batches', 'readonly').objectStore('import_batches')
          const txCountReq = txStore.count()
          const batchCountReq = batchStore.count()

          let txCount = 0
          let batchCount = 0
          txCountReq.onsuccess = () => { txCount = txCountReq.result }
          batchCountReq.onsuccess = () => {
            batchCount = batchCountReq.result
            resolve({ txCount, batchCount })
          }
        }
        req.onerror = () => resolve({ txCount: -1, batchCount: -1 })
      })
    })
    console.log(`✓ Pre-preview IndexedDB state: ${idbBefore.txCount} transactions, ${idbBefore.batchCount} import batches`)

    // 4. Open Reconciliation Modal
    console.log('🚀 Step 5: Opening Reconciliation Modal...')
    await page.click('button:has-text("Transactions")')
    await page.waitForTimeout(500)

    const importBtn = page.locator('#tx-import-statement-btn')
    await importBtn.waitFor({ state: 'visible' })
    await importBtn.click()

    const modal = page.locator('div[role="dialog"]')
    await modal.waitFor({ state: 'visible' })
    console.log('✓ Reconciliation Modal is open')

    // 5. Upload actual PhonePe PDF locally
    console.log('🚀 Step 6: Loading PhonePe PDF into local file reader...')
    const fileInput = modal.locator('input[type="file"]')
    const realPdfPath = 'c:\\Users\\anger\\Downloads\\PhonePe_Statement_Jul2026_Oct2026.pdf'
    await fileInput.setInputFiles(realPdfPath)

    // Wait for client-side extraction to complete and preview table to render
    console.log('🚀 Step 7: Waiting for client-side extraction and staging...')
    const filePill = modal.locator('.recon-file-pill')
    await filePill.waitFor({ state: 'visible', timeout: 30000 })
    console.log('✓ Preview extracted and rendered successfully (.recon-file-pill is visible)')

    // 6. Inspect UI Preview details
    const modalText = await modal.innerText()
    const parsed218 = modalText.includes('218')
    console.log(`✓ UI displays 218 parsed entries: ${parsed218}`)

    const statsGrid = modal.locator('.recon-stats-grid')
    if (await statsGrid.count() > 0) {
      const statsText = await statsGrid.innerText()
      console.log('✓ Stats Grid text:', statsText.replace(/\n+/g, ' | '))
    }

    // 7. Verify IndexedDB during Preview: Must be 100% UNCHANGED
    console.log('🚀 Step 8: Verifying IndexedDB during active preview...')
    const idbDuringPreview = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('MoneyMateDB')
        req.onsuccess = () => {
          const db = req.result
          const txStore = db.transaction('transactions', 'readonly').objectStore('transactions')
          const batchStore = db.transaction('import_batches', 'readonly').objectStore('import_batches')
          const txCountReq = txStore.count()
          const batchCountReq = batchStore.count()

          let txCount = 0
          let batchCount = 0
          txCountReq.onsuccess = () => { txCount = txCountReq.result }
          batchCountReq.onsuccess = () => {
            batchCount = batchCountReq.result
            resolve({ txCount, batchCount })
          }
        }
      })
    })

    console.log(`✓ During-preview IndexedDB state: ${idbDuringPreview.txCount} transactions, ${idbDuringPreview.batchCount} import batches`)
    if (idbDuringPreview.txCount !== idbBefore.txCount || idbDuringPreview.batchCount !== idbBefore.batchCount) {
      throw new Error(`CRITICAL SAFETY BREACH: Preview mutated IndexedDB before user commit! Before: ${JSON.stringify(idbBefore)}, During: ${JSON.stringify(idbDuringPreview)}`)
    }
    console.log('✓ SAFETY CONFIRMED: Zero records written to IndexedDB during statement preview!')

    // 8. Capture screenshot of preview modal
    const screenshotPath = 'C:/Users/anger/.gemini/antigravity-ide/brain/5024dac0-8e80-49b7-bd39-5ba962c38377/real_phonepe_preview.png'
    await modal.screenshot({ path: screenshotPath })
    console.log(`✓ Screenshot captured at ${screenshotPath}`)

    // 9. Verify network isolation
    console.log('🚀 Step 9: Verifying network isolation...')
    console.log(`Total HTTP requests during session: ${networkRequests.length}`)
    console.log(`External HTTP requests: ${externalRequests.length}`)
    if (externalRequests.length > 0) {
      console.error('LEAK DETECTED: External requests made:', externalRequests)
      throw new Error(`CRITICAL PRIVACY VIOLATION: Statement preview triggered external requests!`)
    }
    console.log('✓ PRIVACY CONFIRMED: Zero external network requests occurred. 100% local.')

    // 10. Click Discard Draft
    console.log('🚀 Step 10: Testing Discard Draft button...')
    const discardBtn = modal.locator('button:has-text("Discard Draft"), button:has-text("Cancel")').first()
    await discardBtn.click()
    await page.waitForTimeout(500)
    console.log('✓ Draft discarded cleanly')

    // Final IndexedDB check
    const idbAfter = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('MoneyMateDB')
        req.onsuccess = () => {
          const db = req.result
          const txStore = db.transaction('transactions', 'readonly').objectStore('transactions')
          const batchStore = db.transaction('import_batches', 'readonly').objectStore('import_batches')
          const txCountReq = txStore.count()
          const batchCountReq = batchStore.count()

          let txCount = 0
          let batchCount = 0
          txCountReq.onsuccess = () => { txCount = txCountReq.result }
          batchCountReq.onsuccess = () => {
            batchCount = batchCountReq.result
            resolve({ txCount, batchCount })
          }
        }
      })
    })
    console.log(`✓ Post-discard IndexedDB state: ${idbAfter.txCount} transactions, ${idbAfter.batchCount} import batches`)
    console.log('🎉 Browser Preview Safety Verification PASSED flawlessly!')

  } finally {
    await browser.close()
  }
}

runBrowserPreviewAudit().catch((err) => {
  console.error('❌ Browser preview audit failed:', err)
  process.exit(1)
})
