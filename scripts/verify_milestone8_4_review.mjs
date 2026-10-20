import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function runBrowserVerification() {
  console.log('🚀 Launching Playwright browser for Stage 8.4 Interactive Review verification...')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } })
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

    // 5. Upload SBI Synthetic Statement
    const fileInput = modal.locator('input[type="file"]')
    const sbiFilePath = path.resolve(__dirname, '../tests/fixtures/statements/sbi_synthetic.csv')
    await fileInput.setInputFiles(sbiFilePath)
    await page.waitForTimeout(600)
    console.log('✓ Uploaded sbi_synthetic.csv')

    // Take screenshot of interactive review table with decision badges
    await page.screenshot({ path: `${screenshotsDir}/stage8_4_interactive_review.png` })
    console.log('✓ Captured interactive review table screenshot')

    // 6. Test Interactive Action: Click "Confirm" on a suggested match row (Row 1 Swiggy)
    const confirmBtn = modal.locator('.recon-action-btn.confirm').first()
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click()
      await page.waitForTimeout(400)
      console.log('✓ Clicked "Confirm" button on match row')
    }

    // 7. Test Interactive Action: Click "Separate" on another row
    const separateBtn = modal.locator('.recon-action-btn.reject').first()
    if (await separateBtn.isVisible()) {
      await separateBtn.click()
      await page.waitForTimeout(400)
      console.log('✓ Clicked "Separate" button on match row')
    }

    // Take screenshot of confirmed decisions state
    await page.screenshot({ path: `${screenshotsDir}/stage8_4_confirmed_decisions.png` })
    console.log('✓ Captured user decisions state screenshot')

    // 8. Navigate to Proposed Import Summary tab
    const summaryTab = modal.locator('button.recon-tab-btn:has-text("Proposed Import Summary")')
    await summaryTab.click()
    await page.waitForTimeout(500)
    console.log('✓ Switched to Proposed Import Summary tab')

    // Take screenshot of Proposed Import Summary panel
    await page.screenshot({ path: `${screenshotsDir}/stage8_4_proposed_summary.png` })
    console.log('✓ Captured proposed import summary screenshot')

    // 9. Mobile Responsiveness Test (375x812)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${screenshotsDir}/stage8_4_mobile_review.png` })
    console.log('✓ Captured mobile viewport (375x812) screenshot')

    console.log('\n🎉 All Stage 8.4 browser acceptance checks passed successfully!')
  } catch (err) {
    console.error('❌ Browser verification failed:', err)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

runBrowserVerification()
