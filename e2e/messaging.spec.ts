import { test, expect } from '@playwright/test';

test.describe('Setup View - Wallet Creation and Unlock UI', () => {
  test('should show password fields for creating a wallet', async ({ page }) => {
    await page.goto('/');

    // Password input for wallet creation
    const createPassword = page.locator('#create-password');
    await expect(createPassword).toBeVisible();
    await expect(createPassword).toHaveAttribute('type', 'password');
    await expect(createPassword).toHaveAttribute('placeholder', 'Choose a password...');

    // Confirm password input
    const confirmPassword = page.locator('#create-password-confirm');
    await expect(confirmPassword).toBeVisible();
    await expect(confirmPassword).toHaveAttribute('type', 'password');
    await expect(confirmPassword).toHaveAttribute('placeholder', 'Confirm password...');
  });

  test('should show mnemonic and password fields for importing a wallet', async ({ page }) => {
    await page.goto('/');

    // Mnemonic textarea
    const mnemonic = page.locator('#import-mnemonic');
    await expect(mnemonic).toBeVisible();
    await expect(mnemonic).toHaveAttribute('placeholder', 'Enter your Algorand mnemonic...');

    // Import password input
    const importPassword = page.locator('#import-password');
    await expect(importPassword).toBeVisible();
    await expect(importPassword).toHaveAttribute('type', 'password');
    await expect(importPassword).toHaveAttribute('placeholder', 'Choose a password...');
  });

  test('should have form labels for all input fields', async ({ page }) => {
    await page.goto('/');

    // Labels in the create wallet card
    const passwordLabel = page.locator('.form-label', { hasText: 'Password' }).first();
    await expect(passwordLabel).toBeVisible();

    const confirmLabel = page.locator('.form-label', { hasText: 'Confirm Password' });
    await expect(confirmLabel).toBeVisible();

    // Labels in the import wallet card
    const mnemonicLabel = page.locator('.form-label', { hasText: '25-word Mnemonic' });
    await expect(mnemonicLabel).toBeVisible();
  });

  test('should show encryption hint under the create password field', async ({ page }) => {
    await page.goto('/');

    const hint = page.locator('.form-hint', { hasText: 'Encrypts your wallet locally' });
    await expect(hint).toBeVisible();
  });

  test('should allow typing in the create wallet password fields', async ({ page }) => {
    await page.goto('/');

    const createPassword = page.locator('#create-password');
    await createPassword.fill('mypassword123');
    await expect(createPassword).toHaveValue('mypassword123');

    const confirmPassword = page.locator('#create-password-confirm');
    await confirmPassword.fill('mypassword123');
    await expect(confirmPassword).toHaveValue('mypassword123');
  });

  test('should allow typing in the import wallet fields', async ({ page }) => {
    await page.goto('/');

    const mnemonic = page.locator('#import-mnemonic');
    await mnemonic.fill('test mnemonic phrase');
    await expect(mnemonic).toHaveValue('test mnemonic phrase');

    const importPassword = page.locator('#import-password');
    await importPassword.fill('importpass123');
    await expect(importPassword).toHaveValue('importpass123');
  });

  test('should have the setup view contained within #app', async ({ page }) => {
    await page.goto('/');

    // The setup-view should be a child of #app
    const setupInApp = page.locator('#app .setup-view');
    await expect(setupInApp).toBeVisible();
  });

  test('should display exactly two setup cards (create and import)', async ({ page }) => {
    await page.goto('/');

    const cards = page.locator('.setup-card');
    await expect(cards).toHaveCount(2);
  });

  test('should not show unlock view when no wallet is stored', async ({ page }) => {
    await page.goto('/');

    // The unlock-password field should NOT be present since no wallet is stored
    const unlockPassword = page.locator('#unlock-password');
    await expect(unlockPassword).toHaveCount(0);

    // The unlock button should NOT be present
    const btnUnlock = page.locator('#btn-unlock');
    await expect(btnUnlock).toHaveCount(0);
  });

  test('should not show chat, scan, or settings views initially', async ({ page }) => {
    await page.goto('/');

    // No header with "Connect Agent" (scan view)
    const scanHeader = page.locator('.header__title', { hasText: 'Connect Agent' });
    await expect(scanHeader).toHaveCount(0);

    // No terminal (chat view)
    const terminal = page.locator('.terminal');
    await expect(terminal).toHaveCount(0);

    // No settings header
    const settingsHeader = page.locator('.header__title', { hasText: 'Settings' });
    await expect(settingsHeader).toHaveCount(0);
  });
});
