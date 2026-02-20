import { test, expect } from '@playwright/test';

test.describe('Wallet UI Elements', () => {
  test('should have a "Generate New Wallet" button that is enabled', async ({ page }) => {
    await page.goto('/');

    const btnCreate = page.locator('#btn-create');
    await expect(btnCreate).toBeVisible();
    await expect(btnCreate).toBeEnabled();
    await expect(btnCreate).toHaveText('Generate New Wallet');
    await expect(btnCreate).toHaveClass(/btn--primary/);
  });

  test('should have an "Import Wallet" button that is enabled', async ({ page }) => {
    await page.goto('/');

    const btnImport = page.locator('#btn-import');
    await expect(btnImport).toBeVisible();
    await expect(btnImport).toBeEnabled();
    await expect(btnImport).toHaveText('Import Wallet');
    await expect(btnImport).toHaveClass(/btn--secondary/);
  });

  test('should have full-width buttons in the setup cards', async ({ page }) => {
    await page.goto('/');

    const btnCreate = page.locator('#btn-create');
    await expect(btnCreate).toHaveClass(/btn--full/);

    const btnImport = page.locator('#btn-import');
    await expect(btnImport).toHaveClass(/btn--full/);
  });

  test('should have autocomplete attributes on password fields', async ({ page }) => {
    await page.goto('/');

    // Create wallet passwords should have new-password autocomplete
    const createPassword = page.locator('#create-password');
    await expect(createPassword).toHaveAttribute('autocomplete', 'new-password');

    const confirmPassword = page.locator('#create-password-confirm');
    await expect(confirmPassword).toHaveAttribute('autocomplete', 'new-password');

    // Import password should also have new-password autocomplete
    const importPassword = page.locator('#import-password');
    await expect(importPassword).toHaveAttribute('autocomplete', 'new-password');
  });

  test('should have a textarea for mnemonic input with 3 rows', async ({ page }) => {
    await page.goto('/');

    const mnemonic = page.locator('#import-mnemonic');
    await expect(mnemonic).toBeVisible();

    // It should be a textarea element
    const tagName = await mnemonic.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('textarea');

    // It should have rows="3"
    await expect(mnemonic).toHaveAttribute('rows', '3');
  });

  test('should show unlock view after wallet creation via localStorage', async ({ page }) => {
    // Simulate having a stored wallet by setting localStorage before the page loads
    await page.goto('/');

    // Set a mock stored wallet in localStorage
    await page.evaluate(() => {
      const mockWallet = {
        encryptedMnemonic: 'dGVzdA==',
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY',
        iv: 'dGVzdGl2MTIzNDU2',
        salt: 'dGVzdHNhbHQxMjM0NTY3OA=='
      };
      localStorage.setItem('corvid-wallet', JSON.stringify(mockWallet));
    });

    // Reload so the app reads the stored wallet
    await page.reload();
    await page.waitForSelector('.setup-view');

    // Now the unlock view should be shown
    const unlockPassword = page.locator('#unlock-password');
    await expect(unlockPassword).toBeVisible();

    const btnUnlock = page.locator('#btn-unlock');
    await expect(btnUnlock).toBeVisible();
    await expect(btnUnlock).toHaveText('Unlock');
  });

  test('should show shortened wallet address in unlock view', async ({ page }) => {
    await page.goto('/');

    // Set a mock stored wallet
    await page.evaluate(() => {
      const mockWallet = {
        encryptedMnemonic: 'dGVzdA==',
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY',
        iv: 'dGVzdGl2MTIzNDU2',
        salt: 'dGVzdHNhbHQxMjM0NTY3OA=='
      };
      localStorage.setItem('corvid-wallet', JSON.stringify(mockWallet));
    });

    await page.reload();
    await page.waitForSelector('.setup-view');

    // Should show shortened address: first 6 + "..." + last 4
    // Address: ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY
    // Shortened: ABCDEF...VWXY
    const addrText = page.locator('.status-dot--grey + span');
    await expect(addrText).toContainText('ABCDEF...VWXY');
  });

  test('should show "Reset Wallet" button in unlock view', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const mockWallet = {
        encryptedMnemonic: 'dGVzdA==',
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY',
        iv: 'dGVzdGl2MTIzNDU2',
        salt: 'dGVzdHNhbHQxMjM0NTY3OA=='
      };
      localStorage.setItem('corvid-wallet', JSON.stringify(mockWallet));
    });

    await page.reload();
    await page.waitForSelector('.setup-view');

    const btnReset = page.locator('#btn-reset-wallet');
    await expect(btnReset).toBeVisible();
    await expect(btnReset).toHaveText('Reset Wallet');
    await expect(btnReset).toHaveClass(/btn--danger/);
  });

  test('should show "Welcome back" subtitle in unlock view', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const mockWallet = {
        encryptedMnemonic: 'dGVzdA==',
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY',
        iv: 'dGVzdGl2MTIzNDU2',
        salt: 'dGVzdHNhbHQxMjM0NTY3OA=='
      };
      localStorage.setItem('corvid-wallet', JSON.stringify(mockWallet));
    });

    await page.reload();
    await page.waitForSelector('.setup-view');

    const subtitle = page.locator('.setup-view__subtitle');
    await expect(subtitle).toContainText('Welcome back');
    await expect(subtitle).toContainText('Unlock your wallet to continue');
  });

  test('should have autofocus on the unlock password field', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const mockWallet = {
        encryptedMnemonic: 'dGVzdA==',
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY',
        iv: 'dGVzdGl2MTIzNDU2',
        salt: 'dGVzdHNhbHQxMjM0NTY3OA=='
      };
      localStorage.setItem('corvid-wallet', JSON.stringify(mockWallet));
    });

    await page.reload();
    await page.waitForSelector('.setup-view');

    const unlockPassword = page.locator('#unlock-password');
    await expect(unlockPassword).toHaveAttribute('autofocus', '');
  });

  test('should clear localStorage and return to create view on page load with no wallet', async ({ page }) => {
    await page.goto('/');

    // Ensure localStorage has no wallet
    await page.evaluate(() => {
      localStorage.removeItem('corvid-wallet');
    });

    await page.reload();
    await page.waitForSelector('.setup-view');

    // Should show create view, not unlock view
    const btnCreate = page.locator('#btn-create');
    await expect(btnCreate).toBeVisible();

    const unlockPassword = page.locator('#unlock-password');
    await expect(unlockPassword).toHaveCount(0);
  });
});
