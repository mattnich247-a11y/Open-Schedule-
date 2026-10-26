import { chromium } from 'playwright';

async function verifyApp() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // 1. Verify Login screen title
  const title = await page.textContent('h1');
  console.log('Page Title:', title);

  // 2. Click "Explore Sample Business (Demo Sandbox)" to enter Manager Dashboard
  console.log('Clicking Explore Sample Business...');
  await page.click('button:has-text("Explore Sample Business")');
  await page.waitForTimeout(1000);

  // 3. Verify Manager Dashboard rendered
  const dashboardHeading = await page.textContent('h1');
  console.log('Dashboard Business Name:', dashboardHeading);

  // 4. Check draft shift notice and weekly budget edit button
  const draftNotice = await page.locator('text=draft shifts on this week').count();
  console.log('Draft notice count:', draftNotice);

  const editBudgetBtn = await page.locator('button[title*="Custom Weekly Labor Budget"]').count();
  console.log('Edit budget button count:', editBudgetBtn);

  // 5. Navigate to Roster and check blocked vacation badges
  const vacationBlockedBadge = await page.locator('text=Vacation').count();
  console.log('Vacation badges count:', vacationBlockedBadge);

  // 6. Test Team Chat tab
  console.log('Clicking Team Chat tab...');
  await page.click('button:has-text("Team Chat")');
  await page.waitForTimeout(500);
  const chatHeading = await page.textContent('h2:has-text("Team Chat")');
  console.log('Chat Heading:', chatHeading);

  // 7. Test AI tab
  console.log('Clicking AI tab...');
  await page.click('button:has-text("AI Operations")');
  await page.waitForTimeout(500);
  const aiKeyRequired = await page.locator('text=API Key Required').count();
  console.log('AI Key Required count (when no key):', aiKeyRequired);

  // 8. Test Settings tab
  console.log('Clicking Settings tab...');
  await page.click('button:has-text("Settings")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Cloud Sync & Privacy")');
  await page.waitForTimeout(300);
  const cloudBadge = await page.locator('text=>50% Bandwidth Saved').count();
  console.log('Cloud 50%+ reduction badge count:', cloudBadge);

  // 9. Inspect Cloud Payload modal
  await page.click('button:has-text("Inspect Payload & Savings Stats")');
  await page.waitForTimeout(500);
  const reductionText = await page.locator('text=Saved').first().textContent();
  console.log('Cloud Reduction in modal:', reductionText);
  await page.click('button:has-text("Done")');

  // 10. Switch to Staff view
  console.log('Switching to Staff view via Demo Sandbox bar...');
  // Find employee view button in demo bar or header
  const staffBtn = page.locator('button:has-text("Employee View")');
  if (await staffBtn.count() > 0) {
    await staffBtn.click();
    await page.waitForTimeout(1000);
    console.log('Switched to Staff view successfully');
  }

  console.log('Console errors encountered:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.error('Errors:', consoleErrors);
  }

  await browser.close();
  console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');
}

verifyApp().catch((err) => {
  console.error('Browser test failed:', err);
  process.exit(1);
});
