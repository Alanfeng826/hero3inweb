// 零依赖静态服务器 —— 用于本地自托管 VCMI-Web (Heroes III)
// 用法: node serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2] || '8099', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.lod': 'application/octet-stream',
  '.snd': 'application/octet-stream',
  '.vid': 'application/octet-stream',
  '.h3m': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); return res.end('bad url');
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  fs.stat(filePath, (err, st) => {
    if (err || (!st.isFile() && !st.isDirectory())) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + urlPath);
    }

    // 目录索引 —— 与 nginx 的 autoindex_format json 对齐，
    // 供 autoload.js 读取 Data/ 目录里放好的游戏资源（本地版同样免手动选文件）。
    if (st.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, { Location: urlPath + '/' });
        return res.end();
      }
      return fs.readdir(filePath, { withFileTypes: true }, (e2, entries) => {
        if (e2) { res.writeHead(500); return res.end('readdir failed'); }
        const list = entries
          .filter((d) => !d.name.startsWith('.'))
          .map((d) => {
            let size = 0;
            try { if (d.isFile()) size = fs.statSync(path.join(filePath, d.name)).size; } catch (_) { }
            return { name: d.name, type: d.isDirectory() ? 'directory' : 'file', size };
          });
        const body = Buffer.from(JSON.stringify(list, null, 2), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        });
        res.end(body);
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const total = st.size;
    const range = req.headers.range;

    if (range) {                                   // 支持 Range（大文件/懒加载需要）
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] === '' ? total - parseInt(m[2], 10) : parseInt(m[1], 10);
        let end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= total) end = total - 1;
        if (start > end) { res.writeHead(416); return res.end(); }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      // 便于 wasm 多线程/SharedArrayBuffer（当前产物未必用到，保留无害）
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function openBrowser() {
  const url = `http://127.0.0.1:${PORT}/`;
  exec(`start "" "${url}"`, (err) => {
    if (err) console.log(`[homm3-web] 未能自动打开浏览器，请手动访问: ${url}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[homm3-web] 端口 ${PORT} 已有服务在运行，直接打开浏览器。`);
    openBrowser();
    setTimeout(() => process.exit(0), 1200);
  } else {
    console.error(`[homm3-web] 启动失败: ${err.message}`);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('============================================');
  console.log('   英雄无敌 III 网页版（VCMI / 本地）');
  console.log('============================================');
  console.log('');
  console.log(`   地址: http://127.0.0.1:${PORT}/`);
  console.log('   关闭本窗口即停止服务。');
  console.log('');
  if (process.argv.includes('--open')) openBrowser();
});
