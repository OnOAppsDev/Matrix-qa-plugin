// Demo application for the plugin's end-to-end check. Not part of a QA repository.
//   node server.mjs <port> [--bug]
// The demo user's credentials come from DEMO_USER_EMAIL / DEMO_USER_PASSWORD.
// --bug makes the invalid-credentials message differ from the LLD, to produce a real application-defect failure.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 4173);
const bug = process.argv.includes('--bug');
const page = (name) => readFileSync(join(here, name));

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/login') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { email, password } = JSON.parse(body || '{}');
      const ok = email === process.env.DEMO_USER_EMAIL && password === process.env.DEMO_USER_PASSWORD;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(ok ? { name: 'דנה' } : { message: bug && email === process.env.DEMO_USER_EMAIL ? 'הסיסמה שגויה' : 'הדוא"ל או הסיסמה שגויים' }));
    });
    return;
  }
  const routes = { '/login': 'login.html', '/dashboard': 'dashboard.html' };
  const file = routes[req.url.split('?')[0]];
  if (!file) {
    res.writeHead(302, { location: '/login' });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(file));
}).listen(port, '127.0.0.1', () => console.log(`demo app on http://127.0.0.1:${port}`));
