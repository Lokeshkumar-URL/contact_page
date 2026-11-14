import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The dev-server port comes from FRONTEND_PORT in frontend/.env (default 5173).
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const port = Number(env.FRONTEND_PORT) || 5173;
  return { plugins: [react()], server: { port, strictPort: true }, preview: { port, strictPort: true } };
});
