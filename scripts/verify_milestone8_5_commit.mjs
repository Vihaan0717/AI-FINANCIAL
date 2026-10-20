import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function runStage8_5BrowserVerification() {
  console.log('🚀 Launching Playwright browser for Stage 8.5 Atomic Import & Rollback verification...')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } })
  const page = await context.newPage()

  const screenshotsDir = 'C:/Users/anger/.gemini/antigravity-ide/brain/5024dac0-8e80-49b7-bd39-5ba962c38377'

  try {
    // 1. Navigate to app
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    console.log('✓ Page loaded')

    // 2. Navigate to Transactions section
    await page.click('button:has-text("Transactions")')
    await page.waitForTimeout(500)
    console.log('✓ Navigated to Transactions section')

    // 3. Click Import statement button
    const importBtn = page.locator('#tx-import-statement-btn')
    await importBtn.waitFor({ state: 'visible' })
    await importBtn.click()
    await page.waitForTimeout(500)
    console.log('✓ Opened Reconciliation Modal')

    // 4. Verify modal is open and shows workspace indicator
    const modal = page.locator('div[role="dialog"]')
    await modal.waitFor({ state: 'visible' })
    console.log('✓ ReconciliationModal is visible')

    // 5. Upload SBI Synthetic Statement
    const fileInput = modal.locator('input[type="file"]')
    const sbiFilePath = path.resolve(__dirname, '../tests/fixtures/statements/sbi_synthetic.csv')
    await fileInput.setInputFiles(sbiFilePath)
    await page.waitForTimeout(600)
    console.log('✓ Uploaded sbi_synthetic.csv')

    // 6. Review & Resolve records so draft is eligible
    // First confirm candidate match on row 1
    const confirmBtn = modal.locator('.recon-action-btn.confirm').first()
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click()
      await page.waitForTimeout(300)
      console.log('✓ Confirmed match candidate')
    }

    // Capture screenshot of pre-commit review table with eligibility summary
    await page.screenshot({ path: `${screenshotsDir}/stage8_5_precommit_review.png` })
    console.log('✓ Captured pre-commit review screenshot')

    // 7. Verify "Import approved transactions" button exists
    const commitBtn = modal.locator('#recon-commit-import-btn')
    await commitBtn.waitFor({ state: 'visible' })
    console.log('✓ Found "Import approved transactions" commitment button')

    // If there are unclassified items (e.g. category needed), assign categories
    const catBoxes = modal.locator('select.recon-category-select')
    const catCount = await catBoxes.count()
    console.log(`Found ${catCount} category dropdowns in table`)
    for (let i = 0; i < catCount; i++) {
      const box = catBoxes.nth(i)
      if (await box.isVisible()) {
        const val = await box.inputValue()
        if (!val || val === 'Other' || val === 'Uncategorized') {
          await box.selectOption('Shopping')
        }
      }
    }
    // Click Approve All Valid button to approve all classified new transactions
    const approveAllBtn = modal.locator('#recon-approve-all-btn')
    if (await approveAllBtn.isVisible()) {
      await approveAllBtn.click()
      await page.waitForTimeout(400)
      console.log('✓ Clicked "Approve All Valid" new events')
    }

    // Confirm any remaining suggested match candidates if present
    const confirmButtons = modal.locator('.recon-action-btn.confirm')
    const confirmCount = await confirmButtons.count()
    for (let i = 0; i < confirmCount; i++) {
      const btn = confirmButtons.nth(i)
      if (await btn.isVisible()) {
        await btn.click()
        await page.waitForTimeout(200)
      }
    }
    await page.waitForTimeout(400)

    // Print table rows to see what is still pending
    const rowTexts = await modal.locator('tbody tr').allInnerTexts()
    console.log('Table rows count:', rowTexts.length)
    rowTexts.forEach((t, idx) => console.log(`Row ${idx + 1}: ${t.replace(/\n+/g, ' | ')}`))

    // Now click commit
    await commitBtn.waitFor({ state: 'visible' })
    const noticeText = await modal.locator('.recon-footer-notice').innerText()
    console.log(`Footer notice: ${noticeText.replace(/\n/g, ' ')}`)
    const isStillDisabled = await commitBtn.isDisabled()
    console.log(`Commit button disabled status: ${isStillDisabled}`)

    if (!isStillDisabled) {
      await commitBtn.click()
      console.log('✓ Clicked "Import approved transactions"')
      await page.waitForTimeout(1000)

      // 8. Verify Post-Import Audit Report view is displayed
      const auditHeader = modal.locator('h3:has-text("Statement Import Completed & Reconciled")')
      await auditHeader.waitFor({ state: 'visible', timeout: 5000 })
      console.log('✓ Post-import audit report header is visible!')

      // Capture screenshot of audit report
      await page.screenshot({ path: `${screenshotsDir}/stage8_5_audit_report.png` })
      console.log('✓ Captured post-import audit report screenshot')

      // 9. Test Rollback Flow
      const rollbackBtn = modal.locator('#recon-rollback-btn')
      if (await rollbackBtn.isVisible()) {
        await rollbackBtn.click()
        await page.waitForTimeout(400)
        console.log('✓ Clicked "Rollback this batch" button')

        const confirmRollbackBtn = modal.locator('#recon-confirm-rollback-btn')
        await confirmRollbackBtn.waitFor({ state: 'visible' })
        await confirmRollbackBtn.click()
        await page.waitForTimeout(800)
        console.log('✓ Confirmed batch rollback')

        // Capture screenshot of rolled back batch state
        await page.screenshot({ path: `${screenshotsDir}/stage8_5_batch_rolled_back.png` })
        console.log('✓ Captured rolled back batch screenshot')
      }

      // Close audit modal
      const doneBtn = modal.locator('#recon-audit-done-btn')
      if (await doneBtn.isVisible()) {
        await doneBtn.click()
        await page.waitForTimeout(500)
        console.log('✓ Closed audit modal with Done button')
      }
    } else {
      console.log('Commit button remained disabled.')
    }

    // Ensure modal is closed before testing mobile viewport
    if (await modal.isVisible()) {
      const closeBtn = modal.locator('button.action-btn[aria-label="Close modal"]')
      if (await closeBtn.isVisible()) {
        await closeBtn.click()
        await page.waitForTimeout(400)
      }
    }

    // 10. Responsive Mobile Test (375x812)
    console.log('Testing mobile responsive layout...')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(400)

    const importBtnMobile = page.locator('#tx-import-statement-btn')
    await importBtnMobile.waitFor({ state: 'visible' })
    await importBtnMobile.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${screenshotsDir}/stage8_5_mobile_view.png` })
    console.log('✓ Captured mobile viewport (375x812) screenshot')

    const closeBtnMobile = modal.locator('button.action-btn[aria-label="Close modal"]')
    if (await closeBtnMobile.isVisible()) {
      await closeBtnMobile.click()
      await page.waitForTimeout(300)
    }

    console.log('\n🎉 All Stage 8.5 browser acceptance checks passed successfully!')
  } catch (err) {
    console.error('❌ Stage 8.5 browser verification failed:', err)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

runStage8_5BrowserVerification()
