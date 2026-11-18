import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {act, initialState, view} from './domain.mjs';

export function createApp(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS pilot (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO pilot VALUES (1, ?)').run(JSON.stringify(initialState()));
  const read = db.prepare('SELECT data FROM pilot WHERE id = 1');
  const write = db.prepare('UPDATE pilot SET data = ? WHERE id = 1');
  const users = new Map([['demo-store', 'store'], ['demo-driver', 'driver'], ['demo-driver2', 'driver2'], ['demo-admin', 'admin']]);
  const server = createServer(async (req, res) => {
    const send = (status, data) => res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify(data));
    try {
      const id = users.get(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!id) return send(401, {error: 'سجّل الدخول أولًا'});
      if (req.url !== '/api/state') return send(404, {error: 'المسار غير موجود'});
      if (req.method === 'GET') return send(200, view(JSON.parse(read.get().data), id));
      if (req.method !== 'POST') return send(405, {error: 'الطريقة غير مدعومة'});
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) return send(413, {error: 'حجم البيانات كبير'});
      }
      let input;
      try { input = JSON.parse(body); } catch { return send(400, {error: 'بيانات غير صالحة'}); }
      if (!input || typeof input.action !== 'string') return send(400, {error: 'الإجراء مطلوب'});
      db.exec('BEGIN IMMEDIATE');
      try {
        const state = JSON.parse(read.get().data);
        act(state, id, input);
        const result = view(state, id);
        write.run(JSON.stringify(state));
        db.exec('COMMIT');
        return send(200, result);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      if (!error.status) console.error(error);
      return send(error.status || 500, {error: error.status ? error.message : 'تعذر تنفيذ الإجراء'});
    }
  });
  server.once('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4100);
  const host = process.env.DELIVERY_DEMO_HOST || '127.0.0.1';
  createApp(process.env.DELIVERY_DEMO_DB || 'delivery.sqlite').listen(port, host, () => {
    console.log(`Delivery demo listening at http://${host}:${port}`);
  });
}
