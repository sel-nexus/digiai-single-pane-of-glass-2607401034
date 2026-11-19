/** Reuse real-server configuration for the standalone UI evidence capture. */
import config from './playwright.config.js';
export default { ...config, testDir: '.', testMatch: 'preflight-modern.spec.js', projects: [config.projects[0]] };
