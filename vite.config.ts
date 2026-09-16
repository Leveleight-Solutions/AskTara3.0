import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const apiPort = env.PORT ?? '3001';
  const webPort = Number(env.WEB_PORT ?? 5173);
  return {
    plugins: [react()],
    server: { port: webPort, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
    build: { outDir: 'dist' },
  };
});
