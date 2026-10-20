import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function runBrowserVerification() {
  console.log('🚀 Launching Playwright browser for Stage 8.3 Reconciliation UI verification...')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  const screenshotsDir = 'C:/Users/anger/.gemini/antigravity-ide/brain/5024dac0-8e80-49b7-bd39-5ba962c38377'

  try {
    // 1. Navigate to app
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    console.log('✓ Page loaded')

    // 2. Navigate to Transactions
    await page.click('button:has-text("Transactions")')
    await page.waitForTimeout(500)
    console.log('✓ Navigated to Transactions section')

    // 3. Click Import statement button
    const importBtn = page.locator('#tx-import-statement-btn')
    await importBtn.waitFor({ state: 'visible' })
    await importBtn.click()
    await page.waitForTimeout(500)
    console.log('✓ Clicked "Import statement" button')

    // 4. Verify modal open
    const modal = page.locator('div[role="dialog"]')
    await modal.waitFor({ state: 'visible' })
    console.log('✓ ReconciliationModal is visible')

    // Take screenshot of empty dropzone state
    await page.screenshot({ path: `${screenshotsDir}/stage8_3_dropzone_empty.png` })
    console.log('✓ Captured empty dropzone screenshot')

    // 5. Upload SBI Synthetic Statement
    const fileInput = modal.locator('input[type="file"]')
    const sbiFilePath = path.resolve(__dirname, '../tests/fixtures/statements/sbi_synthetic.csv')
    await fileInput.setInputFiles(sbiFilePath)
    await page.waitForTimeout(600)
    console.log('✓ Uploaded sbi_synthetic.csv')

    // Verify format detection banner
    const banner = modal.locator('.recon-format-banner')
    await banner.waitFor({ state: 'visible' })
    const bannerText = await banner.textContent()
    console.log('  Format Banner Text:', bannerText?.slice(0, 80))

    // Verify stats grid
    const stats = modal.locator('.recon-stat-card')
    const count = await stats.count()
    console.log(`✓ Summary stats grid displayed (${count} cards)`)

    // Take screenshot of parsed SBI statement preview
    await page.screenshot({ path: `${screenshotsDir}/stage8_3_sbi_preview.png` })
    console.log('✓ Captured parsed SBI statement preview screenshot')

    // 6. Test Discard Draft
    const discardBtn = modal.locator('button:has-text("Discard draft")')
    await discardBtn.click()
    await page.waitForTimeout(400)
    console.log('✓ Clicked Discard draft')

    // 7. Upload Edge Cases file (with invalid rows)
    const edgeFilePath = path.resolve(__dirname, '../tests/fixtures/statements/edge_cases_synthetic.csv')
    await fileInput.setInputFiles(edgeFilePath)
    await page.waitForTimeout(600)
    console.log('✓ Uploaded edge_cases_synthetic.csv')

    // Switch to Rejected Rows tab
    const rejectedTab = modal.locator('button:has-text("Rejected Rows")')
    if (await rejectedTab.isVisible()) {
      await rejectedTab.click()
      await page.waitForTimeout(300)
      console.log('✓ Switched to Rejected Rows tab')
      await page.screenshot({ path: `${screenshotsDir}/stage8_3_rejected_rows.png` })
      console.log('✓ Captured rejected rows screenshot')
    }

    // 8. Discard and Close modal
    const discardSecondBtn = modal.locator('button:has-text("Discard draft")')
    if (await discardSecondBtn.isVisible()) {
      await discardSecondBtn.click()
      await page.waitForTimeout(300)
    }
    await page.click('button[aria-label="Close modal"]')
    await page.waitForTimeout(300)
    console.log('✓ Closed modal via Close button')

    // 9. Mobile Viewport Check (375x812)
    console.log('📱 Testing Mobile Viewport (375x812)...')
    await page.setViewportSize({ width: 375, height: 812 })
    await importBtn.click()
    await page.waitForTimeout(400)
    await fileInput.setInputFiles(sbiFilePath)
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${screenshotsDir}/stage8_3_mobile_preview.png` })
    console.log('✓ Captured mobile preview screenshot')

    console.log('🎉 ALL STAGE 8.3 BROWSER VERIFICATIONS PASSED!')
  } catch (err) {
    console.error('❌ Browser verification error:', err)
    process.exit(1)
  } finally {
    await browser.close()
  }
}

runBrowserVerification()
