// game-api/core/moduleLoader.js - 处理模块加载
const path = require('path');

class ModuleLoader {
  constructor() {
    this.moduleCache = new Map();
    this.loadingModules = new Set();
    this.logger = null; // 先不依赖其他模块
  }
  
  /*------------------ 主加载方法 --------------------*/
  load(modulePath, clearCache = false) {
    try {
      const absolutePath = this.resolveModulePath(modulePath);
      
      // 防止循环加载
      if (this.loadingModules.has(absolutePath)) {
        throw new Error(`检测到循环加载: ${modulePath}`);
      }
      
      this.loadingModules.add(absolutePath);
      
      if (clearCache) {
        this.clearModuleCache(absolutePath);
      }
      
      if (!this.moduleCache.has(absolutePath)) {
        const module = this.requireModule(absolutePath);
        this.moduleCache.set(absolutePath, module);
        
        if (this.logger) {
          this.logger.cache(`✅ 模块加载: ${modulePath}`);
        } else {
          console.log(`✅ 模块加载: ${modulePath}`);
        }
      }
      
      const cachedModule = this.moduleCache.get(absolutePath);
      this.loadingModules.delete(absolutePath);
      
      return cachedModule;
      
    } catch (error) {
      this.loadingModules.delete(absolutePath);
      throw error;
    }
  }
  
  /*------------------ 安全地 require 模块 --------------------*/
  requireModule(absolutePath) {
    // 清除模块缓存
    delete require.cache[absolutePath];
    
    try {
      return require(absolutePath);
    } catch (error) {
      // 如果是 GameLogger 相关的错误，尝试修复
      if (error.message.includes('GameLogger') || error.message.includes('getTimestamp')) {
        console.warn(`⚠️ 检测到 GameLogger 相关错误，尝试修复: ${error.message}`);
        return this.fixGameLoggerIssue(absolutePath);
      }
      throw error;
    }
  }
  
  /*------------------ 修复 GameLogger 问题 --------------------*/
  fixGameLoggerIssue(modulePath) {
    const moduleName = path.basename(modulePath, '.js');
    
    if (moduleName === 'GameLogger') {
      // 创建修复版的 GameLogger
      return this.createFixedGameLogger();
    } else {
      // 对于依赖 GameLogger 的模块，先确保 GameLogger 可用
      console.log(`🔧 修复模块依赖: ${moduleName}`);
      
      // 先加载修复版的 GameLogger
      const fixedLogger = this.createFixedGameLogger();
      this.moduleCache.set(this.resolveModulePath('./GameLogger'), fixedLogger);
      
      // 重新加载目标模块
      delete require.cache[modulePath];
      return require(modulePath);
    }
  }
  
  /*------------------ 创建修复版的 GameLogger --------------------*/
  createFixedGameLogger() {
    console.log('🔧 创建修复版 GameLogger...');
    
    function getTimestamp() {
      return new Date().toISOString().replace('T', ' ').substring(0, 19);
    }
    
    const GameLogger = {
      file(msg, data = null) {
        const logMsg = `[${getTimestamp()}] [GAME-FILE] ${msg}`;
        console.log(logMsg);
        if (data) console.log('  Data:', data);
        return logMsg;
      },
      
      cache(msg, data = null) {
        const logMsg = `[${getTimestamp()}] [GAME-CACHE] ${msg}`;
        console.log(logMsg);
        if (data) console.log('  Data:', data);
        return logMsg;
      },
      
      tdlight(msg, data = null) {
        const logMsg = `[${getTimestamp()}] [GAME-TDLIGHT] ${msg}`;
        console.log(logMsg);
        if (data) console.log('  Data:', data);
        return logMsg;
      },
      
      download(msg, data = null) {
        const logMsg = `[${getTimestamp()}] [GAME-DOWNLOAD] ${msg}`;
        console.log(logMsg);
        if (data) console.log('  Data:', data);
        return logMsg;
      },
      
      cleanup(msg, data = null) {
        const logMsg = `[${getTimestamp()}] [GAME-CLEANUP] ${msg}`;
        console.log(logMsg);
        if (data) console.log('  Data:', data);
        return logMsg;
      },
      
      error(msg, error = null) {
        const logMsg = `[${getTimestamp()}] [GAME-ERROR] ${msg}`;
        console.error(logMsg);
        if (error) {
          console.error('  Error Details:', error.message);
          if (error.stack) console.error('  Stack:', error.stack);
        }
        return logMsg;
      },
      
      warn(msg, data = null) {
        const logMsg = `[${getTimestamp()}] [GAME-WARN] ${msg}`;
        console.warn(logMsg);
        if (data) console.warn('  Warning Data:', data);
        return logMsg;
      },
      
      getTimestamp
    };
    
    return GameLogger;
  }
  
  /*------------------ 解析模块路径 --------------------*/
  resolveModulePath(modulePath) {
    try {
      // 如果是相对路径，基于调用位置解析
      if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
        // 获取调用栈信息
        const stack = new Error().stack.split('\n');
        const callerLine = stack[3]; // 第3行是调用者
        const match = callerLine.match(/\((.*):\d+:\d+\)/);
        
        if (match && match[1]) {
          const callerPath = match[1];
          const callerDir = path.dirname(callerPath);
          return require.resolve(path.join(callerDir, modulePath));
        }
      }
      
      return require.resolve(modulePath);
    } catch (error) {
      console.error(`❌ 无法解析模块路径: ${modulePath}`, error.message);
      throw error;
    }
  }
  
  /*------------------ 清除模块缓存 --------------------*/
  clearModuleCache(absolutePath) {
    delete require.cache[absolutePath];
    this.moduleCache.delete(absolutePath);
    
    if (this.logger) {
      this.logger.cleanup(`🧹 清除模块缓存: ${absolutePath}`);
    } else {
      console.log(`🧹 清除模块缓存: ${absolutePath}`);
    }
  }
  
  /*------------------ 清除所有缓存 --------------------*/
  clearAll() {
    this.moduleCache.clear();
    this.loadingModules.clear();
    
    if (this.logger) {
      this.logger.cleanup('🧹 已清除所有模块缓存');
    } else {
      console.log('🧹 已清除所有模块缓存');
    }
  }
  
  /*------------------ 设置 logger（用于内部日志） --------------------*/
  setLogger(logger) {
    this.logger = logger;
  }
  
  /*------------------ 获取缓存状态 --------------------*/
  getCacheStatus() {
    return {
      cachedModules: Array.from(this.moduleCache.keys()).map(p => path.basename(p)),
      loadingModules: Array.from(this.loadingModules),
      cacheSize: this.moduleCache.size
    };
  }
}

// 🎯 导出单例
module.exports = new ModuleLoader();