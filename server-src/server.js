const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');//3001端口依赖

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const cookieParser = require('cookie-parser');

// === DB ===
const db = require('../db/DBManager');

// === 中间件 ===
const auth = require('../middlewares/auth');
const activityTracker = require('./activity/activityTracker');

// === 文件系统（新版） ===
const fileAdapter = require('./file/legacyAdapter');

// === 路由 ===
const feedRoutes = require('./RG/feed');
const orderRoutes = require('../iDataRiver/routes/order');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const activityRoutes = require('./activity/activity');

// === 模块 ===
const initChatServer = require('./chat/chatServer');
const { initSchedules } = require('./schedules');

// 🎯 修复：正确的中间件顺序
// 1. 基础解析中间件最先
app.use(express.json({
  type: ['application/json', 'application/*+json', 'text/plain'] // 添加 text/plain 支持
}));
app.use(express.urlencoded({ extended: true })); // 这个会处理 application/x-www-form-urlencoded

// 2. Cookie 和跨域
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// 3. 认证中间件
app.use(auth);

// --- 静态资源 ---
app.use(express.static(path.join(__dirname, '../public')));

/*------------------------------------------------
 🧠 修复：先注册所有API路由
------------------------------------------------*/
app.use('/api', feedRoutes);
app.use("/api/order", orderRoutes);
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api/activity', activityRoutes);  // ✅ 现在 activity 路由能正确解析 body 了


/*------ 游戏商店用户认证跳转接口 -------*/
app.get('/go-shop', (req, res) => {

  const token = req.cookies.token;

  if (!token)
    return res.redirect('/login');

  const fallbackShopUrl = process.env.GAME_SHOP_URL || 'http://localhost:3001';
  const gameDomainFile = process.env.GAME_DOMAIN_FILE || path.join(__dirname, '../cloudflared/game-domain.txt');
  let shopUrl = fallbackShopUrl;

  try {
    if (fs.existsSync(gameDomainFile)) {
      const value = fs.readFileSync(gameDomainFile, 'utf8').trim();
      if (value) {
        shopUrl = value.startsWith('http') ? value : `https://${value}`;
      }
    }
  } catch (error) {
    console.warn('⚠️ 读取 game-domain.txt 失败，使用默认游戏域名:', error.message);
  }

  res.redirect(`${shopUrl}?token=${token}`);
});


/*------------------------------------------------
    🧠 文件主接口
------------------------------------------------*/
app.get('/file/:fileId', async (req, res) => {
  try {
    if (!app.locals.fileController) {
      return res.status(503).send('服务正在初始化，请稍后重试');
    }
    await app.locals.fileController.handleFileRequest(req, res);
  } catch (error) {
    console.error('路由处理错误:', error);
    res.status(500).send('服务器内部错误');
  }
});


/*---------- 活跃追踪 ----------*/
app.use(activityTracker());

/*---------- 首页 ----------*/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

/*------------------------------------------------
           🧠 初始化阶段
------------------------------------------------*/
(async () => {
  try {
    console.log('⚙️ 初始化数据库连接...');
    await db.init();
    console.log('✅ 所有数据库已就绪');

    // 🚀 初始化 fileController
    const adapter = fileAdapter.init(db);
    app.locals.fileController = adapter;
    console.log('✅ 文件处理器已挂载（legacyAdapter → FileController）');

    // 聊天模块
    initChatServer(app, io);
    console.log('✅ 聊天模块已初始化');

    // 定时任务
    const { CACHE_DIR } = require('./file/utils');
    initSchedules(CACHE_DIR);
    console.log('✅ 定时任务已初始化');

    // 启动服务
    http.listen(3000, '::', () => {
      console.log('🚀 服务已启动（IPv4+IPv6）：http://[::]:3000');
    });

  } catch (error) {
    console.error('❌ 初始化失败:', error);
    process.exit(1);
  }
})();

module.exports = { app, http, io };