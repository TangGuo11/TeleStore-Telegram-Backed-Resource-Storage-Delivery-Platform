// file/CacheManager.js - 缓存管理（支持数据库分类和软链接）
const fs = require('fs');
const path = require('path');
const { getCacheFileName, logger, getFileTypeSubDir, createSymlinkToBusiness, fileExists, checkSymlinkHealth } = require('./utils');
const { CACHE_DIR, BASE_CACHE_DIR, TDLIGHT_BOT_DIR, DB_CACHE_MAP, cacheConfig } = require('./config');

class CacheManager {
  constructor() {
    // 🔄 修改1：cacheIndex 存储对象而不是简单路径
    this.cacheIndex = new Map(); // fileId -> {path, lastAccess, accessCount, createdTime}
    this.cachingSet = new Set(); // 正在缓存的 uniqueId 集合
    this.creatingSymlinks = new Set(); // 正在创建软链接的 fileId 集合
    
    // 🔄 修改2：用智能清理替换原来的简单清理
    this.setupSmartCleanup();
    this.ensureCacheDir();
  }

  /*------------------ 初始化缓存目录 --------------------*/
  ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  /*------------------ 智能内存清理（替换原来的setupCleanupIntervals） --------------------*/
  setupSmartCleanup() {
    const { memoryManagement, lockCleanupInterval } = cacheConfig;
    
    // 🔄 修改3：智能内存监控
    setInterval(() => {
      this.monitorAndCleanup();
    }, memoryManagement.checkInterval);

    // 🔄 修改4：保留原来的锁清理逻辑，但调整间隔
    setInterval(() => {
      if (this.cachingSet.size > 0) {
        // 不直接clear，只清理过期的锁
        this.cleanupExpiredLocks();
      }
    }, lockCleanupInterval);

    // 🔄 修改5：清理创建中的软链接标记（保持原逻辑）
    setInterval(() => {
      if (this.creatingSymlinks.size > 0) {
        this.creatingSymlinks.clear();
      }
    }, 60000);

    logger.cleanup('✅ 智能内存清理已启动');
  }

  /*------------------ 新增：监控和清理 --------------------*/
  monitorAndCleanup() {
    const memoryUsage = process.memoryUsage();
    const { maxHeapSize, cleanupThreshold } = cacheConfig.memoryManagement;
    
    const memoryPressure = memoryUsage.heapUsed / maxHeapSize;
    
    if (memoryPressure > cleanupThreshold) {
      const entriesBefore = this.cacheIndex.size;
      this.cleanupOldEntries();
      const entriesAfter = this.cacheIndex.size;
      
      logger.cleanup(`🧹 内存压力清理: ${memoryPressure.toFixed(2)} > ${cleanupThreshold}, 条目 ${entriesBefore} → ${entriesAfter}`);
    }
  }

  /*------------------ 新增：清理旧条目 --------------------*/
  cleanupOldEntries() {
    const { preserveHotEntries, entryTTL } = cacheConfig.memoryManagement;
    const now = Date.now();
    
    if (this.cacheIndex.size <= preserveHotEntries) {
      return; // 条目数量不多，不需要清理
    }

    // 收集所有条目并按热度排序
    const entries = Array.from(this.cacheIndex.entries()).map(([key, value]) => ({
      key,
      ...value,
      score: this.calculateEntryScore(value, now)
    }));

    // 按分数排序（分数低的先清理）
    entries.sort((a, b) => a.score - b.score);

    // 保留热门条目，清理其余的
    const toRemove = entries.slice(preserveHotEntries);
    
    for (const entry of toRemove) {
      this.cacheIndex.delete(entry.key);
    }

    logger.cleanup(`📊 清理完成: 保留 ${preserveHotEntries} 个热门条目, 移除 ${toRemove.length} 个旧条目`);
  }

  /*------------------ 新增：计算条目分数 --------------------*/
  calculateEntryScore(entry, currentTime) {
    const { lastAccess, accessCount, createdTime } = entry;
    const age = currentTime - createdTime;
    const recency = currentTime - lastAccess;
    
    // 分数公式: 访问频率 * 时间衰减
    const frequencyScore = Math.log(accessCount + 1);
    const recencyScore = Math.max(0, 1 - (recency / (60 * 60 * 1000))); // 1小时内访问得分高
    const ageScore = Math.max(0, 1 - (age / (24 * 60 * 60 * 1000))); // 1天内创建得分高
    
    return frequencyScore * 0.4 + recencyScore * 0.4 + ageScore * 0.2;
  }

  /*------------------ 新增：清理过期锁 --------------------*/
  cleanupExpiredLocks() {
    // 这里可以添加更智能的锁清理逻辑
    // 目前保持原样，只是不清空所有锁
    if (this.cachingSet.size > 1000) {
      // 如果锁数量过多，清理一半
      const array = Array.from(this.cachingSet);
      this.cachingSet = new Set(array.slice(0, Math.floor(array.length / 2)));
      logger.cleanup(`🔓 清理过多锁: ${array.length} → ${this.cachingSet.size}`);
    }
  }

  /*------------------ 检查缓存健康状况 --------------------*/
  async checkCacheHealth(fileId, dbName = 'telegramDB', fileType = '') {
    const cacheKey = this.getCacheKey(fileId, dbName, fileType);
    const entry = this.cacheIndex.get(cacheKey); // 🔄 修改6：获取entry而不是直接path
    
    if (!entry) {
      return { healthy: false, reason: '缓存索引中不存在' };
    }

    // 检查是否正在创建软链接
    if (this.creatingSymlinks.has(cacheKey)) {
      return { healthy: true, reason: '创建中，跳过检查' };
    }

    // 检查文件/软链接健康状况
    const health = await checkSymlinkHealth(entry.path); // 🔄 修改7：使用entry.path
    
    if (!health.healthy) {
      this.cacheIndex.delete(cacheKey);
    }
    
    return health;
  }

  /*------------------ 主缓存检查流程 --------------------*/
  async checkCache(fileId, file, dbName = 'telegramDB', fileType = '') {
    // 先查TDLight缓存并创建软链接
    const tdlightCache = await this.checkTDLightCacheWithSymlink(file, fileId, dbName, fileType);
    if (tdlightCache.hit) {
      const health = await this.checkCacheHealth(fileId, dbName, fileType);
      if (health.healthy) {
        return tdlightCache;
      }
    }

    // 查本地分类缓存
    const localCache = await this.checkLocalCache(fileId, dbName, fileType);
    if (localCache.hit) {
      const health = await this.checkCacheHealth(fileId, dbName, fileType);
      if (health.healthy) {
        return localCache;
      } else {
        this.cacheIndex.delete(this.getCacheKey(fileId, dbName, fileType));
      }
    }

    return { hit: false };
  }

  /*------------------ 检查TDLight缓存并创建软链接 --------------------*/
  async checkTDLightCacheWithSymlink(file, fileId, dbName = 'telegramDB', fileType = '') {
    const tdlightResult = this.checkTDLightCache(file);
    
    if (tdlightResult.hit) {
      const cacheKey = this.getCacheKey(fileId, dbName, fileType);
      
      try {
        this.creatingSymlinks.add(cacheKey);
        
        // 创建软链接到业务目录
        const businessPath = await createSymlinkToBusiness(
          tdlightResult.path,
          fileId,
          file.file_unique_id,
          dbName,
          fileType
        );
        
        this.addToCacheIndex(fileId, businessPath, dbName, fileType);
        
        return {
          hit: true,
          type: 'TDLight-软链接',
          path: businessPath,
          filename: path.basename(businessPath),
          isSymlink: true,
          realPath: tdlightResult.path
        };
      } catch (error) {
        logger.error(`❌ TDLight软链接创建失败: ${error.message}`);
        // 失败时回退到直接使用TDLight路径
        return tdlightResult;
      } finally {
        this.creatingSymlinks.delete(cacheKey);
      }
    }
    
    return { hit: false };
  }

  /*------------------ 检查TDLight缓存目录 --------------------*/
  checkTDLightCache(file) {
    if (file.file_path && file.file_path.trim() !== '') {
      const tdlightFilePath = path.resolve(BASE_CACHE_DIR, TDLIGHT_BOT_DIR, file.file_path);
      const exists = fs.existsSync(tdlightFilePath);
      if (exists) {
        return {
          hit: true,
          type: 'TDLight',
          path: tdlightFilePath,
          filename: path.basename(tdlightFilePath),
        };
      }
    }
    return { hit: false };
  }

  /*------------------ 检查本地分类缓存 --------------------*/
  async checkLocalCache(fileId, dbName = 'telegramDB', fileType = '') {
    // 内存索引命中
    const cacheKey = this.getCacheKey(fileId, dbName, fileType);
    if (this.cacheIndex.has(cacheKey)) {
      const entry = this.cacheIndex.get(cacheKey); // 🔄 修改8：获取entry
      const cachedPath = entry.path; // 🔄 修改9：使用entry.path
      if (cachedPath && await fileExists(cachedPath)) {
        // 🔄 修改10：更新访问时间
        entry.lastAccess = Date.now();
        entry.accessCount++;
        
        // 检查是否正在创建软链接
        if (this.creatingSymlinks.has(cacheKey)) {
          return {
            hit: true,
            type: '本地',
            path: cachedPath,
            filename: path.basename(cachedPath),
            isSymlink: true
          };
        }
        
        const health = await checkSymlinkHealth(cachedPath);
        if (health.healthy) {
          return {
            hit: true,
            type: '本地',
            path: cachedPath,
            filename: path.basename(cachedPath),
            isSymlink: health.isSymlink
          };
        } else {
          this.cacheIndex.delete(cacheKey);
        }
      } else {
        this.cacheIndex.delete(cacheKey);
      }
    }

    // 遍历分类目录查找（这部分保持不变）
    const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const category = DB_CACHE_MAP[dbName] || 'telegram';
    
    // 构建包含文件类型子目录的搜索路径
    let searchDir = path.join(CACHE_DIR, category);
    if (fileType) {
      const typeSubDir = getFileTypeSubDir(fileType);
      if (typeSubDir) {
        searchDir = path.join(searchDir, typeSubDir);
      }
    }

    if (!fs.existsSync(searchDir)) {
      return { hit: false };
    }

    const files = await fs.promises.readdir(searchDir);
    const match = files.find(name => name.startsWith(safeId + '_'));
    
    if (match) {
      const result = path.join(searchDir, match);
      
      const cacheKey = this.getCacheKey(fileId, dbName, fileType);
      if (this.creatingSymlinks.has(cacheKey)) {
        this.addToCacheIndex(fileId, result, dbName, fileType); // 🔄 修改11：使用addToCacheIndex
        return {
          hit: true,
          type: '本地',
          path: result,
          filename: path.basename(result),
          isSymlink: true
        };
      }
      
      const health = await checkSymlinkHealth(result);
      if (health.healthy) {
        this.addToCacheIndex(fileId, result, dbName, fileType); // 🔄 修改12：使用addToCacheIndex
        return {
          hit: true,
          type: '本地',
          path: result,
          filename: path.basename(result),
          isSymlink: health.isSymlink
        };
      } else {
        // 删除不健康的缓存文件
        try {
          await fs.promises.unlink(result);
        } catch (error) {
          logger.error(`删除不健康缓存文件失败: ${error.message}`);
        }
      }
    }

    return { hit: false };
  }

  /*------------------ 缓存键生成 --------------------*/
  getCacheKey(fileId, dbName, fileType = '') {
    return fileType ? `${fileId}_${dbName}_${fileType}` : `${fileId}_${dbName}`;
  }

  /*------------------ 添加到缓存索引（增强版） --------------------*/
  addToCacheIndex(fileId, filePath, dbName = 'telegramDB', fileType = '') {
    const cacheKey = this.getCacheKey(fileId, dbName, fileType);
    const now = Date.now();
    
    if (this.cacheIndex.has(cacheKey)) {
      // 更新现有条目
      const existing = this.cacheIndex.get(cacheKey);
      existing.lastAccess = now;
      existing.accessCount++;
      existing.path = filePath; // 更新路径（可能被修复）
    } else {
      // 创建新条目
      this.cacheIndex.set(cacheKey, {
        path: filePath,
        lastAccess: now,
        accessCount: 1,
        createdTime: now,
        fileId,
        dbName,
        fileType
      });
    }
  }

  /*------------------ 获取缓存路径并更新索引 --------------------*/
  getCachePath(fileId, uniqueId, ext = '', dbName = 'telegramDB', fileType = '') {
    const cachePath = getCacheFileName(fileId, uniqueId, ext, dbName, fileType);
    this.addToCacheIndex(fileId, cachePath, dbName, fileType);
    return cachePath;
  }

  /*------------------ 为已存在的TDLight文件创建软链接 --------------------*/
  async createSymlinkForExistingTDLightFile(tdlightFilePath, fileId, uniqueId, dbName = 'telegramDB', fileType = '') {
    const cacheKey = this.getCacheKey(fileId, dbName, fileType);
    
    try {
      this.creatingSymlinks.add(cacheKey);
      
      const businessPath = await createSymlinkToBusiness(
        tdlightFilePath,
        fileId,
        uniqueId,
        dbName,
        fileType
      );
     
      this.addToCacheIndex(fileId, businessPath, dbName, fileType);
      
      return {
        success: true,
        businessPath: businessPath,
        realPath: tdlightFilePath
      };
    } catch (error) {
      logger.error(`❌ 创建TDLight软链接失败: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // 确保锁被释放
      this.creatingSymlinks.delete(cacheKey);
    }
  }

  /*------------------ 批量检查缓存健康状态 --------------------*/
  async batchCheckCacheHealth() {
    const results = {
      total: this.cacheIndex.size,
      healthy: 0,
      unhealthy: 0,
      details: []
    };

    for (const [cacheKey, entry] of this.cacheIndex.entries()) { // 🔄 修改13：遍历entry
      const cachePath = entry.path; // 🔄 修改14：使用entry.path
      
      // 跳过正在创建的软链接
      if (this.creatingSymlinks.has(cacheKey)) {
        results.details.push({
          cacheKey,
          cachePath,
          healthy: true,
          reason: '创建中，跳过检查'
        });
        results.healthy++;
        continue;
      }

      const health = await checkSymlinkHealth(cachePath);
      
      const healthInfo = {
        cacheKey,
        cachePath,
        ...health
      };
      
      results.details.push(healthInfo);
      
      if (health.healthy) {
        results.healthy++;
      } else {
        results.unhealthy++;
        this.cacheIndex.delete(cacheKey);
      }
    }

    return results;
  }

  /*------------------ 并发锁控制 --------------------*/
  acquireLock(uniqueId) {
    if (this.cachingSet.has(uniqueId)) return false;
    this.cachingSet.add(uniqueId);
    return true;
  }

  releaseLock(uniqueId) {
    this.cachingSet.delete(uniqueId);
  }

  isLocked(uniqueId) {
    return this.cachingSet.has(uniqueId);
  }
}

module.exports = CacheManager;