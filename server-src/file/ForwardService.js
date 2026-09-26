// file/ForwardService.js - 大文件转发服务
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const notify = require('../../telegram-bot-src/telegram-bot');
const { logger, createSymlinkToBusiness } = require('./utils');

class ForwardService {
  constructor(cacheManager, database) {
    this.cacheManager = cacheManager;
    this.database = database;
    this.BASE_CACHE_DIR = require('./config').BASE_CACHE_DIR;
    this.TDLIGHT_BOT_DIR = require('./config').TDLIGHT_BOT_DIR;
    
    // 使用FileController的TDLight配置
    this.TDLIGHT_BOT_TOKEN = require('./config').TELEGRAM_BOT_TOKEN;
    const tdlightBase = (process.env.TDLIGHT_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
    this.TDLIGHT_URL = `${tdlightBase}/bot${this.TDLIGHT_BOT_TOKEN}`;

    // 获取超时配置
    this.timeoutConfig = require('./config').cacheConfig.timeoutConfig;
  }

  /*------------------ 基于文件大小的动态超时计算 --------------------*/
  getDynamicTimeout(fileSize) {
    if (!fileSize || fileSize <= 0) {
      return this.timeoutConfig.default;
    }
    
    const MB = 1024 * 1024;
    
    if (fileSize > 500 * MB) return this.timeoutConfig.enormousFile;  // 2分钟 - 超大文件
    if (fileSize > 200 * MB) return this.timeoutConfig.hugeFile;      // 1.5分钟 - 大文件
    if (fileSize > 100 * MB) return this.timeoutConfig.veryLargeFile; // 1分钟 - 中等文件
    if (fileSize > 50 * MB) return this.timeoutConfig.largeFile;      // 45秒 - 小文件
    if (fileSize > 20 * MB) return this.timeoutConfig.mediumFile;     // 30秒 - 较小文件
    
    return this.timeoutConfig.smallFile; // 20秒 - 小文件
  }

  /*------------------ 获取文件大小估算 --------------------*/
  getEstimatedFileSize(fileDoc) {
    if (!fileDoc) return 0;
    
    // 优先从文件记录中获取实际大小
    if (fileDoc.video?.file_size) {
      return fileDoc.video.file_size;
    }
    if (fileDoc.document?.file_size) {
      return fileDoc.document.file_size;
    }
    
    // 基于文件类型和常见大小估算
    if (fileDoc.video) {
      // 视频文件通常较大
      return 100 * 1024 * 1024; // 默认100MB
    }
    if (fileDoc.document) {
      // 文档文件大小变化较大，取中等值
      return 20 * 1024 * 1024; // 默认20MB
    }
    
    return 0; // 未知大小
  }

  /*------------------ 触发并等待缓存生成（增强版） --------------------*/
  async triggerAndWaitCache(fileUniqueId, originalFileDoc, dbName = 'telegramDB', originalFileId = '', fileType = '') {
    // 计算动态超时
    const fileSize = this.getEstimatedFileSize(originalFileDoc);
    const maxWait = this.getDynamicTimeout(fileSize);
    
    logger.tdlight(`⏰ 文件大小估算: ${(fileSize / (1024 * 1024)).toFixed(2)}MB, 设置超时: ${maxWait / 1000}秒`);

    // 检查是否已有锁
    if (this.cacheManager.isLocked(fileUniqueId)) {
      logger.tdlight(`⏳ ${fileUniqueId} 缓存已在进行中，等待中... (超时: ${maxWait / 1000}秒)`);
    } else {
      // 获取锁并触发缓存
      if (this.cacheManager.acquireLock(fileUniqueId)) {
        try {
          await Promise.resolve(notify.forwardFileMessage(fileUniqueId))
            .catch(err => {
              // 忽略 TelegramMessageDefault 错误，继续等待缓存
              if (err.message.includes('TelegramMessageDefault')) {
                logger.tdlight(`⚠️ 转发触发完成（忽略模型错误），等待缓存生成: ${fileUniqueId}`);
              } else {
                logger.error(`⚠️ 缓存触发失败: ${err.message}`);
              }
            });
        } catch (err) {
          logger.error(`⚠️ forwardFileMessage 外层异常: ${err.message}`);
          this.cacheManager.releaseLock(fileUniqueId);
          throw err;
        }
      }
    }

    // 轮询等待缓存生成（使用动态超时）
    const cacheResult = await this.waitForCacheGeneration(
      fileUniqueId, 
      dbName, 
      originalFileId || originalFileDoc?.video?.file_id || originalFileDoc?.document?.file_id,
      fileType,
      maxWait, // 传递动态计算的超时时间
      fileSize // 传递文件大小用于日志
    );
    
    this.cacheManager.releaseLock(fileUniqueId);
    return cacheResult;
  }

  /*------------------ 等待缓存生成（增强版） --------------------*/
  async waitForCacheGeneration(fileUniqueId, dbName = 'telegramDB', originalFileId = '', fileType = '', maxWait = 45000, fileSize = 0) {
    let delay = 2000;
    let waited = 0;
    const startTime = Date.now();
    
    // 进度报告间隔
    const progressInterval = 10000; // 每10秒报告一次进度
    
    logger.tdlight(`⏳ 开始等待缓存生成，最大等待: ${maxWait / 1000}秒, 文件大小: ${(fileSize / (1024 * 1024)).toFixed(2)}MB`);

    while (waited < maxWait) {
      await new Promise(res => setTimeout(res, delay));

      const freshDoc = await this.database.findFileByUniqueId(fileUniqueId);
      
      if (freshDoc) {
        const newFile = freshDoc.video || freshDoc.document;
        const actualPath = newFile?.file_path;

        if (actualPath && actualPath.trim() !== '') {
          // 检查文件机器人路径
          const fileBotPath = path.resolve(this.BASE_CACHE_DIR, this.TDLIGHT_BOT_DIR, actualPath);
          
          // 转发机器人目录名称
          const forwardBotDirName = process.env.FORWARD_BOT_DIR || process.env.BOT_TOKEN;
          const forwardBotPath = path.resolve(this.BASE_CACHE_DIR, forwardBotDirName, actualPath);

          let actualFilePath = null;
          let sourceBot = '';

          if (fs.existsSync(fileBotPath)) {
            actualFilePath = fileBotPath;
            sourceBot = '文件机器人';
          } else if (fs.existsSync(forwardBotPath)) {
            actualFilePath = forwardBotPath;
            sourceBot = '转发机器人';
          }

          if (actualFilePath) {
            const elapsed = Date.now() - startTime;
            logger.tdlight(`✅ 缓存生成成功! 耗时: ${(elapsed / 1000).toFixed(2)}秒, 来源: ${sourceBot}`);
            
            // 创建软链接到业务目录
            try {
              const inferredFileType = fileType || (freshDoc.video ? 'video' : 'document');
              const targetFileId = originalFileId || newFile.file_id;
              
              const businessPath = await createSymlinkToBusiness(
                actualFilePath,
                targetFileId,
                fileUniqueId,
                dbName,
                inferredFileType
              );
              
              // 使用业务目录的软链接路径更新索引
              this.cacheManager.addToCacheIndex(
                targetFileId, 
                businessPath, 
                dbName, 
                inferredFileType
              );
              
              logger.cache(`📝 TDLight大文件软链接已创建: ${path.basename(businessPath)} (来源: ${sourceBot})`);
              
              return {
                success: true,
                filePath: businessPath,
                isSymlink: true,
                realPath: actualFilePath,
                sourceBot: sourceBot,
                waitTime: elapsed
              };
            } catch (error) {
              logger.error(`❌ 软链接创建失败: ${error.message}`);
              return {
                success: false,
                message: '文件处理失败'
              };
            }
          }
        }
      }

      waited += delay;
      delay = Math.min(delay * 1.5, 5000);
      
      // 进度报告
      if (waited % progressInterval === 0) {
        const progress = (waited / maxWait * 100).toFixed(1);
        logger.tdlight(`⏳ 缓存等待中... ${progress}% (${waited / 1000}s/${maxWait / 1000}s)`);
      }
    }

    const totalWaitTime = Date.now() - startTime;
    logger.warn(`⚠️ 等待超时 (${totalWaitTime / 1000}秒)，未找到缓存文件: ${fileUniqueId}`);
    
    return {
      success: false,
      message: `文件缓存超时 (${totalWaitTime / 1000}秒)`,
      waitTime: totalWaitTime
    };
  }

  /*------------------ 主动查询TDLight状态 --------------------*/
  async activelyQueryTDLightStatus(fileUniqueId, fileId, context = '查询') {
    try {
      if (!fileId) {
        logger.tdlight(`ℹ️ ${context}: 无法查询TDLight状态，fileId为空`);
        return;
      }
      
      const tdRes = await axios.get(`${this.TDLIGHT_URL}/getFile`, {
        params: { file_id: fileId },
        timeout: 10000
      }).catch(err => {
        if (err.response) {
          logger.tdlight(`❌ ${context} TDLight查询失败: HTTP ${err.response.status}`);
        } else {
          logger.tdlight(`❌ ${context} TDLight查询失败: ${err.message}`);
        }
        return null;
      });
      
      if (tdRes?.data?.ok) {
        const result = tdRes.data.result;
        return result;
      } else {
        logger.tdlight(`❌ ${context} TDLight查询无结果`);
        return null;
      }
    } catch (error) {
      logger.tdlight(`❌ ${context} TDLight查询异常: ${error.message}`);
      return null;
    }
  }

/*------------------ 为已存在的TDLight文件创建软链接 --------------------*/
async createSymlinkForExistingFile(tdlightRelativePath, fileId, fileUniqueId, dbName = 'telegramDB', fileType = '') {
  const cacheManager = this.cacheManager;
  const cacheKey = cacheManager.getCacheKey(fileId, dbName, fileType);
  
  try {
    cacheManager.creatingSymlinks.add(cacheKey);
    
    // 🆕 修复：检查多个可能的目录
    const { BASE_CACHE_DIR, TDLIGHT_BOT_DIR } = require('./config');
    
    // 可能的机器人目录
    const possibleDirs = [
      TDLIGHT_BOT_DIR,
      process.env.FORWARD_BOT_DIR || process.env.BOT_TOKEN
    ].filter(Boolean);
    
    let actualFilePath = null;
    let foundDir = '';
    
    // 检查所有可能的目录
    for (const botDir of possibleDirs) {
      const testPath = path.resolve(BASE_CACHE_DIR, botDir, tdlightRelativePath);
      if (fs.existsSync(testPath)) {
        actualFilePath = testPath;
        foundDir = botDir;
        break;
      }
    }
    
    if (!actualFilePath) {
      const errorMsg = `文件不存在于任何机器人目录: ${tdlightRelativePath}`;
      logger.warn(`❌ ${errorMsg}`);
      return {
        success: false,
        message: errorMsg,
        error: errorMsg
      };
    }

    logger.tdlight(`🔍 找到文件在目录: ${foundDir} -> ${actualFilePath}`);

    // 🆕 修复：直接传递绝对路径给 createSymlinkToBusiness
    const businessPath = await createSymlinkToBusiness(
      actualFilePath,  // 传递绝对路径
      fileId,
      fileUniqueId,
      dbName,
      fileType
    );

    // 更新缓存索引
    cacheManager.addToCacheIndex(fileId, businessPath, dbName, fileType);

    logger.cache(`🔗 手动创建软链接成功: ${path.basename(businessPath)}`);

    return {
      success: true,
      businessPath: businessPath,
      realPath: actualFilePath
    };
  } catch (error) {
    logger.error(`❌ 手动创建软链接失败: ${error.message}`);
    return {
      success: false,
      error: error.message,
      message: `软链接创建失败: ${error.message}`
    };
  } finally {
    cacheManager.creatingSymlinks.delete(cacheKey);
  }
}

/*------------------ 直接检查TDLight目录并创建软链接 --------------------*/
async directSymlinkFromTDLight(fileUniqueId, fileId, dbName = 'telegramDB', fileType = '') {
  const cacheManager = this.cacheManager;
  const cacheKey = cacheManager.getCacheKey(fileId, dbName, fileType);
  
  try {
    cacheManager.creatingSymlinks.add(cacheKey);
    
    // 查询文件信息获取 file_path
    const fileDoc = await this.database.findFileByUniqueId(fileUniqueId);
    if (!fileDoc) {
      return {
        success: false,
        message: '未找到文件记录'
      };
    }

    const file = fileDoc.video || fileDoc.document;
    if (!file?.file_path) {
      return {
        success: false,
        message: '文件缺少 file_path'
      };
    }

    const absPath = path.resolve(
      this.BASE_CACHE_DIR,
      this.TDLIGHT_BOT_DIR,
      file.file_path
    );

    if (!fs.existsSync(absPath)) {
      return {
        success: false,
        message: 'TDLight文件不存在'
      };
    }

    const inferredFileType = fileType || (fileDoc.video ? 'video' : 'document');
    const businessPath = await createSymlinkToBusiness(
      absPath,
      fileId,
      fileUniqueId,
      dbName,
      inferredFileType
    );

    cacheManager.addToCacheIndex(fileId, businessPath, dbName, inferredFileType);

    logger.cache(`🔗 直接创建TDLight软链接成功: ${path.basename(businessPath)}`);

    return {
      success: true,
      businessPath: businessPath,
      realPath: absPath
    };
  } catch (error) {
    logger.error(`❌ 直接创建TDLight软链接失败: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  } finally {
    cacheManager.creatingSymlinks.delete(cacheKey);
  }
}
}

module.exports = ForwardService;