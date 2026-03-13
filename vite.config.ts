
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const LOG_ROUTE = '/__monitor-log';

function systemMonitorFileLogger(): Plugin {
  return {
    name: 'system-monitor-file-logger',
    apply: 'serve',
    configureServer(server) {
      const projectRoot = server.config.root;
      const logDir = path.join(projectRoot, 'logs');
      const logFile = path.join(logDir, 'system-monitor.log');

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(logFile, `\n=== DEV SERVER START ${new Date().toISOString()} ===\n`);

      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || req.url !== LOG_ROUTE) {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });

        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}') as { timestamp?: string; message?: string };
            const timestamp = payload.timestamp || new Date().toISOString();
            const rawMessage = payload.message || '';
            const message = rawMessage.replace(/[\r\n]+/g, ' ').trim();

            if (message) {
              fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
            }

            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end('Invalid payload');
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), systemMonitorFileLogger()],
  define: {
    'process.env': {}
  },
  server: {
    port: 5173,
    host: true
  }
});
