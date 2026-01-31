
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env': {}
  },
  server: {
    port: 5173,
    host: true
  }
});
