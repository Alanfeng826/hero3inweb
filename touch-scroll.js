/* ============================================================================
 * 英雄无敌 III · 网页版 —— 触控板 / 触摸卷动适配 (touch-scroll.js)
 * ----------------------------------------------------------------------------
 * 解决什么问题
 *   Mac 触控板双指滑动在浏览器里产生的是 wheel 事件，而 VCMI 引擎没有把滚轮
 *   绑定到冒险地图卷动（引擎里只有「边缘滚动 / 左键拖动地图 / 方向键」这几条路）。
 *   本脚本拦截 wheel 事件，翻译成引擎认识的方向键，从而让双指滑动卷动地图。
 *
 * 两种模式（用 URL 参数切换）
 *   ?touchscroll=key    （默认）wheel → 合成方向键按住。不依赖任何游戏内设置。
 *   ?touchscroll=drag   wheel → 合成鼠标左键拖动。手感 1:1，更接近触屏，
 *                       但需要先在「系统选项 → 冒险地图」勾上「左键拖动地图」。
 *   ?touchscroll=0      完全关闭（等价于删掉 index.html 里那行 script）
 *
 * 为什么用方向键
 *   VCMI 官方文档：`[LCtrl] + Arrows — scrolls Adventure Map`，方向键是原生的
 *   地图卷动机制。合成键盘事件不需要改引擎，也不依赖任何设置项。
 *
 * 安全性
 *   只在游戏画布存在时才会介入；启动器页面（无画布）自动不生效。
 *   全程只读监听 + preventDefault 阻止浏览器自身的页面滚动/侧滑返回，
 *   不改动启动器、不改动引擎文件。
 * ========================================================================== */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var MODE = (Q.get('touchscroll') || 'key').toLowerCase();

  if (MODE === '0' || MODE === 'off' || MODE === 'false') {
    console.log('[H3滚屏] 已通过 ?touchscroll=' + MODE + ' 关闭');
    return;
  }
  if (MODE !== 'key' && MODE !== 'drag') {
    console.warn('[H3滚屏] 未知模式 ' + MODE + '，回退到 key');
    MODE = 'key';
  }

  /* ===== 可调参数 ======================================================== */

  var HOLD_MS = 130;      // 手指停下后，方向键继续按住多久（越大越"滑")
  var REPEAT_MS = 55;     // 按住期间重复派发 keydown 的间隔（兼容事件式处理）
  var MIN_STEP = 1.5;     // 触发滚动的最小累计位移（像素）
  var DRAG_SCALE = 1.0;   // drag 模式：滚动位移 → 拖动位移的倍率

  var KEYMAP = {
    up:    { code: 38, key: 'ArrowUp' },
    down:  { code: 40, key: 'ArrowDown' },
    left:  { code: 37, key: 'ArrowLeft' },
    right: { code: 39, key: 'ArrowRight' }
  };

  /* ===== 工具 ============================================================ */

  function log() {
    try { console.log.apply(console, ['[H3滚屏]'].concat([].slice.call(arguments))); }
    catch (e) { /* ignore */ }
  }

  function getCanvas() {
    var c = document.getElementById('canvas');
    if (c) return c;
    var all = document.getElementsByTagName('canvas');
    return all.length ? all[all.length - 1] : null;
  }

  // 事件是否发生在游戏画布上
  function inCanvas(e, cv) {
    var t = e.target;
    if (!t || !cv) return false;
    return t === cv || (cv.contains && cv.contains(t));
  }

  // 归一化 wheel 位移到像素
  function toPixels(e) {
    var d = e.deltaMode;
    var f = d === 1 ? 16 : (d === 2 ? 400 : 1);
    return { x: e.deltaX * f, y: e.deltaY * f };
  }

  function makeKeyEvent(type, k) {
    var ev;
    try {
      ev = new KeyboardEvent(type, {
        key: k.key, code: k.key, bubbles: true, cancelable: true, view: window
      });
    } catch (err) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, true);
    }
    // KeyboardEvent 构造器不接受 keyCode/which，只能事后补上（老式处理逻辑读这两个）
    try { Object.defineProperty(ev, 'keyCode', { get: function () { return k.code; } }); } catch (e2) { }
    try { Object.defineProperty(ev, 'which', { get: function () { return k.code; } }); } catch (e2) { }
    return ev;
  }

  function makeMouseEvent(type, x, y, buttons) {
    var init = {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y,
      screenX: x, screenY: y,
      button: 0, buttons: buttons, detail: 1
    };
    try { return new MouseEvent(type, init); }
    catch (e) {
      var ev = document.createEvent('MouseEvents');
      ev.initMouseEvent(type, true, true, window, 1, x, y, x, y,
        false, false, false, false, 0, null);
      return ev;
    }
  }

  // 派发目标：画布（bubbles=true 会自动冒泡到 document / window，覆盖各种注册方式）
  function target() {
    return getCanvas() || document.body || document;
  }

  /* ===== 模式一：wheel → 方向键按住 ====================================== */

  var held = null;          // 当前按住的方向名
  var lastWheelAt = 0;
  var accX = 0, accY = 0;
  var repeatTimer = null;
  var idleTimer = null;
  var stats = { wheel: 0, press: 0 };

  function press(dir) {
    if (held === dir) return;
    release();
    held = dir;
    stats.press++;
    var k = KEYMAP[dir];
    target().dispatchEvent(makeKeyEvent('keydown', k));
    // 事件式处理逻辑需要重复事件才能持续滚动；状态式逻辑则无副作用
    repeatTimer = setInterval(function () {
      if (held !== dir) return;
      // 注意：重复派发的是 keydown，不派发 keyup，避免"松手抖动"
      target().dispatchEvent(makeKeyEvent('keydown', k));
    }, REPEAT_MS);
  }

  function release() {
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
    if (!held) return;
    var k = KEYMAP[held];
    held = null;
    target().dispatchEvent(makeKeyEvent('keyup', k));
  }

  function tickIdle() {
    if (!held) return;
    if (Date.now() - lastWheelAt > HOLD_MS) {
      release();
      accX = accY = 0;
    }
  }

  function handleWheelKey(e, cv) {
    var px = toPixels(e);
    accX += px.x;
    accY += px.y;
    lastWheelAt = Date.now();
    stats.wheel++;

    var dir = null;
    if (Math.abs(accY) >= Math.abs(accX)) {
      if (Math.abs(accY) >= MIN_STEP) dir = accY > 0 ? 'down' : 'up';
    } else {
      if (Math.abs(accX) >= MIN_STEP) dir = accX > 0 ? 'right' : 'left';
    }

    if (dir) {
      if (dir !== held) { accX = accY = 0; }
      press(dir);
    }
  }

  /* ===== 模式二：wheel → 合成鼠标左键拖动 ================================ */

  var drag = { on: false, x: 0, y: 0, cv: null, moved: 0 };

  function dragStart(cv) {
    var r = cv.getBoundingClientRect();
    drag.on = true;
    drag.cv = cv;
    drag.moved = 0;
    drag.x = r.left + r.width / 2;      // 从画布中心起手
    drag.y = r.top + r.height / 2;
    cv.dispatchEvent(makeMouseEvent('mousedown', drag.x, drag.y, 1));
  }

  function dragMove(dx, dy) {
    var cv = drag.cv;
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    // 拖地图：想看到更下面的内容 → 把地图往上推 → 指针向上移动
    drag.x = Math.min(Math.max(drag.x - dx * DRAG_SCALE, r.left + 2), r.right - 2);
    drag.y = Math.min(Math.max(drag.y - dy * DRAG_SCALE, r.top + 2), r.bottom - 2);
    drag.moved += Math.abs(dx) + Math.abs(dy);
    cv.dispatchEvent(makeMouseEvent('mousemove', drag.x, drag.y, 1));
  }

  function dragEnd() {
    if (!drag.on) return;
    var cv = drag.cv;
    drag.on = false;
    drag.cv = null;
    if (cv) {
      cv.dispatchEvent(makeMouseEvent('mouseup', drag.x, drag.y, 0));
    }
  }

  function handleWheelDrag(e) {
    var cv = getCanvas();
    if (!cv) return;
    var px = toPixels(e);
    if (!drag.on) dragStart(cv);
    dragMove(px.x, px.y);
    lastWheelAt = Date.now();
    stats.wheel++;
  }

  function tickIdleDrag() {
    if (!drag.on) return;
    if (Date.now() - lastWheelAt > HOLD_MS) dragEnd();
  }

  /* ===== 统一入口 ======================================================== */

  function onWheel(e) {
    var cv = getCanvas();
    if (!cv || !inCanvas(e, cv)) return;          // 不在画布上就完全不管

    // 阻止浏览器自身行为：页面滚动、触控板侧滑返回上一页
    try { e.preventDefault(); } catch (err) { /* passive 时无法阻止，忽略 */ }

    if (MODE === 'drag') handleWheelDrag(e);
    else handleWheelKey(e, cv);
  }

  try {
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  } catch (err) {
    window.addEventListener('wheel', onWheel, true);
  }

  setInterval(function () {
    if (MODE === 'drag') tickIdleDrag(); else tickIdle();
  }, 40);

  // 页面失焦 / 画布被移除时，确保按键状态被释放，避免"卡住一直滚"
  window.addEventListener('blur', function () { release(); dragEnd(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { release(); dragEnd(); }
  });

  /* ===== 对外接口（调试用） ============================================== */

  window.__h3TouchScroll = {
    mode: MODE,
    stats: stats,
    get held() { return held; },
    get dragging() { return drag.on; },
    stop: function () { release(); dragEnd(); },
    // 手动模拟一次滚动，便于排查：__h3TouchScroll.nudge('down', 3)
    nudge: function (dir, times) {
      var n = times || 1;
      for (var i = 0; i < n; i++) {
        (function (ii) {
          setTimeout(function () {
            lastWheelAt = Date.now();
            press(dir);
          }, ii * 90);
        })(i);
      }
      setTimeout(release, n * 90 + HOLD_MS);
    }
  };

  log('已启用，模式 = ' + MODE +
    (MODE === 'drag' ? '（需在游戏内开启「左键拖动地图」）' : '（不依赖游戏内设置）'));
})();
