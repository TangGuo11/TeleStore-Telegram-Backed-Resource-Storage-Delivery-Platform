// game-api/routes/gameFiles.js
const express = require('express');
const router = express.Router();

console.log('🎮 GameFiles 路由开始加载...');

// 🎯 引入 ModuleLoader
let ModuleLoader;
try {
  ModuleLoader = require('../core/moduleLoader');
  console.log('✅ ModuleLoader 加载成功');
} catch (error) {
  console.error('❌ 无法加载 ModuleLoader:', error.message);
  
  // 创建简单的 ModuleLoader 回退
  ModuleLoader = {
    moduleCache: new Map(),
    load(modulePath, clearCache = false) {
      const absolutePath = require.resolve(modulePath);
      
      if (clearCache) {
        delete require.cache[absolutePath];
        this.moduleCache.delete(absolutePath);
      }
      
      if (!this.moduleCache.has(absolutePath)) {
        const module = require(modulePath);
        this.moduleCache.set(absolutePath, module);
        console.log(`✅ 模块加载: ${modulePath}`);
        return module;
      }
      
      return this.moduleCache.get(absolutePath);
    },
    clearAll() {
      this.moduleCache.clear();
      console.log('🧹 已清除模块缓存');
    },
    getCacheStatus() {
      return {
        cachedModules: Array.from(this.moduleCache.keys()).map(p => {
          const match = p.match(/([^\/\\]+)\.js$/);
          return match ? match[1] : 'unknown';
        }),
        cacheSize: this.moduleCache.size
      };
    }
  };
}

// 🎯 使用 ModuleLoader 加载模块
let logger;
let GameFileController;
let gameFileControllerInstance;

try {
  // 1. 先加载 GameLogger（清除缓存确保干净）
  console.log('🔄 加载 GameLogger...');
  logger = ModuleLoader.load('../file/GameLogger', true);
  
  if (!logger || typeof logger.cache !== 'function') {
    throw new Error('GameLogger 加载异常，方法不存在');
  }
  
  logger.cache('✅ GameLogger 加载成功');
  
  // 2. 加载 GameFileController
  logger.cache('🔄 加载 GameFileController...');
  GameFileController = ModuleLoader.load('../file/GameFileController', true);
  
  if (!GameFileController) {
    throw new Error('GameFileController 加载失败');
  }

  logger.cache('✅ GameFileController 加载成功');
  
  // 3. 实例化控制器
  logger.cache('🔄 实例化 GameFileController...');
  gameFileControllerInstance = new GameFileController();
  
  logger.cache('✅ GameFileController 实例化成功');
  
  // 4. 设置路由
  setupRoutes();
  
  logger.cache('✅ GameFiles 路由配置完成');
  
} catch (error) {
  console.error('❌ 模块加载失败:', error.message);
  console.error('❌ 错误堆栈:', error.stack);
  
  // 如果有 logger，使用 logger 记录
  if (logger && logger.error) {
    logger.error('模块加载失败:', error);
  }
  
  // 创建应急方案
  setupEmergencyRoutes();
}

/*------------------ 正常路由设置 --------------------*/
function setupRoutes() {
  if (!gameFileControllerInstance) {
    logger.error('❌ gameFileControllerInstance 未初始化');
    setupEmergencyRoutes();
    return;
  }
  
  // 🎯 文件下载路由
  router.get('/file/:fileId', (req, res) => {
    logger.file(`📥 文件请求: ${req.params.fileId}`, {
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown',
      ip: req.ip || req.connection.remoteAddress
    });
    
    gameFileControllerInstance.handleGameFileRequest(req, res);
  });
  
  // 🎯 健康检查路由
  router.get('/health', (req, res) => {
    try {
      if (gameFileControllerInstance.handleHealthCheck) {
        gameFileControllerInstance.handleHealthCheck(req, res);
      } else {
        res.json({
          success: true,
          status: 'healthy',
          service: 'game-files',
          modules: {
            logger: 'loaded',
            controller: 'loaded',
            instance: 'initialized'
          },
          moduleCache: ModuleLoader.getCacheStatus ? ModuleLoader.getCacheStatus() : { manual: true },
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('健康检查失败:', error);
      res.status(500).json({
        success: false,
        error: '健康检查失败',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // 🎯 状态检查路由
  router.get('/status', (req, res) => {
    try {
      if (gameFileControllerInstance.getControllerStatus) {
        const status = gameFileControllerInstance.getControllerStatus();
        res.json({
          success: true,
          ...status,
          moduleCache: ModuleLoader.getCacheStatus ? ModuleLoader.getCacheStatus() : { manual: true },
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          status: 'running',
          service: 'game-files',
          modules: {
            logger: 'loaded',
            controller: 'loaded',
            instance: 'initialized'
          },
          moduleCache: ModuleLoader.getCacheStatus ? ModuleLoader.getCacheStatus() : { manual: true },
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('状态检查失败:', error);
      res.status(500).json({
        success: false,
        error: '状态检查失败',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // 🎯 缓存管理路由（仅开发环境）
  if (process.env.NODE_ENV !== 'production') {
    router.post('/cache/clear', (req, res) => {
      try {
        if (ModuleLoader.clearAll) {
          ModuleLoader.clearAll();
        } else {
          ModuleLoader.moduleCache.clear();
        }
        
        logger.cleanup('🧹 模块缓存已清除');
        
        res.json({
          success: true,
          message: '模块缓存已清除',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('清除缓存失败:', error);
        res.status(500).json({
          success: false,
          error: '清除缓存失败',
          timestamp: new Date().toISOString()
        });
      }
    });
  }
  
  // 🎯 重启路由（仅开发环境）
  if (process.env.NODE_ENV !== 'production') {
    router.post('/restart', async (req, res) => {
      try {
        logger.warn('🔄 手动重启文件模块...');
        
        // 清除缓存
        if (ModuleLoader.clearAll) {
          ModuleLoader.clearAll();
        } else {
          ModuleLoader.moduleCache.clear();
        }
        
        // 重新加载
        logger = ModuleLoader.load('../file/GameLogger', true);
        GameFileController = ModuleLoader.load('../file/GameFileController', true);
        gameFileControllerInstance = new GameFileController();
        
        logger.cache('✅ 文件模块重启完成');
        
        res.json({
          success: true,
          message: '文件模块重启完成',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('重启失败:', error);
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });
  }
}

/*------------------ 应急路由方案 --------------------*/
function setupEmergencyRoutes() {
  console.log('⚠️ 使用应急路由方案');
  
  // 创建应急 logger
  const emergencyLogger = {
    file: (msg) => console.log(`[EMERGENCY-FILE] ${msg}`),
    error: (msg) => console.error(`[EMERGENCY-ERROR] ${msg}`),
    warn: (msg) => console.warn(`[EMERGENCY-WARN] ${msg}`)
  };
  
  // 🎯 文件下载路由（应急）
  router.get('/file/:fileId', (req, res) => {
    emergencyLogger.file(`📥 文件请求（应急模式）: ${req.params.fileId}`);
    
    res.json({
      success: true,
      message: '文件服务正在启动，请稍后重试',
      fileId: req.params.fileId,
      mode: 'emergency',
      timestamp: new Date().toISOString(),
      note: '模块加载失败，正在恢复...'
    });
  });
  
  // 🎯 健康检查路由（应急）
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      status: 'unhealthy',
      service: 'game-files',
      mode: 'emergency',
      issues: ['模块加载失败'],
      timestamp: new Date().toISOString(),
      recovery: '正在尝试自动恢复...'
    });
  });
  
  // 🎯 状态检查路由（应急）
  router.get('/status', (req, res) => {
    res.json({
      success: true,
      status: 'emergency',
      modules: {
        logger: logger ? 'loaded' : 'failed',
        controller: GameFileController ? 'loaded' : 'failed',
        instance: gameFileControllerInstance ? 'initialized' : 'failed'
      },
      mode: 'emergency',
      timestamp: new Date().toISOString(),
      recommendation: '请检查日志并重启服务'
    });
  });
  
  // 🎯 重试路由（应急）
  router.post('/retry', (req, res) => {
    emergencyLogger.warn('🔄 手动重试加载模块...');
    
    try {
      // 清除缓存
      Object.keys(require.cache).forEach(key => {
        if (key.includes('game-api/file/')) {
          delete require.cache[key];
        }
      });
      
      if (ModuleLoader.moduleCache) {
        ModuleLoader.moduleCache.clear();
      }
      
      // 尝试重新加载
      const newLogger = require('../file/GameLogger');
      const newController = require('../file/GameFileController');
      
      emergencyLogger.file('✅ 模块重载成功');
      
      res.json({
        success: true,
        message: '模块重载成功，请刷新页面',
        timestamp: new Date().toISOString()
      });
      
    } catch (retryError) {
      emergencyLogger.error('重试失败:', retryError.message);
      
      res.status(500).json({
        success: false,
        error: retryError.message,
        timestamp: new Date().toISOString()
      });
    }
  });
}

console.log('🎮 GameFiles 路由加载完成');
module.exports = router;