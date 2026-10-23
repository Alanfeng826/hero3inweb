/* ============================================================================
 * 英雄无敌 III · 网页版 —— 触控板 / 触摸卷动适配 (touch-scroll.js)
 * ----------------------------------------------------------------------------
 * 背景：Mac 触控板双指滑动在浏览器里产生的是 wheel 事件，而引擎没把滚轮绑到地图卷动。
 *
 * 已经验证失败的方案（不要再试）
 *   ① 纯方向键        → 方向键在 H3 里是**英雄行走**，不是卷地图。
 *   ② Ctrl + 方向键   → 真机实测同样在移动英雄。VCMI 文档那句
 *      `[LCtrl] + Arrows — scrolls Adventure Map` 说的是"有窗口盖住地图时"，正常游戏不生效。
 *
 * 现在走第三条路：**模拟引擎原生的「光标贴边停留」**
 *   这是 H3 卷地图的本来机制（也是老冯原本的操作方式）。脚本把合成光标推到
 *   冒险地图视口的边缘并停住，引擎自己就会开始卷动 —— 不依赖任何游戏设置。
 *
 * 四种模式（URL 参数 ?touchscroll=xxx）
 *   edge  （默认）合成光标贴到地图视口边缘，触发引擎原生边缘滚动
 *   drag  合成鼠标左键拖动，1:1 跟手（需开启「左键拖动地图」）
 *   rdrag 合成鼠标右键拖动，1:1 跟手（需开启「右键拖动地图」）
 *   0     关闭
 *
 * 视口比例怎么来的
 *   对老冯的实机截图（1920×1117）逐像素测量：地图星域边界为
 *   左 10 / 上 10 / 右 1655 / 下 1055，换算成比例即下方 EDGE_RATIO 的默认值。
 *   若换了分辨率导致贴边不准，可用 URL 参数覆盖，例如：
 *     ?touchscroll=edge&er=0.862&eb=0.9445
 *   （el=左 et=上 er=右 eb=下，都是相对画布宽高的比例）
 * ========================================================================== */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var MODE = (Q.get('touchscroll') || 'edge').toLowerCase();

  if (MODE === '0' || MODE === 'off' || MODE === 'false') {
    console.log('[H3滚屏] 已通过 ?touchscroll=' + MODE + ' 关闭');
    return;
  }
  if (MODE === 'key' || MODE === 'ctrl') {
    console.warn('[H3滚屏] 方向键方案已证实无效（会移动英雄），改用 edge 模式');
    MODE = 'edge';
  }
  if (MODE !== 'edge' && MODE !== 'drag' && MODE !== 'rdrag') {
    console.warn('[H3滚屏] 未知模式 ' + MODE + '，回退到 edge');
    MODE = 'edge';
  }

  /* ===== 可调参数 ======================================================== */

  var HOLD_MS = 160;      // 手指停下后继续卷多久
  var REPEAT_MS = 50;     // 停在边缘期间重复校正光标的间隔
  var MIN_STEP = 1.5;     // 触发卷动的最小累计位移（像素）
  var EDGE_DEPTH = 4;     // 光标停在地图视口边缘往里多少像素
  var SWEEP_MS = 110;     // 光标扫到边缘的时长（中途会穿过触发区，容错更好）
  var BACK_MS = 90;       // 收尾时光标回到原位的时长
  var DRAG_SCALE = 1.0;   // 拖拽模式位移倍率
  var DRAG_INSET = 0.18;  // 拖拽棘轮阈值

  // 地图视口相对画布的比例（默认值来自 1920×1117 实机截图测量）
  var EDGE_RATIO = {
    left:   num(Q.get('el'), 0.0052),
    top:    num(Q.get('et'), 0.0090),
    right:  num(Q.get('er'), 0.8620),
    bottom: num(Q.get('eb'), 0.9445)
  };

  function num(v, d) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 && n < 1.2 ? n : d;
  }

  var BTN = MODE === 'rdrag' ? { button: 2, mask: 2 } : { button: 0, mask: 1 };

  /* ===== 工具 ============================================================ */

  function log() {
    try { console.log.apply(console, ['[H3滚屏]'].concat([].slice.call(arguments))); }
    catch (e) { /* ignore */ }
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function getCanvas() {
    var c = document.getElementById('canvas');
    if (c) return c;
    var all = document.getElementsByTagName('canvas');
    return all.length ? all[all.length - 1] : null;
  }

  function inCanvas(e, cv) {
    var t = e.target;
    if (!t || !cv) return false;
    return t === cv || (cv.contains && cv.contains(t));
  }

  function toPixels(e) {
    var d = e.deltaMode;
    var f = d === 1 ? 16 : (d === 2 ? 400 : 1);
    return { x: e.deltaX * f, y: e.deltaY * f };
  }

  function defProp(ev, name, val) {
    try { Object.defineProperty(ev, name, { get: function () { return val; } }); } catch (e) { }
  }

  function mouseEvent(type, x, y, button, buttons) {
    var ev;
    try {
      ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: button, buttons: buttons, detail: 1
      });
    } catch (e) {
      ev = document.createEvent('MouseEvents');
      ev.initMouseEvent(type, true, true, window, 1, x, y, x, y,
        false, false, false, false, button, null);
    }
    defProp(ev, 'which', button + 1);
    return ev;
  }

  // 真实指针位置（只认 isTrusted，避免被自己合成的事件污染）
  var lastReal = null;
  window.addEventListener('mousemove', function (e) {
    if (e.isTrusted) lastReal = { x: e.clientX, y: e.clientY };
  }, true);

  /* ===== 地图视口矩形 ==================================================== */

  function mapRect(cv) {
    var r = cv.getBoundingClientRect();
    return {
      left:   r.left + r.width * EDGE_RATIO.left,
      top:    r.top + r.height * EDGE_RATIO.top,
      right:  r.left + r.width * EDGE_RATIO.right,
      bottom: r.top + r.height * EDGE_RATIO.bottom
    };
  }

  function homePoint(cv) {
    var m = mapRect(cv);
    var p = lastReal;
    if (!p || p.x < m.left || p.x > m.right || p.y < m.top || p.y > m.bottom) {
      p = { x: (m.left + m.right) / 2, y: (m.top + m.bottom) / 2 };
    }
    return p;
  }

  /* ===== 模式：合成光标贴边 ============================================== */

  var cur = null;            // 合成光标当前位置
  var heldDir = null;
  var lastWheelAt = 0;
  var accX = 0, accY = 0;
  var holdTimer = null;
  var sweepToken = 0;
  var stats = { wheel: 0, edge: 0, lastTarget: null };

  function sendMove(cv, x, y) {
    cur = { x: x, y: y };
    cv.dispatchEvent(mouseEvent('mousemove', x, y, 0, 0));
  }

  // SDL 只有在收到 mouseover / mouseenter 后才认为鼠标「进入窗口」；
  // 只发 mousemove 可能让它保持在"焦点在窗口外"的状态，边缘滚动就不触发。
  // 每次开始贴边前补一次进入事件，代价极小。
  function ensureHover(cv, x, y) {
    ['mouseover', 'mouseenter', 'pointerover', 'pointerenter'].forEach(function (t) {
      try { cv.dispatchEvent(mouseEvent(t, x, y, 0, 0)); } catch (e) { /* ignore */ }
    });
  }

  function edgeTarget(cv, dir) {
    var m = mapRect(cv);
    var base = cur || homePoint(cv);
    var x = clamp(base.x, m.left + 8, m.right - 8);
    var y = clamp(base.y, m.top + 8, m.bottom - 8);

    if (dir === 'down') y = m.bottom - EDGE_DEPTH;
    else if (dir === 'up') y = m.top + EDGE_DEPTH;
    else if (dir === 'right') x = m.right - EDGE_DEPTH;
    else if (dir === 'left') x = m.left + EDGE_DEPTH;

    return { x: x, y: y };
  }

  // 从当前位置平滑扫到目标点：即使目标略有偏差，中途也会穿过边缘触发区
  function sweepTo(cv, target, ms, cb) {
    var from = cur ? { x: cur.x, y: cur.y } : { x: target.x, y: target.y };
    var token = ++sweepToken;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

    (function step() {
      if (token !== sweepToken) return;
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var k = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
      sendMove(cv, from.x + (target.x - from.x) * k, from.y + (target.y - from.y) * k);
      if (k < 1) requestAnimationFrame(step);
      else if (cb) cb();
    })();
  }

  function edgeEngage(cv, dir) {
    var t = edgeTarget(cv, dir);
    stats.edge++;
    stats.lastTarget = { dir: dir, x: Math.round(t.x), y: Math.round(t.y) };

    if (heldDir !== dir) {
      heldDir = dir;
      ensureHover(cv, t.x, t.y);
      sweepTo(cv, t, SWEEP_MS, null);
    } else {
      // 同方向持续，短暂校正即可
      sendMove(cv, t.x, t.y);
    }

    if (!holdTimer) {
      // 停在边缘反复"报位置"：引擎按帧读取光标位置判断是否贴边
      holdTimer = setInterval(function () {
        if (!heldDir) return;
        var cv2 = getCanvas();
        if (!cv2) return;
        var tt = edgeTarget(cv2, heldDir);
        cv2.dispatchEvent(mouseEvent('mousemove', tt.x, tt.y, 0, 0));
        cur = tt;
      }, REPEAT_MS);
    }
  }

  function edgeRelease() {
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    if (!heldDir) return;
    heldDir = null;
    accX = accY = 0;
    var cv = getCanvas();
    if (!cv) return;
    sweepTo(cv, homePoint(cv), BACK_MS, null);
  }

  /* ===== 模式：合成鼠标拖动 ============================================== */

  var drag = { on: false, x: 0, y: 0, cv: null, moved: 0 };

  function dragStart(cv) {
    var p = homePoint(cv);
    drag.on = true;
    drag.cv = cv;
    drag.moved = 0;
    drag.x = p.x;
    drag.y = p.y;
    cv.dispatchEvent(mouseEvent('mousedown', drag.x, drag.y, BTN.button, BTN.mask));
  }

  function dragMove(dx, dy) {
    var cv = drag.cv;
    if (!cv) return;
    var r = cv.getBoundingClientRect();

    // 拖地图：想看更下面的内容 → 地图往上推 → 指针向上移动
    var nx = drag.x - dx * DRAG_SCALE;
    var ny = drag.y - dy * DRAG_SCALE;

    // 棘轮：快撞到画布内边界时，先结束当前拖拽、从中心重新起手再接着走。
    // 引擎按位移增量平移地图，重起手不会让地图跳。
    var ix = r.width * DRAG_INSET;
    var iy = r.height * DRAG_INSET;
    if (nx < r.left + ix || nx > r.right - ix || ny < r.top + iy || ny > r.bottom - iy) {
      cv.dispatchEvent(mouseEvent('mouseup', drag.x, drag.y, BTN.button, 0));
      drag.x = r.left + r.width / 2;
      drag.y = r.top + r.height / 2;
      drag.moved = 0;
      cv.dispatchEvent(mouseEvent('mousedown', drag.x, drag.y, BTN.button, BTN.mask));
      nx = drag.x - dx * DRAG_SCALE;
      ny = drag.y - dy * DRAG_SCALE;
      nx = clamp(nx, r.left + ix, r.right - ix);
      ny = clamp(ny, r.top + iy, r.bottom - iy);
    }

    drag.x = nx;
    drag.y = ny;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    cv.dispatchEvent(mouseEvent('mousemove', drag.x, drag.y, BTN.button, BTN.mask));
  }

  function dragEnd() {
    if (!drag.on) return;
    var cv = drag.cv;
    drag.on = false;
    drag.cv = null;
    if (!cv) return;
    cv.dispatchEvent(mouseEvent('mouseup', drag.x, drag.y, BTN.button, 0));
    // 指针不能停在边缘，否则会误触发引擎自带的边缘滚动
    var p = homePoint(cv);
    cv.dispatchEvent(mouseEvent('mousemove', p.x, p.y, 0, 0));
  }

  /* ===== 方向判定与空闲收尾 ============================================== */

  function dirOf(dx, dy) {
    if (Math.abs(dy) >= Math.abs(dx)) {
      return Math.abs(dy) >= MIN_STEP ? (dy > 0 ? 'down' : 'up') : null;
    }
    return Math.abs(dx) >= MIN_STEP ? (dx > 0 ? 'right' : 'left') : null;
  }

  function onWheel(e) {
    var cv = getCanvas();
    if (!cv || !inCanvas(e, cv)) return;

    try { e.preventDefault(); } catch (err) { /* passive 时无法阻止 */ }

    stats.wheel++;
    lastWheelAt = Date.now();

    var px = toPixels(e);

    if (MODE === 'edge') {
      accX += px.x;
      accY += px.y;
      var d = dirOf(accX, accY);
      if (d) {
        if (d !== heldDir) { accX = accY = 0; }
        edgeEngage(cv, d);
      }
      return;
    }

    if (!drag.on) dragStart(cv);
    dragMove(px.x, px.y);
  }

  function tickIdle() {
    if (Date.now() - lastWheelAt <= HOLD_MS) return;
    if (MODE === 'edge') { if (heldDir) edgeRelease(); }
    else { if (drag.on) dragEnd(); }
  }

  /* ===== 装配 ============================================================ */

  try {
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  } catch (err) {
    window.addEventListener('wheel', onWheel, true);
  }

  setInterval(tickIdle, 40);

  // 右键拖动期间压掉系统右键菜单
  document.addEventListener('contextmenu', function (e) {
    if (MODE === 'rdrag' && drag.on) e.preventDefault();
  }, true);

  window.addEventListener('blur', function () { edgeRelease(); dragEnd(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { edgeRelease(); dragEnd(); }
  });

  /* ===== 调试接口 ======================================================== */

  window.__h3TouchScroll = {
    mode: MODE,
    ratio: EDGE_RATIO,
    stats: stats,
    get dir() { return heldDir; },
    get dragging() { return drag.on; },
    get pointer() { return cur; },
    mapRect: function () { var cv = getCanvas(); return cv ? mapRect(cv) : null; },
    stop: function () { edgeRelease(); dragEnd(); },
    // 手动跑一次，便于排查：__h3TouchScroll.nudge('down')
    nudge: function (dir) {
      var cv = getCanvas();
      if (!cv) return '没有画布';
      lastWheelAt = Date.now();
      if (MODE === 'edge') edgeEngage(cv, dir || 'down');
      return stats.lastTarget;
    }
  };

  log('已启用，模式 = ' + MODE + (
    MODE === 'edge' ? '（光标贴边，触发引擎原生边缘滚动）'
      : MODE === 'drag' ? '（需在游戏内开启「左键拖动地图」）'
        : '（需在游戏内开启「右键拖动地图」）'));
  log('视口比例:', JSON.stringify(EDGE_RATIO));
})();
