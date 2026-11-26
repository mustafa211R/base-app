import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { ApiError, exportFullExcelBuffer, handleBaseAction } from './server/logic.ts';
import { generateProjectBundleZip } from './server/codeBundle.ts';

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: 'text/plain', limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, data: { name: 'base-api', version: 1 } });
  });

  app.post('/api/base', (req, res) => {
    let body: Record<string, unknown> = {};
    try {
      if (typeof req.body === 'string') {
        body = JSON.parse(req.body || '{}');
      } else if (req.body && typeof req.body === 'object') {
        body = req.body as Record<string, unknown>;
      }
    } catch {
      res.status(400).json({ ok: false, error: 'BAD_JSON' });
      return;
    }

    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const token = bearer || (typeof body.token === 'string' ? body.token : undefined);
    const action = typeof body.action === 'string' ? body.action : '';

    try {
      const data = handleBaseAction(action, body, token);
      res.json({ ok: true, data });
    } catch (err) {
      if (err instanceof ApiError) {
        res.json({ ok: false, error: err.code, meta: err.meta });
      } else {
        console.error('Server error in /api/base:', err);
        res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
      }
    }
  });

  app.post('/api/backup/export', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : typeof req.body?.token === 'string'
        ? req.body.token
        : '';

    try {
      // Enforce admin session via handleBaseAction('admin.dashboard', ...)
      handleBaseAction('admin.dashboard', {}, token);
      const buf = exportFullExcelBuffer();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="base_backup_${stamp}.xlsx"`);
      res.send(buf);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'FORBIDDEN';
      res.status(403).json({ ok: false, error: code });
    }
  });

  app.post('/api/bundle/export', async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    try {
      handleBaseAction('admin.dashboard', {}, token);
      const buf = await generateProjectBundleZip();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="base-system-bundle.zip"');
      res.send(buf);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'FORBIDDEN';
      res.status(403).json({ ok: false, error: code });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`base School Management System running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
