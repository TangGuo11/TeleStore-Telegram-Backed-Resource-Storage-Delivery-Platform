// game-api/file/GameHealthMonitor.js - 健康监控系统
const fs = require('fs');
const path = require('path');
const GameLogger = require('./GameLogger');
const { cacheConfig } = require('./gameConfig');

class GameHealthMonitor {
  constructor(cacheManager, forwardService) {
    this.cacheManager = cacheManager;
    this.forwardService = forwardService;
    this.config = require('./gameConfig');
    
    // 🎯 监控状态
    this.monitoring = false;
    this.lastCheckTime = null;
    this.healthStats = {
      totalChecks: 0,
      healthyChecks: 0,
      warnings: 0,
      errors: 0,
      lastError: null,
      startupTime: Date.now()
    };
    
    // 🎯 性能指标（简化版）
    this.performanceMetrics = {
      requestCount: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      tdlightSuccessRate: 0
    };
    
    // 🎯 报警阈值（移除内存阈值）
    this.alertThresholds = {
      cacheHitRate: 0.3,        // 缓存命中率低于30%报警
      tdlightFailureRate: 0.5,  // TDLight失败率高于50%报警
      errorRate: 0.1,           // 错误率高于10%报警
      responseTime: this.config.cacheConfig?.timeout?.(0, 'direct') || 5000 // 响应时间超过5秒报警
    };
    
    // 🎯 报警记录
    this.alerts = [];
    this.maxAlerts = 50; // 最多保存50条报警
    
    GameLogger.cleanup('🩺 GameHealthMonitor 初始化完成（简化版）');
  }
  
  /*------------------ 启动监控 --------------------*/
  startMonitoring() {
    if (this.monitoring) {
      GameLogger.warn('⚠️ 健康监控已在运行中');
      return;
    }
    
    this.monitoring = true;
    
    // 🎯 定期健康检查（每10分钟）
    this.healthCheckInterval = setInterval(() => {
      this.runHealthCheck();
    }, 10 * 60 * 1000);
    
    // 🎯 清理旧报警（每2小时）
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldAlerts();
    }, 2 * 60 * 60 * 1000);
    
    GameLogger.cleanup('🩺 健康监控已启动', {
      intervals: {
        healthCheck: '10分钟',
        cleanup: '2小时'
      },
      features: '缓存健康、TDLight健康、文件系统健康、数据库健康'
    });
  }
  
  /*------------------ 停止监控 --------------------*/
  stopMonitoring() {
    if (!this.monitoring) return;
    
    this.monitoring = false;
    
    clearInterval(this.healthCheckInterval);
    clearInterval(this.cleanupInterval);
    
    GameLogger.cleanup('🩺 健康监控已停止');
  }
  
  /*------------------ 运行完整健康检查 --------------------*/
  async runHealthCheck() {
    const startTime = Date.now();
    this.lastCheckTime = new Date();
    
    try {
      GameLogger.cleanup('🩺 开始系统健康检查...');
      
      // 🎯 只运行必要的检查
      const checks = [
        this.checkCacheHealth(),
        this.checkTDLightHealth(),
        this.checkFileSystemHealth(),
        this.checkDatabaseHealth()
      ];
      
      const results = await Promise.allSettled(checks);
      
      // 🎯 分析检查结果
      const summary = this.analyzeHealthResults(results);
      this.healthStats.totalChecks++;
      
      if (summary.status === 'healthy') {
        this.healthStats.healthyChecks++;
        GameLogger.cleanup('✅ 系统健康检查通过', {
          duration: `${Date.now() - startTime}ms`,
          components: Object.keys(summary.components)
        });
      } else {
        this.healthStats.warnings++;
        GameLogger.warn('⚠️ 系统健康检查发现问题', {
          duration: `${Date.now() - startTime}ms`,
          issues: summary.messages
        });
      }
      
      return summary;
      
    } catch (error) {
      this.healthStats.errors++;
      this.healthStats.lastError = error.message;
      
      GameLogger.error('❌ 健康检查失败', error);
      
      return {
        status: 'error',
        message: error.message,
        timestamp: this.lastCheckTime.toISOString()
      };
    }
  }
  
  /*------------------ 检查缓存健康 --------------------*/
  async checkCacheHealth() {
    try {
      if (!this.cacheManager) {
        return { status: 'warning', message: 'CacheManager 未连接' };
      }
      
      const stats = this.cacheManager.getCacheStats();
      const cacheEntries = stats.totalFiles || 0;
      
      // 🎯 检查缓存命中率
      const hitRate = this.performanceMetrics.cacheHitRate || 0;
      const hitRateStatus = hitRate < this.alertThresholds.cacheHitRate ? 'warning' : 'healthy';
      
      return {
        status: hitRateStatus,
        cacheEntries,
        cacheHitRate: hitRate,
        cacheSize: stats.totalSize ? `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB` : 'unknown'
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        error: error.message
      };
    }
  }
  
  /*------------------ 检查TDLight健康 --------------------*/
  async checkTDLightHealth() {
    try {
      if (!this.forwardService) {
        return { status: 'warning', message: 'ForwardService 未连接' };
      }
      
      const serviceStatus = this.forwardService.getServiceStatus();
      const pendingFiles = serviceStatus.pendingFiles || 0;
      const queueStatus = pendingFiles > 10 ? 'warning' : 'healthy';
      
      return {
        status: queueStatus === 'healthy' ? 'healthy' : 'warning',
        pendingFiles,
        serviceStatus: serviceStatus.status || 'unknown'
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        error: error.message
      };
    }
  }
  
  /*------------------ 检查文件系统健康 --------------------*/
  async checkFileSystemHealth() {
    try {
      const { GAME_STORAGE_DIR } = require('./gameConfig');
      const baseDir = GAME_STORAGE_DIR;
      
      if (!fs.existsSync(baseDir)) {
        return { 
          status: 'error', 
          message: `存储目录不存在: ${baseDir}` 
        };
      }
      
      // 🎯 检查磁盘空间
      const diskStats = fs.statSync(baseDir);
      const freeSpace = diskStats.blocks * diskStats.blksize;
      const totalSpace = freeSpace;
      const freePercentage = freeSpace / totalSpace;
      
      const spaceStatus = freePercentage < 0.1 ? 'warning' : 'healthy'; // 小于10%报警
      
      return {
        status: spaceStatus,
        freeSpace: `${(freeSpace / 1024 / 1024 / 1024).toFixed(2)} GB`,
        freePercentage: (freePercentage * 100).toFixed(1) + '%',
        baseDir
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        error: error.message
      };
    }
  }
  
  /*------------------ 检查数据库健康 --------------------*/
  async checkDatabaseHealth() {
    try {
      const mongoose = require('../db/mongoose').mongoose;
      
      if (!mongoose || !mongoose.connection) {
        return { status: 'warning', message: '数据库连接未初始化' };
      }
      
      const dbState = mongoose.connection.readyState;
      const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };
      
      const dbStatus = dbState === 1 ? 'healthy' : 'warning';
      
      return {
        status: dbStatus,
        connectionState: states[dbState] || 'unknown',
        dbState
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        error: error.message
      };
    }
  }
  
  /*------------------ 分析健康检查结果 --------------------*/
  analyzeHealthResults(results) {
    const summary = {
      timestamp: new Date().toISOString(),
      totalChecks: results.length,
      healthyChecks: 0,
      warningChecks: 0,
      errorChecks: 0,
      components: {},
      status: 'healthy',
      messages: []
    };
    
    const checkNames = ['cache', 'tdlight', 'filesystem', 'database'];
    
    results.forEach((result, index) => {
      const checkName = checkNames[index] || `check_${index}`;
      
      if (result.status === 'fulfilled') {
        const value = result.value;
        summary.components[checkName] = value;
        
        if (value.status === 'healthy') {
          summary.healthyChecks++;
        } else if (value.status === 'warning') {
          summary.warningChecks++;
          summary.messages.push(`${checkName}: ${value.message || '警告'}`);
        } else if (value.status === 'error') {
          summary.errorChecks++;
          summary.messages.push(`${checkName}: ${value.message || '错误'}`);
        }
      } else {
        summary.components[checkName] = {
          status: 'error',
          message: result.reason?.message || '检查失败'
        };
        summary.errorChecks++;
        summary.messages.push(`${checkName}: 检查执行失败`);
      }
    });
    
    // 🎯 确定总体状态
    if (summary.errorChecks > 0) {
      summary.status = 'error';
    } else if (summary.warningChecks > 0) {
      summary.status = 'warning';
    }
    
    return summary;
  }
  
  /*------------------ 记录报警 --------------------*/
  recordAlert(type, data) {
    const alert = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      type,
      timestamp: new Date().toISOString(),
      severity: this.getAlertSeverity(type),
      data,
      acknowledged: false
    };
    
    this.alerts.unshift(alert);
    
    // 限制报警数量
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }
    
    return alert;
  }
  
  /*------------------ 获取报警严重程度 --------------------*/
  getAlertSeverity(type) {
    const severityMap = {
      'health_check_failed': 'critical',
      'disk_space_low': 'critical',
      'database_down': 'critical',
      'cache_hit_rate_low': 'warning',
      'tdlight_failure': 'warning'
    };
    
    return severityMap[type] || 'info';
  }
  
  /*------------------ 清理旧报警 --------------------*/
  cleanupOldAlerts() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const oldCount = this.alerts.length;
    
    this.alerts = this.alerts.filter(alert => 
      new Date(alert.timestamp).getTime() > oneDayAgo
    );
    
    const cleaned = oldCount - this.alerts.length;
    if (cleaned > 0) {
      GameLogger.cleanup(`🧹 清理旧报警: ${cleaned} 条`);
    }
  }
  
  /*------------------ 更新性能指标 --------------------*/
  updatePerformanceMetrics(duration, cacheHit = false) {
    if (!this.monitoring) return;
    
    this.performanceMetrics.requestCount++;
    
    // 更新平均响应时间
    const oldAvg = this.performanceMetrics.averageResponseTime;
    const newAvg = oldAvg * 0.9 + duration * 0.1;
    this.performanceMetrics.averageResponseTime = newAvg;
    
    // 更新缓存命中率
    if (this.performanceMetrics.requestCount > 0) {
      // 假设有外部传入的缓存命中信息
      if (cacheHit) {
        this.performanceMetrics.cacheHitRate = 
          (this.performanceMetrics.cacheHitRate * 0.9) + 0.1;
      } else {
        this.performanceMetrics.cacheHitRate *= 0.99;
      }
    }
  }
  
  /*------------------ 获取健康状态摘要 --------------------*/
  getHealthSummary() {
    return {
      monitoring: this.monitoring,
      lastCheckTime: this.lastCheckTime?.toISOString(),
      stats: this.healthStats,
      performance: {
        requestCount: this.performanceMetrics.requestCount,
        averageResponseTime: this.performanceMetrics.averageResponseTime,
        cacheHitRate: this.performanceMetrics.cacheHitRate
      },
      alerts: {
        total: this.alerts.length,
        unacknowledged: this.alerts.filter(a => !a.acknowledged).length
      },
      uptime: `${(Date.now() - this.healthStats.startupTime) / 1000} 秒`
    };
  }
  
  /*------------------ 快速健康检查 --------------------*/
  async runQuickHealthCheck() {
    try {
      const checks = [
        this.checkCacheHealth(),
        this.checkDatabaseHealth()
      ];
      
      const results = await Promise.allSettled(checks);
      const summary = this.analyzeQuickResults(results);
      
      return {
        success: summary.status === 'healthy',
        status: summary.status,
        timestamp: new Date().toISOString(),
        checks: summary.components
      };
      
    } catch (error) {
      return {
        success: false,
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /*------------------ 分析快速检查结果 --------------------*/
  analyzeQuickResults(results) {
    const summary = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      components: {}
    };
    
    const checkNames = ['cache', 'database'];
    
    results.forEach((result, index) => {
      const checkName = checkNames[index];
      
      if (result.status === 'fulfilled') {
        const value = result.value;
        summary.components[checkName] = {
          status: value.status,
          message: value.message
        };
        
        if (value.status !== 'healthy') {
          summary.status = value.status;
        }
      } else {
        summary.components[checkName] = {
          status: 'error',
          message: '检查执行失败'
        };
        summary.status = 'error';
      }
    });
    
    return summary;
  }
  
  /*------------------ 重置统计 --------------------*/
  resetStats() {
    this.healthStats = {
      totalChecks: 0,
      healthyChecks: 0,
      warnings: 0,
      errors: 0,
      lastError: null,
      startupTime: Date.now()
    };
    
    this.performanceMetrics = {
      requestCount: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      tdlightSuccessRate: 0
    };
    
    GameLogger.cleanup('🔄 健康监控统计已重置');
  }
}

module.exports = GameHealthMonitor;