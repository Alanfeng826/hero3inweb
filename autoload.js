/* ============================================================================
 * 英雄无敌 III · 网页版 —— 服务器资源自动装载 (autoload.js)
 * ----------------------------------------------------------------------------
 * 作用
 *   服务器 Data/ 目录里放好游戏资源后，网页自动把它装载进启动器，
 *   免去每次开始游戏前手动挑选 7 个文件（合计约 257 MB）。
 *
 * 原理
 *   启动器的"从设备上传文件"是一个 <input type="file" name="game-file">，
 *   它按"文件名（小写）"识别所需的 7 个文件。本脚本在页面加载后：
 *     1. 从服务器 Data/ 目录取这些文件（若上次已缓存，则直接从本地缓存取）；
 *     2. 就地构造成 File 对象，投递给同一个输入框并触发 change；
 *     3. 自此交给启动器自己的流程 —— 校验、写入缓存、界面切换到"文件已就绪"。
 *   全程不修改启动器代码，也不依赖它的内部实现。
 *
 * 缓存
 *   启动器会把文件写进 IndexedDB（库 vcmi-files / store files）供下次直接恢复。
 *   本脚本同样读写这份缓存：命中即跳过网络下载，第二次进入几乎瞬时完成；
 *   并且即使启动器恢复失败，也能从缓存立即重新投递。
 *
 * 静默退出（绝不干扰启动器自带的手动选文件流程）
 *   · 加了 ?autoload=0
 *   · 启动器没有渲染出"上传文件"输入框（说明它已就绪）
 *   · Data/ 目录不存在、或里面没有可识别的游戏资源
 *   · 环境缺少 DataTransfer / fetch 等必要能力
 * ========================================================================== */
(function () {
  'use strict';

  /* ===== 常量 ============================================================ */

  var DB_NAME = 'vcmi-files';   // 启动器的文件缓存库
  var DB_VERSION = 1;
  var STORE = 'files';

  var DATA_DIR = 'Data/';       // 服务器上的资源目录（相对本站根，兼容子路径部署）
  var UI_ID = 'h3-preload';
  var WAIT_MS = 30000;          // 等待启动器渲染出上传界面的上限

  // 启动器需要的 7 个文件：键 = 小写文件名（它的匹配规则），值 = 官方文件名。
  var REQUIRED = {
    'h3bitmap.lod': 'H3bitmap.lod',
    'h3sprite.lod': 'H3sprite.lod',
    'h3ab_bmp.lod': 'H3ab_bmp.lod',
    'video.vid': 'VIDEO.VID',
    'heroes3.snd': 'Heroes3.snd',
    'h3ab_spr.lod': 'H3ab_spr.lod',
    'h3ab_ahd.snd': 'H3ab_ahd.snd'
  };
  var KEYS = Object.keys(REQUIRED);

  // 站内根路径，兼容 / 与 /hero3inweb/ 这类子路径部署
  var BASE = location.origin + location.pathname.replace(/[^/]*$/, '');

  /* ===== 小工具 ========================================================== */

  function log() {
    try { console.log.apply(console, ['[H3预载]'].concat([].slice.call(arguments))); }
    catch (e) { /* ignore */ }
  }

  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

  function aborted() {
    try { return new URLSearchParams(location.search).get('autoload') === '0'; }
    catch (e) { return false; }
  }

  /* ===== 本地缓存（IndexedDB，与启动器同库同结构） ======================= */

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }

      req.onerror = function () { reject(req.error || new Error('IndexedDB 打不开')); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function () {
        var db = req.result;
        db.onerror = function () { /* ignore */ };
        try {
          var st = db.createObjectStore(STORE);
          st.createIndex('key', '', { unique: true, multiEntry: false });
        } catch (e) { /* 已存在则忽略 */ }
      };
    });
  }

  // 返回 { 小写文件名: Blob|null }
  function readBlobs(db, keys) {
    return new Promise(function (resolve) {
      var out = {}, left = keys.length;
      if (!left) return resolve(out);

      var tx;
      try { tx = db.transaction(STORE, 'readonly'); }
      catch (e) { return resolve(out); }
      var st = tx.objectStore(STORE);

      keys.forEach(function (k) {
        var r;
        try { r = st.get(k); }
        catch (e) { out[k] = null; if (!--left) resolve(out); return; }

        r.onsuccess = function () {
          var v = r.result;
          out[k] = !v ? null : (v instanceof Blob ? v : new Blob([v]));
          if (!--left) resolve(out);
        };
        r.onerror = function () {
          out[k] = null;
          if (!--left) resolve(out);
        };
      });
    });
  }

  function putBlob(db, key, blob) {
    return new Promise(function (resolve) {
      var tx;
      try { tx = db.transaction(STORE, 'readwrite'); }
      catch (e) { return resolve(); }
      var r = tx.objectStore(STORE).put(blob, key);
      r.onsuccess = function () { resolve(); };
      r.onerror = function () { resolve(); };        // 缓存写失败不影响主流程
    });
  }

  /* ===== 读取服务器资源清单 ============================================== */

  // 优先读目录索引（nginx autoindex_format json 或 serve.js 内置接口），
  // 拿不到时退回逐文件名探测，换任何静态托管都能工作。
  function listServerFiles() {
    return listDir(DATA_DIR, true).catch(function (e) {
      log('目录索引不可用（' + (e && e.message) + '），改用逐文件探测');
      return probeFiles();
    });
  }

  function listDir(dir, allowNested) {
    return fetch(BASE + dir, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var arr = JSON.parse(txt);                        // 非 JSON 直接抛错 → 降级
      if (!Array.isArray(arr)) throw new Error('目录索引格式异常');

      var dirs = [], fs = [];
      arr.forEach(function (it) {
        if (!it || !it.name || it.name.charAt(0) === '.') return;
        if (it.type === 'directory') dirs.push(it.name);
        else if (it.type === 'file') fs.push({ name: it.name, size: Number(it.size) || 0 });
      });

      // 兼容：可能把整个 Data 目录层级一起传上来，形成 Data/Data/xxx
      if (!fs.length && allowNested && dirs.some(function (d) { return /^data$/i.test(d); })) {
        log('检测到 Data/Data/ 层级，自动下探一层');
        return listDir(dir + 'Data/', false);
      }

      return fs.map(function (f) {
        return { name: f.name, size: f.size, url: BASE + dir + encodeURIComponent(f.name) };
      });
    });
  }

  // 降级：先探一个最可能的文件确认目录存在，再逐个 HEAD
  function probeFiles() {
    return head(BASE + DATA_DIR + 'H3bitmap.lod').then(function (hit) {
      if (!hit) return [];                              // 目录不存在 → 干脆放弃

      var cands = [];
      KEYS.forEach(function (k) { cands.push(k, REQUIRED[k], k.toUpperCase()); });
      cands = cands.filter(function (v, i) { return cands.indexOf(v) === i; });

      return Promise.all(cands.map(function (n) {
        var url = BASE + DATA_DIR + encodeURIComponent(n);
        return head(url).then(function (sz) { return sz ? { name: n, size: sz, url: url } : null; });
      })).then(function (list) {
        var seen = {}, out = [];
        list.forEach(function (f) {
          if (!f) return;
          var k = f.name.toLowerCase();
          if (seen[k]) return;
          seen[k] = 1;
          out.push(f);
        });
        return out;
      });
    });
  }

  function head(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      return r.ok ? (Number(r.headers.get('Content-Length')) || 0) : null;
    }).catch(function () { return null; });
  }

  /* ===== 比对：哪些要下载、哪些已缓存、哪些服务器上就缺 ================== */

  function plan(files, cached) {
    var byKey = {};
    files.forEach(function (f) { byKey[f.name.toLowerCase()] = f; });

    var todo = [], missing = [], hit = 0;

    KEYS.forEach(function (k) {
      var f = byKey[k];
      if (!f) { missing.push(REQUIRED[k]); return; }

      var b = cached[k];
      if (b && (f.size <= 0 || b.size === f.size)) { hit++; return; }

      todo.push({ key: k, label: REQUIRED[k], url: f.url, size: f.size });
    });

    return { todo: todo, missing: missing, hit: hit };
  }

  /* ===== 进度浮层 ======================================================== */

  function createUI() {
    var el = document.createElement('div');
    el.id = UI_ID;
    el.setAttribute('style', [
      'position:fixed', 'z-index:2147483647',
      'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
      'width:min(580px,calc(100vw - 32px))', 'box-sizing:border-box',
      'padding:14px 18px 15px', 'border-radius:12px',
      'background:rgba(20,18,30,.95)',
      'border:1px solid rgba(214,182,110,.45)',
      'box-shadow:0 12px 44px rgba(0,0,0,.6)',
      'color:#f2ead6', 'backdrop-filter:blur(6px)',
      'font:14px/1.5 "Microsoft YaHei","PingFang SC",system-ui,sans-serif'
    ].join(';'));

    el.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:9px">' +
      '<span style="color:#e8c877;font-weight:600" data-h3="title">正在从服务器预载游戏资源</span>' +
      '<span style="margin-left:auto;color:#b9ae95;font-size:12px;white-space:nowrap" data-h3="pct"></span>' +
      '</div>' +
      '<div style="height:8px;border-radius:4px;background:rgba(255,255,255,.13);overflow:hidden">' +
      '<div data-h3="bar" style="height:100%;width:0%;border-radius:4px;' +
      'background:linear-gradient(90deg,#b98f2c,#f0d98a);transition:width .18s linear"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:9px;font-size:12px;color:#b9ae95">' +
      '<span data-h3="sub" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>' +
      '<a href="javascript:void(0)" data-h3="cancel" style="color:#d9b45e;text-decoration:underline;flex:none">取消，我手动选</a>' +
      '</div>';

    document.body.appendChild(el);

    var q = function (n) { return el.querySelector('[data-h3="' + n + '"]'); };
    var onCancel = null;
    q('cancel').addEventListener('click', function () {
      if (onCancel) onCancel();
      if (el.parentNode) el.parentNode.removeChild(el);
    });

    return {
      set: function (pct, title, sub) {
        if (title) q('title').textContent = title;
        if (sub != null) q('sub').textContent = sub;
        var p = Math.max(0, Math.min(100, Math.round(pct)));
        q('bar').style.width = p + '%';
        q('pct').textContent = p + '%';
      },
      error: function (title, sub) {
        q('title').textContent = title;
        q('title').style.color = '#ff9b8a';
        q('sub').textContent = sub || '';
        q('bar').style.background = '#a04434';
        q('cancel').textContent = '关闭';
      },
      onCancel: function (fn) { onCancel = fn; },
      hideCancel: function () { q('cancel').style.display = 'none'; },
      remove: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ===== 下载（带进度、可取消） ========================================== */

  function download(url, onProgress, signal) {
    return fetch(url, { cache: 'default', signal: signal }).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status + '  ' + url);

      var total = Number(resp.headers.get('Content-Length')) || 0;

      // 环境不支持流式读取时退化为一次性读取
      if (!resp.body || typeof resp.body.getReader !== 'function') {
        return resp.blob().then(function (b) { onProgress(b.size, b.size); return b; });
      }

      var reader = resp.body.getReader();
      var chunks = [], got = 0;
      onProgress(0, total);

      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks);
          chunks.push(r.value);
          got += r.value.byteLength;
          onProgress(got, total);
          return pump();
        });
      })();
    });
  }

  /* ===== 投递给启动器的文件输入框 ======================================== */

  function inject(blobs) {
    if (typeof DataTransfer === 'undefined') return '本浏览器不支持 DataTransfer';

    var dt = new DataTransfer();
    var n = 0;
    KEYS.forEach(function (k) {
      var b = blobs[k];
      if (!b) return;
      dt.items.add(new File([b], REQUIRED[k], { type: 'application/octet-stream' }));
      n++;
    });
    if (!n) return '没有任何可用文件';

    var input = document.querySelector('input[name="game-file"]');
    if (!input) return '启动器的文件输入框已不存在';

    try {
      input.files = dt.files;
    } catch (e) {
      try {
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
      } catch (e2) {
        return '无法写入 input.files：' + ((e2 && e2.message) || e2);
      }
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return null;   // null = 成功
  }

  /* ===== 等待启动器渲染出上传界面 ======================================== */

  function waitForInput(timeout) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function check() {
        var el = document.querySelector('input[name="game-file"]');
        if (el) return resolve(el);
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(check, 300);
      })();
    });
  }

  /* ===== 主流程 ========================================================== */

  function main() {
    if (aborted()) { log('已通过 ?autoload=0 关闭'); return; }
    if (typeof indexedDB === 'undefined') { log('环境不支持 IndexedDB，跳过'); return; }

    // 请求持久化存储，避免浏览器在磁盘紧张时清掉这份几百 MB 的缓存
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function (ok) { log('持久化存储：' + ok); }).catch(function () { });
      }
    } catch (e) { /* ignore */ }

    waitForInput(WAIT_MS).then(function (input) {
      if (!input) { log('启动器未请求手动选文件（已就绪），无需介入'); return; }

      return listServerFiles().then(function (files) {
        if (!files.length) {
          log('Data/ 目录没有可用资源，请手动选择文件');
          return;
        }
        log('服务器资源目录发现 ' + files.length + ' 个文件');

        return openDB().then(function (db) {
          return readBlobs(db, KEYS).then(function (cached) {
            var p = plan(files, cached);

            if (p.missing.length) log('服务器上缺少：' + p.missing.join('、'));
            if (p.hit) log('本地缓存命中 ' + p.hit + '/' + KEYS.length);

            if (!p.todo.length) {
              log('无需下载，直接用本地缓存装载');
              try { db.close(); } catch (e) { /* ignore */ }
              return deliver(cached);
            }
            return run(db, cached, p);
          });
        });
      });
    }).catch(function (e) {
      log('跳过预载：' + ((e && e.message) || e));
    });
  }

  // 下载缺失的部分，再统一装载
  function run(db, blobs, p) {
    var ui = createUI();
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;

    var totalBytes = p.todo.reduce(function (a, b) { return a + (b.size || 0); }, 0);
    var doneBytes = 0;
    var i = 0;
    var t0 = Date.now();

    ui.onCancel(function () {
      if (ctrl) ctrl.abort();
      log('用户取消了预载，转手动选文件');
    });

    function render(got) {
      var pct = totalBytes > 0 ? Math.min(100, 100 * (doneBytes + got) / totalBytes) : 0;
      var secs = (Date.now() - t0) / 1000;
      var speed = secs > 1 ? (doneBytes + got) / secs : 0;
      ui.set(pct, '正在从服务器预载游戏资源',
        '第 ' + (i + 1) + '/' + p.todo.length + ' 个 · ' + p.todo[i].label + '  ' +
        mb(doneBytes + got) + (totalBytes ? ' / ' + mb(totalBytes) : '') +
        (speed > 0 ? '  ·  ' + mb(speed) + '/s' : ''));
    }

    function step() {
      if (i >= p.todo.length) return finish();

      var item = p.todo[i];
      render(0);

      // URL 带上文件大小作版本号：服务器上换了资源（大小随之变化）就会绕过 HTTP 缓存重新取，
      // 大小没变时则能直接命中浏览器磁盘缓存，省掉一次重新下载。
      var url = item.url + (item.size > 0 ? '?v=' + item.size : '');

      download(url, render, ctrl && ctrl.signal)
        .then(function (blob) {
          doneBytes += blob.size;
          blobs[item.key] = blob;
          return putBlob(db, item.key, blob);          // 顺手留下本地缓存
        })
        .then(function () { i++; step(); })
        .catch(function (e) {
          if (e && e.name === 'AbortError') { try { db.close(); } catch (x) { /* ignore */ } return; }
          log('下载失败：' + item.label + ' — ' + ((e && e.message) || e));
          ui.error('预载中断：' + item.label,
            '请检查服务器 Data/ 目录是否可访问，或点下面的“取消”手动选文件。');
        });
    }

    function finish() {
      try { db.close(); } catch (e) { /* ignore */ }
      deliver(blobs, ui, doneBytes, p);
    }

    step();
  }

  // 把拿到的文件投递给启动器，并等它消费掉输入框
  function deliver(blobs, ui, doneBytes, p) {
    var own = !ui;
    if (own) ui = createUI();

    if (p && p.missing.length) {
      log('服务器上仍缺：' + p.missing.join('、') + '（这些需手动补）');
    }

    ui.hideCancel();
    ui.set(100, '正在装载到启动器…',
      '共 ' + Object.keys(blobs).filter(function (k) { return !!blobs[k]; }).length + ' 个文件' +
      (doneBytes ? ' · ' + mb(doneBytes) : ''));

    var err = inject(blobs);
    if (err) {
      log('装载失败：' + err);
      ui.error('装载失败', err + ' —— 请手动选择文件。');
      return;
    }

    var t0 = Date.now();
    (function watch() {
      if (!document.querySelector('input[name="game-file"]')) {
        ui.remove();
        log('装载完成，启动器已就绪');
        return;
      }
      if (Date.now() - t0 > 120000) { ui.remove(); log('等待启动器处理超时'); return; }
      setTimeout(watch, 400);
    })();
  }

  /* ===== 启动 ============================================================ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
