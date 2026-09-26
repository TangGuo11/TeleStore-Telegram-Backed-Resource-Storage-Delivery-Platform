// file/FileController.js - 主控制器
const FileType = require('./FileType');
const CacheManager = require('./CacheManager');
const DownloadHandler = require('./DownloadHandler');
const ForwardService = require('./ForwardService');
const { respondError, safeSendFile, logger, checkSymlinkHealth, createSymlinkToBusiness } = require('./utils');
const path = require('path');
const fs = require('fs');

class FileController {
  constructor(dbManager) {
    const Database = require('./Database');
    this.db = new Database(dbManager);
    this.fileType = new FileType();
    this.cacheManager = new CacheManager();
    // 传递共享实例
    this.downloadHandler = new DownloadHandler(this.cacheManager, this.db);
    this.forwardService = new ForwardService(this.cacheManager, this.db);
  }

  /*------------------ 处理文件请求主入口 --------------------*/
  async handleFileRequest(req, res) {
    const fileId = req.params.fileId;
    const userAgent = req.headers['user-agent'] || '未知';
    const rangeHeader = req.headers.range || '无';
    
    logger.file(`📥 请求开始 fileId: ${fileId}`);

    // 添加响应完成监听
    res.on('finish', () => {
      const contentLength = res.getHeader('content-length') || '未知';
      const statusCode = res.statusCode;
      logger.file(`✅ 响应完成: 状态码=${statusCode}, 内容长度=${contentLength}`);
    });

    try {
      // 第一步：查询数据库
      const fileResult = await this.db.findFileById(fileId);
      if (!fileResult) {
        logger.file(`❌ 数据库查询: 未找到文件记录`);
        return respondError(res, '未找到该文件记录', 404);
      }

      const { doc: fileDoc, dbName } = fileResult;

      // 第二步：智能文件类型分析
      const fileAnalysis = this.fileType.analyzeFile(fileDoc, fileId);
      if (!fileAnalysis.file) {
        logger.file(`❌ 文件类型分析: 文件信息缺失`);
        return respondError(res, '文件信息缺失', 400);
      }

      const { file, fileType, uniqueId, isVideo, isDocument } = fileAnalysis;

      // 第三步：检查缓存（传递文件类型）
      const cachedResult = await this.cacheManager.checkCache(fileId, file, dbName, fileType);
      
      if (cachedResult.hit) {
        logger.cache(`💾 ${cachedResult.type}缓存命中: ${cachedResult.filename}`);
        
        // 如果是软链接，检查健康状况
        if (cachedResult.isSymlink) {
          const health = await checkSymlinkHealth(cachedResult.path);
          if (!health.healthy) {
            logger.file(`🔄 软链接不健康，强制重新下载`);
            await this.handleDownload(req, res, fileId, file, fileType, uniqueId, fileDoc, dbName, fileType);
            return;
          }
        }
        
        // 发送缓存文件
        await safeSendFile(req, res, cachedResult.path);
        return;
      }

      // 第四步：根据文件类型处理下载
      await this.handleDownload(req, res, fileId, file, fileType, uniqueId, fileDoc, dbName, fileType);

    } catch (err) {
      logger.error(`❌ 文件下载流程出错: ${err.message}`);
      return respondError(res, '文件下载失败', 500);
    }
  }

  /*------------------ 下载处理分发 --------------------*/
  async handleDownload(req, res, fileId, file, fileType, uniqueId, fileDoc, dbName, analyzedFileType) {
    const { isPhoto, isThumbnail, isSmallFile } = this.fileType.classifyFile(file, fileType);

    // 图片或缩略图
    if (isPhoto || isThumbnail) {
      await this.downloadHandler.downloadImage(res, fileId, file, uniqueId, fileDoc, dbName, fileType);
      return;
    }

    // 小文件
    if (isSmallFile) {
      await this.downloadHandler.downloadSmallFile(res, fileId, file, uniqueId, fileDoc, dbName, fileType);
      return;
    }

    // 大文件 - 使用 TDLight 缓存
    await this.handleLargeFile(req, res, fileId, file, fileDoc, dbName, fileType);
  }

/*------------------ 大文件缓存处理 --------------------*/
async handleLargeFile(req, res, fileId, file, fileDoc, dbName, fileType = '') {
  if (!file.file_unique_id) {
    logger.warn(`⚠️ 文件 ${fileId} 缺少 file_unique_id，无法触发缓存`);
    return respondError(res, '文件元数据缺失，无法下载', 404);
  }

  // ✅ 从数据库文档中获取TDLight file_id
  const tdlightFileId = file.file_id;  // 这已经是数据库中的TDLight file_id
  logger.tdlight(`🔍 使用数据库TDLight file_id: ${tdlightFileId} (原始请求: ${fileId})`);

  // 🆕 第一步：先检查TDLight是否有现成的缓存 - 使用TDLight file_id
  const existingTDLightCache = await this.checkExistingTDLightCache(
    file.file_unique_id, 
    tdlightFileId,  // ✅ 修改这里：使用TDLight file_id
    dbName, 
    fileType
  );
  
  if (existingTDLightCache.success) {
    logger.file(`✅ TDLight已有缓存，直接使用: ${existingTDLightCache.businessPath}`);
    return await safeSendFile(req, res, existingTDLightCache.businessPath);
  }

  // 🆕 第二步：如果没有现成缓存，再触发转发 - 使用TDLight file_id
  logger.tdlight(`🔄 TDLight无现成缓存，触发转发流程...`);
  const cacheResult = await this.forwardService.triggerAndWaitCache(
    file.file_unique_id,
    fileDoc,
    dbName,
    tdlightFileId,  // ✅ 修改这里：使用TDLight file_id
    fileType
  );

  if (cacheResult.success) {
    const waitTime = cacheResult.waitTime ? ` (等待: ${(cacheResult.waitTime / 1000).toFixed(2)}秒)` : '';
    logger.file(`✅ 大文件缓存成功: ${cacheResult.filePath}${waitTime}`);
    return await safeSendFile(req, res, cacheResult.filePath);
  } else {
    const waitTime = cacheResult.waitTime ? ` (已等待: ${(cacheResult.waitTime / 1000).toFixed(2)}秒)` : '';
    logger.file(`❌ 大文件缓存失败: ${cacheResult.message}${waitTime}`);
    return respondError(res, cacheResult.message || '文件仍在缓存中，请稍后重试', 404);
  }
}

/*------------------ 新增：检查TDLight现成缓存 --------------------*/
async checkExistingTDLightCache(fileUniqueId, fileId, dbName, fileType) {
  try {
    // 1. 查询数据库获取文件路径
    const fileDoc = await this.db.findFileByUniqueId(fileUniqueId);
    if (!fileDoc) {
      logger.tdlight(`🔍 检查缓存: 数据库记录不存在 - ${fileUniqueId}`);
      return { success: false, reason: '数据库记录不存在' };
    }

    const file = fileDoc.video || fileDoc.document;
    if (!file?.file_path) {
      logger.tdlight(`🔍 检查缓存: 文件路径不存在 - ${fileUniqueId}`);
      return { success: false, reason: '文件路径不存在' };
    }

    // 2. 检查多个可能的TDLight目录（文件机器人和转发机器人）
    const { BASE_CACHE_DIR, TDLIGHT_BOT_DIR } = require('./config');
    
    // 文件机器人目录
    const fileBotDirName = TDLIGHT_BOT_DIR;
    const fileBotPath = path.resolve(BASE_CACHE_DIR, fileBotDirName, file.file_path);
    
    // 转发机器人目录（从ForwardService中获取）
    const forwardBotDirName = process.env.FORWARD_BOT_DIR || process.env.BOT_TOKEN;
    const forwardBotPath = path.resolve(BASE_CACHE_DIR, forwardBotDirName, file.file_path);

    let actualFilePath = null;
    let sourceBot = '';

    // 检查文件机器人目录
    if (fs.existsSync(fileBotPath)) {
      actualFilePath = fileBotPath;
      sourceBot = '文件机器人';
      logger.tdlight(`🔍 检查缓存: 文件机器人目录存在 - ${fileBotPath}`);
    } 
    // 检查转发机器人目录
    else if (fs.existsSync(forwardBotPath)) {
      actualFilePath = forwardBotPath;
      sourceBot = '转发机器人';
      logger.tdlight(`🔍 检查缓存: 转发机器人目录存在 - ${forwardBotPath}`);
    }
    else {
      logger.tdlight(`🔍 检查缓存: 两个目录都不存在 - ${fileBotPath}, ${forwardBotPath}`);
      return { success: false, reason: 'TDLight文件不存在' };
    }

    // 3. 使用修复后的 ForwardService 方法创建软链接
    const inferredFileType = fileType || (fileDoc.video ? 'video' : 'document');
    
    logger.tdlight(`🔗 创建软链接: ${actualFilePath} -> ${fileId}`);
    
    // 🆕 修复：传递正确的相对路径
    const businessPath = await this.forwardService.createSymlinkForExistingFile(
      file.file_path,  // 相对路径（ForwardService 内部会处理为绝对路径）
      fileId,
      fileUniqueId,
      dbName,
      inferredFileType
    );

    if (businessPath.success) {
      // 4. 更新缓存索引
      this.cacheManager.addToCacheIndex(fileId, businessPath.businessPath, dbName, inferredFileType);
      
      logger.tdlight(`✅ 现成缓存检查成功: ${businessPath.businessPath} (来源: ${sourceBot})`);
      
      return {
        success: true,
        businessPath: businessPath.businessPath,
        realPath: businessPath.realPath,
        source: sourceBot
      };
    } else {
      // 🆕 修复：提供详细的错误信息
      const errorMsg = businessPath.error || businessPath.message || '未知错误';
      logger.tdlight(`❌ 软链接创建失败: ${errorMsg}`);
      return { success: false, reason: '软链接创建失败: ' + errorMsg };
    }

  } catch (error) {
    logger.error(`❌ 检查TDLight现成缓存失败: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

  /*------------------ 新增：直接检查TDLight目录并创建软链接 --------------------*/
  async directSymlinkFromTDLight(fileUniqueId, fileId, dbName = 'telegramDB', fileType = '') {
    return await this.forwardService.directSymlinkFromTDLight(fileUniqueId, fileId, dbName, fileType);
  }
}

module.exports = FileController;