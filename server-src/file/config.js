// file/config.js - 配置文件
const https = require('https');
const axiosRetry = require('axios-retry');

const path = require('path');

// Shared cache / bot configuration (from environment)
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), 'downloads');
const BASE_CACHE_DIR = CACHE_DIR;
const TELEGRAM_BOT_TOKEN = process.env.FILE_BOT_TOKEN || process.env.BOT_TOKEN || '';
const TDLIGHT_BOT_DIR = TELEGRAM_BOT_TOKEN
  ? `bot_${TELEGRAM_BOT_TOKEN.split(':')[0]}`
  : 'bot_local';

// 数据库分类映射
const DB_CACHE_MAP = {
  telegramDB: 'telegram',
  testDB: 'daily',
  yyDB: 'works',
  chatDB: 'chat',
  yxDB: 'game',
  userDB: 'user',
  memberDB: 'member'
};

// Axios 配置
const axiosConfig = {
  httpsAgent: new https.Agent({ family: 4 }),
  timeout: 15000,
};

// 缓存配置
const cacheConfig = {
  lockCleanupInterval: 5 * 60 * 1000,
  indexCleanupInterval: 30 * 60 * 1000,
  maxWaitTime: 45000, // 默认45秒
  smallFileThreshold: 20 * 1024 * 1024,
  
  // 动态超时配置 - 基于文件大小
  timeoutConfig: {
    default: 45000,           // 45秒 - 未知大小
    smallFile: 20000,         // 20秒 (< 20MB)
    mediumFile: 30000,        // 30秒 (20-50MB)
    largeFile: 45000,         // 45秒 (50-100MB)
    veryLargeFile: 60000,     // 1分钟 (100-200MB)
    hugeFile: 90000,          // 1.5分钟 (200-500MB)
    enormousFile: 120000      // 2分钟 (> 500MB)
  },

  // 🆕 内存管理配置
  memoryManagement: {
    maxHeapSize: 500 * 1024 * 1024, // 500MB 内存阈值
    checkInterval: 120000,           // 2分钟检查一次
    cleanupThreshold: 0.5,          // 内存使用率80%时清理
    preserveHotEntries: 1000,       // 保留最近访问的1000个条目
    entryTTL: 5 * 60 * 60 * 1000    // 条目存活时间2小时
  },

  // 🆕 性能优化配置
  performance: {
    healthCheckInterval: 5 * 60 * 1000, // 5分钟健康检查
    warmUpBatchSize: 50,                 // 预热批次大小
    maxConcurrentDownloads: 10,           // 最大并发下载数
    downloadRetention: 24 * 60 * 60 * 1000 // 下载记录保留24小时
  }
};

module.exports = {
  CACHE_DIR,
  BASE_CACHE_DIR,
  TELEGRAM_BOT_TOKEN,
  TDLIGHT_BOT_DIR,
  DB_CACHE_MAP,
  axiosConfig,
  cacheConfig
};