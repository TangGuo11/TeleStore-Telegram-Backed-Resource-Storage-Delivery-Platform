// file/DownloadHandler.js - 下载处理器
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { getCacheFileName, logger, safeSendFile } = require('./utils');
const { TELEGRAM_BOT_TOKEN, axiosConfig } = require('./config');

let axiosRetry = require('axios-retry');
if (axiosRetry.default) axiosRetry = axiosRetry.default;

const exponentialDelay = axiosRetry.exponentialDelay;
const isNetworkError = axiosRetry.isNetworkError;
const isRetryableError = axiosRetry.isRetryableError;

class DownloadHandler {
  constructor(cacheManager, database) {
    this.cacheManager = cacheManager;
    this.database = database;
    this.setupAxiosRetry();
  }

  setupAxiosRetry() {
    try {
      axiosRetry(axios, {
        retries: 2,
        retryDelay: exponentialDelay,
        retryCondition: (error) =>
          isNetworkError(error) ||
          isRetryableError(error) ||
          (error.response && error.response.status >= 500),
        onRetry: (retryCount, error, config) => {
          logger.warn(`🔁 第 ${retryCount} 次重试: ${config?.url || '未知URL'} (${error.message})`);
        },
      });
      logger.download('✅ axios-retry 初始化完成');
    } catch (err) {
      logger.error(`❌ axios-retry 初始化失败: ${err.message}`);
    }
  }

  async downloadImage(res, fileId, file, uniqueId, fileDoc, dbName = 'telegramDB', fileType = '') {
    logger.download('🖼️ 图片或缩略图文件，使用 Telegram API 下载');
    try {
      const fileInfo = await this.getFileInfo(fileId);

      // 传递文件类型给缓存路径生成
      const savePath = getCacheFileName(fileId, uniqueId, fileInfo.extension, dbName, fileType);

      await this.downloadAndSaveFile(fileInfo.url, savePath);
      logger.download(`✅ 图片保存完成: ${path.basename(savePath)}`);

      await this.updateAfterDownload(fileId, savePath, fileInfo.extension, fileDoc, dbName, fileType);
      await safeSendFile(res, savePath);
    } catch (err) {
      logger.error(`❌ 下载图片失败: ${err.message}`);
      throw err;
    }
  }

  async downloadSmallFile(res, fileId, file, uniqueId, fileDoc, dbName = 'telegramDB', fileType = '') {
    logger.download('✅ 小文件，使用 Telegram 官方直链');
    try {
      const fileInfo = await this.getFileInfo(fileId);

      // 传递文件类型给缓存路径生成
      const savePath = getCacheFileName(fileId, uniqueId, fileInfo.extension, dbName, fileType);

      logger.download(`⏬ 下载小文件: ${path.basename(fileInfo.filePath)}`);
      await this.downloadAndSaveFile(fileInfo.url, savePath);
      logger.download(`✅ 小文件保存完成: ${path.basename(savePath)}`);

      await this.updateAfterDownload(fileId, savePath, fileInfo.extension, fileDoc, dbName, fileType);
      await safeSendFile(res, savePath);
    } catch (err) {
      logger.error(`❌ 小文件下载失败: ${err.message}`);
      throw err;
    }
  }

  async getFileInfo(fileId) {
    const infoRes = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
      axiosConfig
    );

    const filePath = infoRes.data?.result?.file_path;
    if (!filePath) throw new Error('未获取到 file_path');

    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
    const extension = path.extname(filePath) || '';

    return { filePath, url, extension };
  }

  async downloadAndSaveFile(url, savePath) {
    const streamRes = await axios.get(url, {
      responseType: 'stream',
      ...axiosConfig,
    });
    await pipeline(streamRes.data, fs.createWriteStream(savePath));
  }

  async updateAfterDownload(fileId, savePath, extension, fileDoc, dbName = 'telegramDB', fileType = '') {
    // 使用共享的 cacheManager 实例
    this.cacheManager.addToCacheIndex(fileId, savePath, dbName, fileType);
    
    // 记录缓存分类信息
    const { DB_CACHE_MAP } = require('./config');
    const category = DB_CACHE_MAP[dbName] || 'telegram';
    const typeSubDir = require('./utils').getFileTypeSubDir(fileType);
    const fullCategory = typeSubDir ? `${category}/${typeSubDir}` : category;
    
    logger.cache(`📝 文件 ${fileId} 已缓存到 ${fullCategory} 分类: ${path.basename(savePath)}`);

    try {
      // 使用共享的 database 实例
      await this.database.updateCachedExtension(fileDoc, extension);
      logger.download(`📝 数据库扩展名已更新: ${extension}`);
    } catch (dbErr) {
      logger.warn(`ℹ️ 数据库扩展名更新失败: ${dbErr.message}`);
    }
  }
}

module.exports = DownloadHandler;