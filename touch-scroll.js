/* ============================================================================
 * 英雄无敌 III · 网页版 —— 触控板 / 触摸卷动适配 (touch-scroll.js)
 * ----------------------------------------------------------------------------
 * 解决什么问题
 *   Mac 触控板双指滑动在浏览器里产生的是 wheel 事件，引擎没有把滚轮绑到地图卷动。
 *   本脚本把 wheel 翻译成引擎认识的操作，让双指滑动卷动冒险地图。
 *
 * ⚠️ 为什么不翻译成"方向键"
 *   H3 里**方向键控制的是英雄行走，不是卷地图**。VCMI 官方文档写的是
 *   `[LCtrl] + Arrows — scrolls Adventure Map`，带 LCtrl 才是卷地图。
 *   不带 Ctrl 的纯方向键会把英雄走出来 —— 这是踩过的坑，不要再改回去。
 *
 * 四种模式（URL 参数 ?touchscroll=xxx）
 *   ctrl   （默认）Ctrl + 方向键 → 卷地图。依官方文档，不需要改任何游戏设置。
 *   drag   wheel → 合成**鼠标左键拖动**，1:1 跟手。
 *          需先在「系统选项 → 冒险地图」勾上「左键拖动地图」。
 *   rdrag  wheel → 合成**鼠标右键拖动**，同样 1:1。
 *          需勾上「右键拖动地图」。好处是不会和"左键点地面移动英雄"冲突。
 *   0      关闭（等价于删掉 index.html 里那行 script）
 *
 * 关键设计
 *   · 拖拽式（drag / rdrag）是**按位移增量**生效的，所以长距离滑动时做"棘轮"：
 *     指针快撞到画布内边界时，先 mouseup 再从中心重新 mousedown，接着拖。
 *     因为引擎只吃增量、不认绝对坐标，重起手不会让地图跳。
 *   · 松手后把指针送回中心/原位，否则指针停在边缘会误触发引擎自带的「边缘滚动」。
 *   · 全程 preventDefault，挡掉浏览器页面滚动和触控板横滑返回上一页。
 * ========================================================================== */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var MODE = (Q.get('touchscroll') || 'ctrl').toLowerCase();

  if (MODE === '0' || MODE === 'off' || MODE === 'false') {
    console.log('[H3滚屏] 已通过 ?touchscroll=' + MODE + ' 关闭');
    return;
  }
  // 兼容旧参数名
  if (MODE === 'key') MODE = 'ctrl';
  if (MODE !== 'ctrl' && MODE !== 'drag' && MODE !== 'rdrag') {
    console.warn('[H3滚屏] 未知模式 ' + MODE + '，回退到 ctrl');
    MODE = 'ctrl';
  }

  /* ===== 可调参数 ======================================================== */

  var HOLD_MS = 130;      // 手指停下后继续动作多久
  var REPEAT_MS = 55;     // 按住期间重复派发 keydown 的间隔
  var MIN_STEP = 1.5;     // 触发滚动的最小累计位移（像素）
  var DRAG_SCALE = 1.0;   // 拖拽模式：滚动位移 → 拖动位移的倍率
  var DRAG_INSET = 0.18;  // 拖拽棘轮阈值：指针进到画布边缘 18% 范围内就重起手

  var ARROW = {
    up:    { code: 38, key: 'ArrowUp' },
    down:  { code: 40, key: 'ArrowDown' },
    left:  { code: 37, key: 'ArrowLeft' },
    right: { code: 39, key: 'ArrowRight' }
  };
  var CTRL = { code: 17, key: 'Control' };

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

  function keyEvent(type, k, withCtrl) {
    var ev;
    try {
      ev = new KeyboardEvent(type, {
        key: k.key, code: k.key,
        ctrlKey: !!withCtrl, bubbles: true, cancelable: true, view: window
      });
    } catch (err) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, true);
    }
    // 构造器不接受 keyCode/which，只能事后补（老式处理逻辑读这两个）
    defProp(ev, 'keyCode', k.code);
    defProp(ev, 'which', k.code);
    defProp(ev, 'ctrlKey', !!withCtrl);
    return ev;
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

  // 派发到画布且 bubbles=true：一次覆盖 canvas / document / window 三种注册方式
  function dispatch(ev) {
    var t = getCanvas() || document.body || document;
    t.dispatchEvent(ev);
  }

  /* ===== 真实指针位置记录（拖拽结束后要送回原处） ======================== */

  var lastReal = null;

  window.addEventListener('mousemove', function (e) {
    if (!e.isTrusted) return;                    // 只记真实事件，忽略自己合成的
    lastReal = { x: e.clientX, y: e.clientY };
  }, true);

  function safePoint(cv) {
    var r = cv.getBoundingClientRect();
    var p = lastReal;
    if (!p || p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom) {
      p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return p;
  }

  /* ===== 累计位移 → 方向 ================================================= */

  var accX = 0, accY = 0;

  function dirOf(dx, dy) {
    if (Math.abs(dy) >= Math.abs(dx)) {
      return Math.abs(dy) >= MIN_STEP ? (dy > 0 ? 'down' : 'up') : null;
    }
    return Math.abs(dx) >= MIN_STEP ? (dx > 0 ? 'right' : 'left') : null;
  }

  /* ===== 模式一：Ctrl + 方向键 ========================================== */

  var held = null;
  var ctrlHeld = false;
  var repeatTimer = null;
  var stats = { wheel: 0, press: 0 };

  function ctrlPress(dir) {
    if (held === dir) return;
    ctrlRelease();
    held = dir;
    stats.press++;

    if (!ctrlHeld) {
      dispatch(keyEvent('keydown', CTRL, true));
      ctrlHeld = true;
    }
    dispatch(keyEvent('keydown', ARROW[dir], true));

    // 事件式处理需要重复事件才能持续；状态式处理无副作用
    repeatTimer = setInterval(function () {
      if (held !== dir) return;
      dispatch(keyEvent('keydown', ARROW[dir], true));
    }, REPEAT_MS);
  }

  function ctrlRelease() {
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
    if (held) {
      var k = ARROW[held];
      held = null;
      dispatch(keyEvent('keyup', k, true));
    }
    if (ctrlHeld) {
      ctrlHeld = false;
      dispatch(keyEvent('keyup', CTRL, false));
    }
  }

  /* ===== 模式二 / 三：合成鼠标拖动（左键 / 右键） ======================== */

  var BTN = MODE === 'rdrag' ? { button: 2, mask: 2 } : { button: 0, mask: 1 };

  var drag = { on: false, x: 0, y: 0, cv: null, moved: 0 };

  function dragStart(cv) {
    var p = safePoint(cv);
    var r = cv.getBoundingClientRect();
    drag.on = true;
    drag.cv = cv;
    drag.moved = 0;
    // 起手点取真实指针位置（不在画布内则取中心）
    drag.x = p.x;
    drag.y = p.y;
    cv.dispatchEvent(mouseEvent('mousedown', drag.x, drag.y, BTN.button, BTN.mask));
    return r;
  }

  function dragMove(dx, dy) {
    var cv = drag.cv;
    if (!cv) return;
    var r = cv.getBoundingClientRect();

    // 拖地图：想看到更下面的内容 → 地图往上推 → 指针向上移动
    var nx = drag.x - dx * DRAG_SCALE;
    var ny = drag.y - dy * DRAG_SCALE;

    // 棘轮：快撞到边界时，先结束当前拖拽、从中心重新起手，再接着走剩余位移。
    // 引擎按位移增量平移地图，所以重起手不会让地图跳。
    var ix = r.width * DRAG_INSET;
    var iy = r.height * DRAG_INSET;
    if (nx < r.left + ix || nx > r.right - ix || ny < r.top + iy || ny > r.bottom - iy) {
      cv.dispatchEvent(mouseEvent('mouseup', drag.x, drag.y, BTN.button, 0));
      drag.on = false;
      drag.x = r.left + r.width / 2;
      drag.y = r.top + r.height / 2;
      drag.moved = 0;
      cv.dispatchEvent(mouseEvent('mousedown', drag.x, drag.y, BTN.button, BTN.mask));
      drag.on = true;
      nx = drag.x - dx * DRAG_SCALE;
      ny = drag.y - dy * DRAG_SCALE;
      // 兜底夹紧，防止单次位移过大再次越界
      nx = Math.min(Math.max(nx, r.left + ix), r.right - ix);
      ny = Math.min(Math.max(ny, r.top + iy), r.bottom - iy);
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
    // 指针不能停在边缘，否则会误触发引擎自带的「边缘滚动」
    var p = safePoint(cv);
    cv.dispatchEvent(mouseEvent('mousemove', p.x, p.y, 0, 0));
  }

  /* ===== 空闲收尾 ======================================================== */

  var lastWheelAt = 0;

  function tickIdle() {
    if (Date.now() - lastWheelAt <= HOLD_MS) return;
    if (MODE === 'ctrl') {
      if (held) { ctrlRelease(); accX = accY = 0; }
    } else {
      if (drag.on) dragEnd();
    }
  }

  /* ===== 统一入口 ======================================================== */

  function onWheel(e) {
    var cv = getCanvas();
    if (!cv || !inCanvas(e, cv)) return;

    // 挡掉页面滚动与触控板横滑返回上一页
    try { e.preventDefault(); } catch (err) { /* passive 时无法阻止 */ }

    var px = toPixels(e);
    stats.wheel++;
    lastWheelAt = Date.now();

    if (MODE === 'ctrl') {
      accX += px.x;
      accY += px.y;
      var d = dirOf(accX, accY);
      if (d) {
        if (d !== held) { accX = accY = 0; }
        ctrlPress(d);
      }
      return;
    }

    if (!drag.on) dragStart(cv);
    dragMove(px.x, px.y);
  }

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

  // 失焦 / 切后台时强制收尾，避免"卡住"
  window.addEventListener('blur', function () { ctrlRelease(); dragEnd(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { ctrlRelease(); dragEnd(); }
  });

  /* ===== 对外接口（调试用） ============================================== */

  window.__h3TouchScroll = {
    mode: MODE,
    stats: stats,
    get held() { return held; },
    get dragging() { return drag.on; },
    get ctrlHeld() { return ctrlHeld; },
    stop: function () { ctrlRelease(); dragEnd(); },
    nudge: function (dir, times) {
      var n = times || 1;
      for (var i = 0; i < n; i++) {
        (function (ii) {
          setTimeout(function () {
            lastWheelAt = Date.now();
            if (MODE === 'ctrl') ctrlPress(dir);
          }, ii * 90);
        })(i);
      }
      setTimeout(function () { lastWheelAt = 0; }, n * 90 + 10);
    }
  };

  log('已启用，模式 = ' + MODE + (
    MODE === 'ctrl' ? '（Ctrl + 方向键，卷地图而非移动英雄）'
      : MODE === 'drag' ? '（需在游戏内开启「左键拖动地图」）'
        : '（需在游戏内开启「右键拖动地图」）'));
})();
