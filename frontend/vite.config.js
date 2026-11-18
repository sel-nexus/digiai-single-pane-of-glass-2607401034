/** Configure independent frontend builds, backend proxy and component tests. */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: { host: env.DEV_HOST || '0.0.0.0', port: Number(env.DEV_PORT || 5173), strictPort: true, proxy: { '/api': { target: env.DEV_API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true } } },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.js'], include: ['src/**/*.test.{js,jsx}'] },
  };
});
