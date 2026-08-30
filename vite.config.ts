import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiProxy } from './scripts/aiProxy.js';

export default defineConfig({
  plugins: [react(), aiProxy()],
});
