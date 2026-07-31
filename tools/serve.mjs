// 개발용 정적 서버. 외부 의존성 0.
//
// `python -m http.server` 를 쓰면 안 되는 이유: no-cache 헤더를 보내지 않아서
// 브라우저가 ES 모듈을 계속 캐시한다. 소스를 고치고 새로고침해도 옛날 코드가 돌아가서
// "고쳤는데 왜 그대로지?" 로 시간을 잡아먹는다. 여기서는 항상 no-store 로 응답한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('bad request'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(ROOT, pathname);
  // 루트 밖으로 나가는 경로 차단
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 ${pathname}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
    });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`용병단 개발 서버: http://localhost:${PORT}  (root: ${ROOT})`));
