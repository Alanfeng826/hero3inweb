# 英雄无敌 III · 纯网页版本地部署

在浏览器里跑**原汁原味的《英雄无敌 III：死亡阴影》**，玩法由开源引擎 **VCMI**（WebAssembly 版）驱动。
引擎文件全部在本地，游戏资源直接读你机器上的 H3 安装目录，**不依赖任何第三方服务**。

> ### 关于本仓库
>
> 本仓库提供的是**可运行的网页版外壳**：VCMI 引擎（WASM）、官方网页启动器、以及本项目做的
> **简体中文汉化补丁**。不包含任何《英雄无敌 III》的游戏资源文件。
>
> **游戏资源请自备**（需持有正版《英雄无敌 III：完整版》）。把下列 7 个文件放进
> 仓库根目录下的 **`Data/`**（该目录已被 `.gitignore` 排除）即可——页面会**自动识别并装载**，
> 不必再手动选择；也可以按第一节的说明在启动器里直接指向你本机的游戏目录。
>
> 换机器 / 重新克隆后照样能跑，只要那边有 H3 游戏资源即可。

---

## 一、怎么玩

**双击 `启动英雄无敌3.cmd`** → 弹出黑色命令行窗口，约 1 秒后浏览器自动打开 `http://127.0.0.1:8099/`

> ⚠️ **必须保持那个黑色窗口开着。** 它就是本地服务本体——关掉窗口服务即停止，再访问就会显示"无法访问"。
> 服务**不常驻、不开机自启**，每次想玩双击一次即可。
> 重复双击不会出错：检测到端口已被占用时，会直接帮你打开浏览器。

首次进入按提示操作：

1. **版本** 选 `1.6.5-wasm-2`（默认已选好）
2. **游戏文件**
   - 若 `Data/` 目录里已备好资源 → 页面**自动装载**，直接显示「所有文件已就绪」。
     下载期间页面底部有一条进度浮层，装完自动消失。
   - 若没有 `Data/` 目录 → 点文件夹图标手动选中下面 **7 个文件**
     （一般位于游戏安装目录的 `Data\` 子目录下）：

   | 文件 | 大小 |
   |---|---|
   | `H3bitmap.lod` | 102 MB |
   | `H3sprite.lod` | 62 MB |
   | `H3ab_bmp.lod` | 42 MB |
   | `VIDEO.VID` | 21 MB |
   | `Heroes3.snd` | 15 MB |
   | `H3ab_spr.lod` | 12 MB |
   | `H3ab_ahd.snd` | 1.4 MB |

3. 点 **下一步** → 选择分辨率 → 点 **开始游戏**

> 资源只需放一次：以后换电脑、换浏览器、清缓存，页面都会自动重新装载
> （浏览器里已有缓存时直接命中，一个字节都不用重新下载）。
> 启动器界面与游戏界面**都已是简体中文**；想切回英文见第五节。

本地版同样支持这套自动装载 —— 把 7 个文件拷进 `homm3-web\Data\` 即可。
服务器部署（https://prdshare.online/hero3inweb/ ）的做法见**第九节**。

---

## 二、已验证的运行结果

| 检查项 | 结果 |
|---|---|
| 引擎加载 | `vcmiclient.wasm` (9 MB) 本地加载成功 |
| 数据加载 | `All game content loaded` — 引擎自报全部内容加载完成 |
| mod 加载 | `vcmi`、`vcmi-extras` 等全部 `OK` |
| 画面 | 成功渲染中文主菜单：新游戏 / 载入进度 / 最高得分 / 制作组 / 退出 |
| 城镇数据 | 补齐 `VIDEO.VID` 后，`Data in fortress is invalid`（酒馆视频缺失）报错消除 |
| 界面语言 | 启动器界面已中文化：实测在 **英文 locale 的浏览器**下仍默认显示中文（标题「英雄无敌 III」、下拉「中文」、按钮「下一步」），无页面报错 |
| 游戏语言 | 实测抓取引擎开局写入的 `settings.json`，内容为 `"language" : "chinese"` |
| 中文显示 | 引擎自绘的中文界面文本正常渲染（修复后不再出现 `???` 问号） |
| 界面实测 | 「单人场景 → 选择场景」界面：「选择场景 / 场景名称 / 可用玩家数 / 场景类型 / 场景说明 / 胜利条件 / 失败条件 / 起始资源 / 初始英雄 / 城镇状态 / 开始 / 返回」全部为正常汉字 |
| 缓存机制 | 同一浏览器档案连跑两遍：第 1 遍下载新数据包，第 2 遍完全不请求数据包（命中 IndexedDB）而界面仍为中文 |

---

## 三、目录结构

```
homm3-web/
├─ 启动英雄无敌3.cmd      ← 双击这个
├─ serve.js               ← 零依赖本地静态服务器（Node）
├─ index.html             ← 入口页
├─ autoload.js            ← 服务器资源自动装载（见第九节）
├─ touch-scroll.js        ← 触控板双指滑动 → 地图卷动（见第十节）
├─ demo.jpg / keyboard.png
├─ .gitignore             ← 排除游戏资源（*.lod / *.snd / *.VID 等）
├─ .gitattributes
├─ Data/                  ← 【自备】游戏资源放这里，页面会自动装载（已被 git 忽略）
└─ vcmi/                  ← 引擎产物（约 57 MB）
   ├─ vcmiclient.1.6.5-0.js / .wasm    引擎内核
   ├─ vcmi.data.1.6.5-zh / .js         引擎界面数据（已注入中文字体）
   ├─ vcmi.data.1.6.5.orig             原始副本（字体回滚用，旧文件名）
   ├─ vcmi.data.1.6.5.js.orig          原始副本（字体回滚用，旧文件名）
   ├─ en.data / en.data.js             地图与英文化资源
   ├─ vcmi.mods.data.1.6.3 / .js       VCMI mod 数据
   ├─ vcmiclient.js / .wasm  (1.5.7)   旧版，保留备用
   └─ launcher/                        VCMI 官方网页启动器
      ├─ vcmi-launcher.js / .css
      ├─ vcmi-launcher.js.bak-cache    仅去掉「数据包改名」的副本（缓存策略回滚用）
      ├─ vcmi-launcher.js.bak-ui       启动器界面改中文前的副本（回滚界面用）
      ├─ vcmi-launcher.js.nolang       仅去掉「语言补丁」的副本（语言回滚用）
      ├─ vcmi-launcher.js.orig         dos.zone 原始副本（仅供参照，勿直接覆盖）
      ├─ main_bg_image.jpg
      └─ tg_logo.svg / discord_logo.svg
```

> ⚠️ `vcmi-launcher.js.orig` 是**从 dos.zone 抓下来的原始文件**，里面带着防自托管跳转。
> 直接拿它覆盖 `vcmi-launcher.js` 会让本地版本失效（被跳去 dos.zone）。
> 要回滚语言改动，请用 **`vcmi-launcher.js.nolang`**。

---

## 四、对原版 launcher 做的八处改动

`vcmi/vcmi/launcher/vcmi-launcher.js` 是从 dos.zone 抓取的官方启动器，为本地化做了 8 处最小改动：

| # | 原行为 | 改为 | 原因 |
|---|---|---|---|
| 1 | 资源指向 `https://caiiiycuk.github.io/vcmi-wasm/...` | 改为本地相对路径 `vcmi/...` | 断网可用（共 17 处） |
| 2 | host 非 `dos.zone`/`localhost` 就跳转到 `sec.dos.zone/homm3/` | 去掉跳转（`\|\|1`） | 解除防自托管限制 |
| 3 | 必须 `localhost` 才启用本地版本 | 额外放行 `127.0.0.1` | 允许用 IP 访问 |
| 4 | 必需文件 6 个 | 增加 `Data/VIDEO.VID` | 修复城镇酒馆视频缺失 |
| 5 | 游戏语言写死 `navigator.language`（非俄语一律 `english`） | 默认 **`chinese`**，可覆盖 | 见第五节 |
| 6 | 启动器界面只有 `ru` / `en` 两种文案 | 注入 **`zh` 翻译表（62 个键）**，下拉加入「中文」 | 启动器页面可见中文 |
| 7 | 语言下拉与游戏语言无关 | 选中文/俄文/英文时**同时设置游戏语言** | 让下拉成为一个真开关 |
| 8 | 引擎数据包文件名固定，改动内容后浏览器仍用旧包 | 数据包改名为 `vcmi.data.1.6.5-zh`，`dataUrl` 同步更新 | 见第六节「为什么换了字体还是问号」 |

**回滚**：
- 回退第 8 项（缓存策略）→ 用 `vcmi-launcher.js.bak-cache` 覆盖（数据包需同时改回旧名）
- 回退第 6、7 项（启动器界面恢复英/俄）→ 用 `vcmi-launcher.js.bak-ui` 覆盖
- 回退第 5 项（游戏语言恢复跟随系统）→ 用 `vcmi-launcher.js.nolang` 覆盖
- （`vcmi-launcher.js.orig` 是 dos.zone 原始文件，含防自托管跳转，**不要**直接拿它覆盖。）

---

## 五、界面语言（启动器 + 游戏，都已默认中文）

### 5.1 为什么以前切不了中文

两层原因，都是源码级的硬限制：

1. **游戏内没有语言入口。** VCMI 设置窗口只有 General / Adventure / Battle / Other 四个页签，逐个查过源码，确实没有语言项。桌面版 VCMI 是在**启动器**里选语言的。
2. **网页版启动器的语言下拉原版只有两项。** 源码写死 `["ru","en"]` —— 只有 Русский 和 English，所以你翻遍界面都找不到中文。

而游戏语言实际只来自启动器开局前写入的 `settings.json`，原逻辑是「浏览器语言是俄语就俄语，否则一律英语」，中文系统必然落到英语。

### 5.2 现在的行为

- **启动器界面**：默认简体中文（标题「英雄无敌 III」、按钮「下一步 / 开始游戏」等）。语言下拉现在是三项：**中文 / Русский / English**。
- **游戏界面**：开局前写入的 `settings.json` 强制为 `"language" : "chinese"`（实测抓到的实际写入内容见下）。
- **下拉联动**：在下拉里选中文 / Русский / English，会**同时**切换启动器文案与游戏语言——它现在是一个真正的语言开关。

实测抓到的引擎写入内容：

```json
{ "general" : { "language" : "chinese", "autosaveCountLimit" : 1 }, ... }
```

### 5.3 切换与回退

改完**重新点一次「下一步」→「开始游戏」**才生效（语言是在开局那一刻写进引擎的）。

若下拉里的选择被浏览器记住后想重置，清掉站点数据里的 `vcmi.uilang` 即可恢复默认中文。

**回滚**：见第四节——`vcmi-launcher.js.bak-ui`（回退界面中文化）、`vcmi-launcher.js.nolang`（回退游戏语言强制）。

---

## 六、中文字体修复（重要）

**现象**：界面里出现成片的 `???` 问号。

### 6.1 根因一：资源包里的字体不含汉字

VCMI 1.6.5 的资源包把字体整体换成了 **Noto Sans / Noto Serif**——这两个字体**不含汉字**；而 1.6.5 的 `config/fonts.json` 又取消了「字符串无法显示时回退到原版位图字体」的机制。结果：凡是中文，都没有字形可画，一律显示成问号。

两套资源包的字体策略对比：

| 资源包 | 字体 | 含汉字 |
|---|---|---|
| 旧包（1.5.7 配套） | `WenQuanYi-Micro-Hei-Regular.ttf`（文泉驿微米黑） | ✅ |
| `vcmi.data.1.6.5`（原本在用） | `NotoSerif-Bold / Black / Medium`、`NotoSans-Medium` | ❌ |

**修法**：把 1.6.5 包里那 4 个 Noto 字体，替换为旧包中**含汉字的文泉驿微米黑**，并同步改写 `config/fonts.json` 里的 9 处字体引用。字号的数值参数一律保持原样，所以界面排版不变（仅字形风格由衬线变为黑体）。

- 包体：7.9 MB → 9.58 MB

### 6.2 根因二：换了字体还是问号 —— 浏览器缓存按「文件名」命中

**这是最容易踩的坑。** 只替换包内容、不改文件名，**浏览器永远不会用新包**。

启动器把引擎数据包缓存在浏览器的 **IndexedDB** 里，源码里的缓存键就是**文件名**：

```js
const n = dataUrl.slice(0, -3);                              // 去掉 .js
const r = dataUrl.slice(dataUrl.lastIndexOf("/") + 1);        // 缓存键 = 文件名
const i = n.slice(n.lastIndexOf("/") + 1);                    // 缓存键 = 文件名
const [meta, bin] = await Promise.all([db.get(r), db.get(i)]);
if (meta === null || bin === null) { /* 只有缓存缺失才联网下载 */ }
```

后果：**内容变了但名字没变 → 永远命中旧包。** 而且 IndexedDB 不受「强制刷新（Ctrl+Shift+R）」影响，也不受 HTTP 缓存头影响——怎么刷都没用。

**修法**：把数据包**改名**，让缓存键失配，强制重新下载。

| 项目 | 改名后 |
|---|---|
| 数据包 | `vcmi/vcmi.data.1.6.5-zh` |
| 元数据 | `vcmi/vcmi.data.1.6.5-zh.js` |
| 启动器 `dataUrl` | `vcmi/vcmi.data.1.6.5-zh.js` |

> ⚠️ **今后凡是替换引擎资源内容，必须同时改文件名**（或改启动器里的缓存键），否则改动不会生效。

**实测验证**（同一浏览器档案连跑两遍）：

| 轮次 | 引擎资源请求 | 结果 |
|---|---|---|
| 第 1 遍 | 请求 `vcmi.data.1.6.5-zh.js` + `vcmi.data.1.6.5-zh` | 新包下载，界面全中文 |
| 第 2 遍 | **完全不请求数据包**（命中 IndexedDB） | 界面仍全中文 |

**回滚**：把 `vcmi.data.1.6.5.orig`、`vcmi.data.1.6.5.js.orig` 改回旧名（`vcmi.data.1.6.5`、`vcmi.data.1.6.5.js`）覆盖，并同步改回启动器的 `dataUrl`；
也可从 `https://caiiiycuk.github.io/vcmi-wasm/vcmi/vcmi.data.1.6.5` 重新下载原始包。

---

## 七、已知限制

1. **音乐默认静音。** 引擎音乐走 dos.zone 的 CDN 且要求 `.ogg` 格式，而你本地 `MP3/` 是 `.mp3`。不影响玩法；如需音乐，可用 ffmpeg 把 `D:\game\Heroes3\MP3\*.mp3` 转成 ogg 后再本地化。
2. **引擎版本为 1.6.5。** 实测 1.5.7 会与新版 launcher 不兼容（报 ENOTDIR），已固定用 1.6.5。
3. **服务只监听 127.0.0.1**，不对局域网开放。
4. **地图名与剧情文本仍是英文。** 那属于「游戏数据翻译」，需要另外装 H3 中文化 mod（`chinese-translation`）；本方案只解决了**界面文本**的中文与字形。不做也不影响玩法。
5. **浏览器提示"无法访问"时的排查顺序**：
   1. 先看那个黑色命令行窗口还在不在——关掉了就重新双击 `启动英雄无敌3.cmd`（这是最常见的原因，服务不是常驻的）；
   2. 再看命令行窗口里有没有报错信息；
   3. 最后才怀疑系统代理——确保 `127.0.0.1` 不走代理（Windows 默认排除，一般无需改）。
6. **界面又是问号 / 改了引擎资源但没生效**：几乎一定是浏览器的 IndexedDB 缓存命中旧包（第六节 6.2）。
   彻底清法：F12 → Application → Storage → **Clear site data**。清掉后游戏文件需要重新选一次（那 7 个文件存在另一个库里）。
   这也是为什么每次换引擎资源都要**改名**。

---

## 八、引擎来源

- 引擎：`caiiiycuk/vcmi-wasm`（VCMI 项目 WebAssembly 移植），GPL-2.0
- 上游：`vcmi/vcmi`（开源重写的 H3 引擎，规则逐条对齐原版数值）
- 启动器产物来自 dos.zone 的 `vcmi-html5-launcher`

游戏资源版权归原权利人，本方案仅读取你本机已安装的《英雄无敌 III：完整版》，不复制、不分发。

---

## 九、服务器部署（资源预置 · 免手动选文件）

线上地址：**https://prdshare.online/hero3inweb/**

### 9.1 部署形态

纯静态站点，用 **nginx `alias` 直接托管**（与同机 `/kb/`、`/m3e-canvas/` 一个模式），**不占 pm2 端口**：

| 项 | 值 |
|---|---|
| 站点目录 | `/var/www/hero3inweb/` |
| 资源目录 | `/var/www/hero3inweb/Data/` |
| nginx | `sites-available/prdshare.online` 里三条 location：`= /hero3inweb`（301）、`/hero3inweb/Data/`（目录索引）、`/hero3inweb/`（alias） |

两个**必需**的响应头（缺了引擎起不来）：

| 响应头 | 值 | 为什么必需 |
|---|---|---|
| `Cross-Origin-Opener-Policy` | `same-origin` | 引擎 wasm 用了 **pthreads**（JS 里 226 处 `pthread`、2 处 `SharedArrayBuffer`），必须 `crossOriginIsolated === true` 才能拿到共享内存 |
| `Cross-Origin-Embedder-Policy` | `require-corp` | 同上 |

> ⚠️ nginx 陷阱：**location 内一旦写了 `add_header`，就不再继承 server 级的同名指令**。
> 所以 `/hero3inweb/` 这个 location 里把 server 级的安全头原样补了一份，避免被吃掉。

另外 `http` 级原来只写了 `gzip on` 而 `gzip_types` 被注释掉（默认只压 `text/html`），
所以在 location 里补了 `gzip_types` —— `vcmi-launcher.js`(380 KB) 与 wasm(8.6 MB) 才吃得到压缩。

### 9.2 Data/ 目录与自动装载

把 7 个游戏资源文件放进 `/var/www/hero3inweb/Data/`，页面打开时就会**自动装载**，不用再手动选文件。

工作原理（`autoload.js`，**不修改启动器任何代码**）：

1. 启动器的"从设备上传文件"是一个 `<input type="file" name="game-file">`，按「文件名（小写）」识别所需的 7 个文件；
2. 页面加载后，脚本从 `Data/` 取到这些文件（浏览器里已有缓存则直接命中，不走网络）；
3. 就地构造成 `File` 对象**投递给同一个输入框**并触发 `change`；
4. 自此交给启动器自己的流程 —— 校验、写入 IndexedDB、界面切换到「所有文件已就绪」。

`Data/` 下另开一个 **JSON 目录索引**（`autoindex_format json`），页面靠它拿到文件清单：

| 措施 | 原因 |
|---|---|
| `autoindex_format json` | 页面需要文件清单才能自动装载 |
| `gzip off` | `.lod/.snd/.vid` 本身已高度压缩，再压既浪费 CPU，又会吃掉 `Content-Length`，让进度条失准 |

脚本的**降级行为**（一律静默，绝不干扰原有的手动选文件流程）：

| 情形 | 行为 |
|---|---|
| 目录索引不可用（换主机、nginx 没配） | 退回逐个文件名探测（HEAD），大小写变体都试 |
| `Data/` 不存在或里面没有可识别的资源 | 直接退出，启动器自带的手动选文件入口照旧可用 |
| 加了 `?autoload=0` | 关闭自动装载 |
| 下载中途失败 | 中止并提示，转手动选择 |

### 9.3 上传 / 更新游戏资源

在本机（资源位于 `D:\game\Heroes3\Data\`）：

```bash
cd "/d/game/Heroes3/Data"
tar cf - H3bitmap.lod H3sprite.lod H3ab_bmp.lod VIDEO.VID Heroes3.snd H3ab_spr.lod H3ab_ahd.snd \
| ssh -i ~/.ssh/id_ed25519 ubuntu@150.158.53.45 \
  'sudo tar xf - -C /var/www/hero3inweb/Data/ && sudo chown -R www-data:www-data /var/www/hero3inweb/Data/'
```

上完**不用重启任何服务**，刷新页面即生效。文件名大小写不敏感（脚本按小写匹配）；
即使把整个 `Data` 目录层级一起传上去（形成 `Data/Data/`），脚本也会自动下探一层。

> 资源换了版本也不用担心旧缓存：脚本会比对服务器文件大小与浏览器缓存的差异，
> 大小不一致就重新下载覆盖。

### 9.4 回滚

```bash
ls /etc/nginx/sites-available/ | grep bak-hero3inweb          # 列出备份
sudo cp <备份文件> /etc/nginx/sites-available/prdshare.online
sudo nginx -t && sudo systemctl reload nginx
```

不想要自动装载：删掉 `autoload.js`，以及 `index.html` 里的 `<script defer src="autoload.js"></script>` 那一行即可。

### 9.5 注意

`Data/` 目录是**公网可直接访问**的（`https://prdshare.online/hero3inweb/Data/H3bitmap.lod` 能直接下载）。
仅适合自用，不建议对外宣传这个地址。若要挡一下，可在该 location 里加 `allow/deny` 限制来源 IP
—— 但那样换个网络就进不去，取舍自定。

---

## 十、触控板 / 触屏卷动地图

### 10.1 结论：引擎本身就有这套能力

VCMI 1.6.5 内置了完整的触摸与拖动支持，只是**默认关着**。从引擎数据包的中文翻译表里可以逐条查到：

| 能力 | 设置键 | 游戏内文案 |
|---|---|---|
| 左键拖动地图 | `adventureOptions.leftButtonDrag` | 「按住左键移动鼠标将拖动冒险地图视图」 |
| 右键拖动地图 | `adventureOptions.rightButtonDrag` | 「按住右键移动鼠标将拖动冒险地图视图」 |
| 平滑地图拖动 | `adventureOptions.smoothDragging` | 「地图拖动会产生柔和的羽化效果」 |
| 边缘滚动 | `adventureOptions.borderScroll` | 「光标靠近窗口边缘时滚动冒险地图」 |
| 地图卷动速度 | `adventureOptions.mapScrollSpeed1–6` | 1 非常慢 → **6 即刻** |
| 两指开合缩放 | `tutorialWindow.decription.MapZooming` | 「两指开合更改地图缩放比例」 |
| 长按 = 右键 | `tutorialWindow.decription.RightClick` | 「长按要右键单击的元素」 |

**路径：游戏内齿轮（系统选项）→ 冒险地图** 页签。

注意语义差异：VCMI 的「双指」手势是**开合 = 缩放**，**不是**平移；平移地图对应的是「拖动地图」。

### 10.2 Mac 触控板：`touch-scroll.js`

触控板双指滑动在浏览器里产生的是 `wheel` 事件，而引擎没有把滚轮绑到地图卷动。
`touch-scroll.js` 把它翻译成引擎认识的操作：

| 模式 | URL 参数 | 原理 | 前置条件 |
|---|---|---|---|
| `ctrl`（默认） | `?touchscroll=ctrl` | wheel → 合成 **Ctrl + 方向键** | 无，不需改任何游戏设置 |
| `drag` | `?touchscroll=drag` | wheel → 合成**鼠标左键拖动**，1:1 跟手 | 需开启「左键拖动地图」 |
| `rdrag` | `?touchscroll=rdrag` | wheel → 合成**鼠标右键拖动**，1:1 跟手 | 需开启「右键拖动地图」 |
| 关闭 | `?touchscroll=0` | 不加载任何逻辑 | — |

> ⚠️ **踩过的坑：不能翻译成纯方向键。**
> H3 里方向键控制的是**英雄行走**，不是卷地图。VCMI 官方文档写的是
> `[LCtrl] + Arrows — scrolls Adventure Map` —— **必须带 LCtrl 才是卷地图**。
> 第一版漏了 Ctrl，结果双指滑动把英雄走起来了。不要把这条改回去。

实现要点：

- 只在**游戏画布**上生效，启动器页面自动不介入
- `preventDefault` 掉浏览器自身的页面滚动与触控板**侧滑返回上一页**
- `ctrl` 模式会先单独发一次 `keydown Control`，再发带 `ctrlKey=true` 的方向键 ——
  兼容"引擎自己跟踪修饰键状态"和"只读事件上的 ctrlKey"两种实现
- 手指停下 `HOLD_MS=130ms` 后释放；按住期间每 `55ms` 重复派发 `keydown`，
  以同时兼容「状态式」与「事件式」两种按键处理逻辑
- 拖拽模式做了**棘轮**：指针快撞到画布内边界时先 `mouseup`、从中心重新 `mousedown` 接着拖。
  引擎按位移增量平移地图，所以重起手不会让地图跳；否则长距离滑动会"拖到头就停"
- 拖拽结束把指针送回原位/中心，否则指针停在边缘会误触发引擎自带的**边缘滚动**
- 页面失焦 / 切换到后台时强制收尾，避免"卡住一直动"

参数都在文件头部，可按手感调整：`HOLD_MS`（滑行时长）、`REPEAT_MS`（重复间隔）、
`MIN_STEP`（触发阈值）、`DRAG_SCALE`（拖拽倍率）、`DRAG_INSET`（棘轮阈值）。

**回滚**：删掉 `touch-scroll.js` 与 `index.html` 里的
`<script defer src="touch-scroll.js"></script>` 那一行；或临时在地址后加 `?touchscroll=0`。

### 10.3 iPad / 触屏：走引擎原生路径

不需要额外脚本 —— SDL 的触摸事件默认映射为鼠标，所以：

1. 系统选项 → 冒险地图 → 勾上 **「左键拖动地图」**
2. 单指拖动地图即可卷动（建议把「地图卷动速度」调到 5–6）
3. 两指开合缩放

### 10.4 已知限制

- `ctrl` 模式的滚动速度受游戏内「地图卷动速度」影响，不是 1:1 跟手。
  想要跟手的拖拽手感，用 `?touchscroll=drag`（需先开「左键拖动地图」）。
- `ctrl` 模式依赖引擎把 `Ctrl + 方向键` 认作卷地图。本地已验证合成事件正确
  （`Control#17` 先按下，`ArrowDown#40 ctrl=true` 跟随，释放顺序正确），
  但**引擎是否响应仍需真机确认** —— 若双指滑动仍在移动英雄，说明该组合没被识别，
  改用 `drag` / `rdrag`。
- iPad 上能否跑起整个游戏尚未验证：iOS Safari 的 `SharedArrayBuffer` 需要 cross-origin
  isolated（本站已有 `COOP/COEP`），但 256.62 MiB 资源进 MEMFS 可能触发单页内存上限。
- iPad 上能否跑起整个游戏尚未验证：iOS Safari 的 `SharedArrayBuffer` 需要 cross-origin
  isolated（本站已有 `COOP/COEP`），但 256.62 MiB 资源进 MEMFS 可能触发单页内存上限。
