/** Capture browser errors before entry and enforce clean console output. */
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  expectedTransportErrors: async ({}, use) => { await use([]); },
  browserErrors: [async ({ page, expectedTransportErrors }, use) => {
    const errors = [], pageErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await use(errors);
    const unexpected = errors.filter((message) => !expectedTransportErrors.some((pattern) => pattern.test(message)));
    expect(pageErrors, 'JavaScript page errors are never expected').toEqual([]);
    expect(unexpected, 'Unexpected browser console and page errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
