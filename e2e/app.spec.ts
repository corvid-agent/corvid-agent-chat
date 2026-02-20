import { test, expect } from '@playwright/test';

test.describe('App Loading', () => {
  test('should load the app and display the #app container', async ({ page }) => {
    await page.goto('/');

    // The root #app container must exist
    const app = page.locator('#app');
    await expect(app).toBeVisible();
    await expect(app).toHaveClass(/app/);
  });

  test('should have the correct page title', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('CorvidAgent Chat');
  });

  test('should render the setup view initially when no wallet is stored', async ({ page }) => {
    await page.goto('/');

    // The setup view container should be visible
    const setupView = page.locator('.setup-view');
    await expect(setupView).toBeVisible();

    // The app title "CORVID CHAT" should be displayed
    const title = page.locator('.setup-view__title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('CORVID CHAT');
  });

  test('should display the setup subtitle describing the app', async ({ page }) => {
    await page.goto('/');

    const subtitle = page.locator('.setup-view__subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toContainText('Decentralized messaging powered by Algorand');
  });

  test('should render the create wallet card by default', async ({ page }) => {
    await page.goto('/');

    // The "Create Wallet" card title should be visible
    const createCardTitle = page.locator('.setup-card__title', { hasText: 'Create Wallet' });
    await expect(createCardTitle).toBeVisible();

    // The "Generate New Wallet" button should be present
    const btnCreate = page.locator('#btn-create');
    await expect(btnCreate).toBeVisible();
    await expect(btnCreate).toHaveText('Generate New Wallet');
  });

  test('should render the import wallet card by default', async ({ page }) => {
    await page.goto('/');

    // The "Import Wallet" card title should be visible
    const importCardTitle = page.locator('.setup-card__title', { hasText: 'Import Wallet' });
    await expect(importCardTitle).toBeVisible();

    // The "Import Wallet" button should be present
    const btnImport = page.locator('#btn-import');
    await expect(btnImport).toBeVisible();
    await expect(btnImport).toHaveText('Import Wallet');
  });

  test('should have an "or" divider between create and import sections', async ({ page }) => {
    await page.goto('/');

    const divider = page.locator('.divider');
    await expect(divider).toBeVisible();
    await expect(divider).toHaveText('or');
  });

  test('should log initialization message to console', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

    await page.goto('/');
    await page.waitForSelector('.setup-view');

    // The app logs "[CorvidChat] AlgoChat client initialized" on startup
    const hasInitLog = consoleMessages.some((msg) =>
      msg.includes('AlgoChat client initialized')
    );
    expect(hasInitLog).toBe(true);
  });
});
