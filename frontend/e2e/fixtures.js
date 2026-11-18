/** Capture browser errors before entry and enforce clean console output. */
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
    expect(errors, 'Browser console and page errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
