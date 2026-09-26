// GameService.js - 游戏业务逻辑服务
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

// 使用统一的数据库连接
const { dbManager, mongoose } = require('./db/mongoose');

// 加载环境变量配置
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ==================== 常量定义 ====================
const ROUTES_DIR = path.join(__dirname, 'routes');
const SHOP_ROUTES_DIR = path.join(__dirname, '../game-shop/routes');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '../../public');

class GameService {
  constructor() {
    this.app = express();
    this.port = process.env.GAME_API_PORT || 3001;
    this.isShuttingDown = false;
    this.dbConnected = false;
    this.routesLoaded = false;
    this.serverStarted = false;
    this.server = null;
    
    // 立即启动服务
    this.start().catch(error => {
      console.error('🎮 服务启动失败:', error);
      process.exit(1);
    });
  }
  
  /*------------ 主启动方法 --------------*/
  async start() {
    try {
      console.log('🎮 启动游戏商店服务...');
      
      // 1. 基础中间件（解析器、日志、CORS）- 最先执行
      this.initBaseMiddleware();
      
      // 2. 静态文件服务（HTML页面）- 现在优先，让根路径直接指向游戏页面
      this.initStaticFileService();
      
      // 3. API路由（健康检查、状态等）- 后匹配
      this.initApiRoutes();
      
      // 4. 错误处理（最后注册）
      this.initErrorHandling();
      
      // 启动HTTP服务器
      this.server = this.app.listen(this.port, () => {
        console.log(`🎮 游戏商店服务运行在端口 ${this.port}`);
        console.log(`🎮 游戏页面: http://localhost:${this.port}/ (直接访问游戏)`);
        console.log(`🎮 API接口: http://localhost:${this.port}/api`);
        console.log(`🎮 健康检查: http://localhost:${this.port}/health`);
        console.log(`🎮 数据库状态: ${this.dbConnected ? '✅ 已连接' : '🔄 连接中...'}`);
        this.serverStarted = true;
      });
      
      // 初始化数据库连接（使用统一管理器）
      await this.initDatabase();
      
      // 初始化优雅关闭
      this.initGracefulShutdown();
      
    } catch (error) {
      console.error('🎮 游戏服务启动失败:', error);
      process.exit(1);
    }
  }

  /*------------ 1. 基础中间件 --------------*/
  initBaseMiddleware() {
    console.log('🎮 初始化基础中间件...');

    /* =====================================================
       ✅ 1.1 基础解析
       ===================================================== */
    this.app.use(cookieParser());

    // ⭐ SSO 中间件 - 必须在 cookieParser 之后，routes 之前
      const sso = require('../middlewares/sso');
      this.app.use(sso);
      console.log('✅ SSO 中间件已启用');
    
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    /* =====================================================
       ✅ 1.2 请求日志
       ===================================================== */
    this.app.use((req, res, next) => {
      console.log(`🎮 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
      next();
    });

    /* =====================================================
       ✅ 1.3 CORS
       ===================================================== */
    this.app.use((req, res, next) => {
      // 限制API接口的CORS，不暴露给所有来源
      const apiPaths = ['/api', '/game-api', '/health', '/status'];
      const isApiPath = apiPaths.some(path => req.path.startsWith(path));
      
      if (isApiPath) {
        // API接口只允许特定域名
        const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
          process.env.ALLOWED_ORIGINS.split(',') : 
          ['http://localhost:3000', 'http://127.0.0.1:3000'];
        
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
        }
      } else {
        // 游戏页面允许所有来源
        res.header('Access-Control-Allow-Origin', '*');
      }
      
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization'
      );
      res.header(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      );

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }

      next();
    });
  }

  /*------------ 2. 静态文件服务（优先，让根路径直接指向游戏） --------------*/
  initStaticFileService() {
    console.log('🎮 初始化静态文件服务...');
    console.log(`🎮 静态文件目录: ${PUBLIC_DIR}`);

    /* =====================================================
       🎮 2.1 静态资源托管（CSS、JS、图片等）
       ===================================================== */
    if (fs.existsSync(PUBLIC_DIR)) {
      this.app.use(
        express.static(PUBLIC_DIR, {
          index: 'yx.html', // 直接设置索引文件为 yx.html
          maxAge: '1d' // 缓存1天
        })
      );
      console.log('🎮 静态资源目录已托管');
    } else {
      console.warn(`⚠️ 静态文件目录不存在: ${PUBLIC_DIR}`);
    }

    /* =====================================================
       🎮 2.2 根路径直接指向游戏页面（最重要！）
       ===================================================== */
    this.app.get('/', (req, res) => {
      const htmlPath = path.join(PUBLIC_DIR, 'yx.html');
      
      if (fs.existsSync(htmlPath)) {
        console.log('🎮 根路径 → 游戏页面');
        res.sendFile(htmlPath);
      } else {
        console.error('❌ 游戏页面不存在:', htmlPath);
        res.status(404).send('游戏页面不存在');
      }
    });

    // 2.3 添加一个友好的404页面（如果需要）
    this.app.get('/404', (req, res) => {
      res.status(404).send(`
        <html>
          <head><title>页面不存在</title></head>
          <body>
            <h1>404 - 页面不存在</h1>
            <p><a href="/">返回首页</a></p>
          </body>
        </html>
      `);
    });
  }

  /*------------ 3. API路由（放在后面，不暴露给普通用户） --------------*/
  initApiRoutes() {
    console.log('🎮 初始化API路由...');

    // 3.1 健康检查路由 - 服务状态监控
    this.app.get('/health', (req, res) => {
      // 简单的健康检查，不暴露敏感信息
      res.json({
        status: 'healthy',
        service: 'game-store',
        timestamp: new Date().toISOString()
      });
    });

    // 3.2 内部状态路由（需要验证）
    this.app.get('/status', (req, res) => {
      // 检查是否有内部访问权限
      const internalToken = req.headers['x-internal-token'];
      if (internalToken !== process.env.INTERNAL_API_TOKEN) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      res.json(this.getStatus());
    });

    // 3.3 API根路径 - 返回简单信息，不暴露接口列表
    this.app.get('/api', (req, res) => {
      res.json({
        message: 'Game Store API',
        version: '1.0.0'
      });
    });
  }

  /*------------ 初始化数据库连接 --------------*/
  async initDatabase() {
    try {
      await dbManager.connect();
      this.dbConnected = dbManager.isConnected();
      
      if (this.dbConnected) {
        console.log('✅ 数据库连接成功');
        
        // 数据库连接成功后加载模块化路由
        this.loadModuleRoutes();
        
        // 模块化路由加载完成后，再挂载兜底路由
        this.setupFallbackRoutes();
      } else {
        throw new Error('数据库连接失败');
      }
      
    } catch (error) {
      console.error('🎮 数据库连接失败:', error.message);
      this.dbConnected = false;
      
      // 数据库连接失败时，直接挂载兜底路由确保服务基本可用
      console.log('🎮 数据库连接失败，挂载基础兜底路由');
      this.setupFallbackRoutes();
      
      // 10秒后重试连接
      setTimeout(() => this.initDatabase(), 10000);
    }
  }

  /*------------ 加载模块化路由（数据库连接成功后执行） --------------*/
  loadModuleRoutes() {
    if (this.routesLoaded) {
      console.log('🎮 路由已加载，跳过重复加载');
      return;
    }

    try {
      console.log('🎮 开始加载模块化路由...');

      if (!fs.existsSync(ROUTES_DIR)) {
        console.log('🎮 路由目录不存在，将使用基础路由模式');
        this.routesLoaded = false;
        return;
      }

      // 1. 加载 games 路由
      const gamesRoutePath = path.join(ROUTES_DIR, 'games.js');
      if (fs.existsSync(gamesRoutePath)) {
        try {
          delete require.cache[require.resolve(gamesRoutePath)];
          const gamesRouter = require(gamesRoutePath);
          this.app.use('/game-api/games', gamesRouter);
          console.log('✅ Games 模块化路由加载成功');
        } catch (error) {
          console.error('❌ Games 路由加载失败:', error.message);
        }
      }

      // 2. 加载 gameFiles 路由
      const gameFilesRoutePath = path.join(ROUTES_DIR, 'gameFiles.js');
      if (fs.existsSync(gameFilesRoutePath)) {
        try {
          delete require.cache[require.resolve(gameFilesRoutePath)];
          const gameFilesRouter = require(gameFilesRoutePath);
          this.app.use('/game-api', gameFilesRouter);
          console.log('✅ GameFiles 模块化路由加载成功');
        } catch (error) {
          console.error('❌ GameFiles 路由加载失败:', error.message);
        }
      }

      // 3. 支付系统路由
      try {
        const orderRoutePath = path.join(SHOP_ROUTES_DIR, 'order.js');
        if (fs.existsSync(orderRoutePath)) {
          delete require.cache[require.resolve(orderRoutePath)];
          const orderRouter = require(orderRoutePath);
          this.app.use('/game-api/order', orderRouter);
          console.log('✅ 支付系统路由挂载成功');
        }
      } catch (error) {
        console.error('❌ 支付系统路由挂载失败:', error.message);
      }

      // 4. 用户验证路由
      try {
        const userRoutes = require('../middlewares/user');
        this.app.use('/api', userRoutes);
        console.log('✅ 用户验证路由挂载成功');
      } catch (error) {
        console.error('❌ 用户验证路由挂载失败:', error.message);
      }

      this.routesLoaded = true;
      console.log('🎮 所有模块化路由加载完成');

    } catch (error) {
      console.error('❌ 模块化路由加载失败:', error.message);
      this.routesLoaded = false;
    }
  }

  /*------------ 设置基础兜底路由 --------------*/
  setupFallbackRoutes() {
    console.log('🎮 设置基础兜底路由...');

    // API接口的兜底路由
    this.app.get('/game-api/games', (req, res) => {
      res.json({
        success: true,
        message: '游戏商店服务运行中',
        data: []
      });
    });

    this.app.get('/game-api/games/:gameId', (req, res) => {
      res.json({
        success: true,
        message: '游戏详情服务',
        gameId: req.params.gameId,
        data: null
      });
    });

    this.app.get('/game-api/file/:fileId', (req, res) => {
      res.json({
        success: true,
        message: '文件服务运行中',
        fileId: req.params.fileId
      });
    });

    // 404处理 - 区分API请求和页面请求
    this.app.use('*', (req, res) => {
      // 如果是API请求，返回JSON
      if (req.path.startsWith('/api') || req.path.startsWith('/game-api')) {
        return res.status(404).json({
          success: false,
          error: '接口不存在'
        });
      }
      
      // 如果是页面请求，重定向到首页
      res.redirect('/');
    });
  }

  /*------------ 初始化错误处理 --------------*/
  initErrorHandling() {
    // 全局错误处理中间件
    this.app.use((err, req, res, next) => {
      console.error('🎮 全局错误:', err);

      // 不向客户端暴露错误详情
      res.status(500).json({
        success: false,
        error: '服务器内部错误'
      });
    });

    // 未捕获的异常处理
    process.on('uncaughtException', (error) => {
      console.error('🎮 未捕获的异常:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('🎮 未处理的 Promise 拒绝:', reason);
    });
  }

  /*------------ 初始化优雅关闭 --------------*/
  initGracefulShutdown() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`🎮 收到 ${signal} 信号，开始优雅关闭...`);
        this.gracefulShutdown();
      });
    });

    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        console.log('🎮 收到 PM2 关闭信号');
        this.gracefulShutdown();
      }
    });
  }

  /*------------ 优雅关闭服务 --------------*/
  async gracefulShutdown(exitCode = 0) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    console.log('🎮 开始关闭游戏服务...');
    
    try {
      if (this.server) {
        await new Promise((resolve, reject) => {
          this.server.close((err) => {
            if (err) {
              console.error('🎮 关闭 HTTP 服务器时出错:', err);
              reject(err);
            } else {
              console.log('✅ HTTP 服务器已关闭');
              resolve();
            }
          });
        });
      }
      
      if (this.dbConnected) {
        await dbManager.disconnect();
        console.log('✅ 数据库连接已关闭');
      }
      
      console.log('🎮 游戏服务关闭完成');
      process.exit(exitCode);
      
    } catch (error) {
      console.error('❌ 关闭服务时发生错误:', error);
      process.exit(1);
    }
  }
  
  /*------------ 获取服务状态信息（内部使用） --------------*/
  getStatus() {
    return {
      service: 'game-store',
      port: this.port,
      uptime: process.uptime(),
      database: {
        connected: this.dbConnected
      },
      routes: {
        loaded: this.routesLoaded
      },
      server: {
        started: this.serverStarted,
        shuttingDown: this.isShuttingDown
      },
      timestamp: new Date().toISOString()
    };
  }
}

// 创建并启动服务实例
const gameService = new GameService();

module.exports = gameService;