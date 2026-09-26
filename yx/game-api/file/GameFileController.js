// game-api/file/GameFileController.js-游戏文件主控制器
const GameLogger = require('./GameLogger');
const GameFileClassifier = require('./GameFileClassifier');
const GameCacheManager = require('./GameCacheManager');
const GameDownloadHandler = require('./GameDownloadHandler');
const GameForwardService = require('./GameForwardService');
const GameHealthMonitor = require('./GameHealthMonitor');
const GameConfig = require('./gameConfig');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const axios = require('axios'); // 🎯 新增：用于下载缩略图

// 🎯 导入数据库管理器
const { dbManager, mongoose } = require('../db/mongoose');
const jwt = require('jsonwebtoken');

// 🎯 订单模型（用于“已购买”校验）
let Order;
try {
  Order = require('../../game-shop/models/Order');
} catch (e) {
  Order = null;
  GameLogger.warn('⚠️ Order 模型加载失败，下载鉴权将不可用', { error: e.message });
}

class GameFileController {
  constructor() {
    // 🎯 初始化配置
    this.config = GameConfig;
    
    // 🎯 先初始化基本状态
    this.database = null;
    this.dbInitialized = false;
    this.initializingDb = false;
    
    // 🎯 初始化其他组件
    this.cacheManager = new GameCacheManager();
    this.downloadHandler = new GameDownloadHandler(this.cacheManager);
    this.forwardService = null;
    this.healthMonitor = null;
    
    // 🎯 请求统计（简化版）
    this.requestStats = {
      total: 0,
      success: 0,
      failed: 0,
      cacheHits: 0,
      startTime: Date.now()
    };
    
    // 🎯 异步初始化数据库
    this.initializeDatabase();
    
    GameLogger.file('🎮 GameFileController 初始化完成', {
      version: '2.0.0'
    });
  }
  
  /*------------------ 异步初始化数据库 --------------------*/
  async initializeDatabase() {
    if (this.initializingDb) {
      GameLogger.file('⏳ 数据库正在初始化中...');
      return;
    }
    
    this.initializingDb = true;
    
    try {
      GameLogger.file('🔄 开始初始化数据库连接...');
      
      // 🎯 等待数据库连接
      await dbManager.connect();
      
      // 🎯 导入模型
      let GameMessage;
      try {
        GameMessage = require('../models/GameMessage.api');
        GameLogger.file('✅ GameMessage 模型加载成功');
      } catch (modelError) {
        GameLogger.error('❌ 加载GameMessage模型失败', modelError);
        throw new Error(`无法加载数据库模型: ${modelError.message}`);
      }
      
      // 🎯 初始化数据库操作对象
      this.database = {
        findFileById: async (fileId) => {
          try {
            if (!dbManager.isConnected()) {
              GameLogger.error('❌ 数据库未连接');
              return null;
            }
            
            const gameDoc = await GameMessage.findOne({
              $or: [
                { 'medias.file_id': fileId },
                { 'medias.thumb_file_id': fileId }
              ]
            });
            
            if (!gameDoc) {
              GameLogger.file(`❌ 未找到文件记录: ${fileId}`);
              return null;
            }
            
            for (const media of gameDoc.medias) {
              if (media.file_id === fileId || media.thumb_file_id === fileId) {
                return {
                  doc: gameDoc,
                  media,
                  gameId: gameDoc.gameId
                };
              }
            }
            
            return null;
          } catch (error) {
            GameLogger.error(`❌ 数据库查询失败: ${fileId}`, error);
            return null;
          }
        },
        
        findFileByUniqueId: async (fileUniqueId) => {
          try {
            if (!dbManager.isConnected()) return null;
            
            const gameDoc = await GameMessage.findOne({
              'medias.file_unique_id': fileUniqueId
            });
            
            if (!gameDoc) return null;
            
            for (const media of gameDoc.medias) {
              if (media.file_unique_id === fileUniqueId) {
                return {
                  doc: gameDoc,
                  media
                };
              }
            }
            
            return null;
          } catch (error) {
            GameLogger.error(`❌ 按UniqueId查询失败: ${fileUniqueId}`, error);
            return null;
          }
        }
      };
      
      this.dbInitialized = true;
      
      // 🎯 初始化依赖数据库的服务
      this.forwardService = new GameForwardService(this.cacheManager, this.database);
      this.healthMonitor = new GameHealthMonitor(this.cacheManager, this.forwardService);
      
      // 🎯 启动健康监控（简化版）
      if (this.healthMonitor && this.healthMonitor.startMonitoring) {
        this.healthMonitor.startMonitoring();
      }
      
      GameLogger.file('✅ GameFileController 初始化完成', {
        database: '已连接',
        components: [
          'GameCacheManager',
          'GameFileClassifier', 
          'GameDownloadHandler',
          'GameForwardService',
          'GameHealthMonitor'
        ]
      });
      
    } catch (error) {
      GameLogger.error('❌ 数据库初始化失败', error);
      this.dbInitialized = false;
      this.database = this.createFallbackDatabase();
    } finally {
      this.initializingDb = false;
    }
  }
  
  /*------------------ 创建降级数据库 --------------------*/
  createFallbackDatabase() {
    GameLogger.warn('⚠️ 使用降级数据库（无真实连接）');
    
    return {
      findFileById: async () => {
        GameLogger.error('❌ 数据库连接失败，无法查询');
        return null;
      },
      findFileByUniqueId: async () => null
    };
  }
  
  /*------------------ 主请求处理流程 --------------------*/
  async handleGameFileRequest(req, res) {
    const startTime = Date.now();
    const fileId = req.params.fileId;
    
    try {
      // 🎯 等待数据库初始化
      await this.waitForDatabase();
      
      // 🎯 更新请求统计
      this.requestStats.total++;
      
      // 🎯 第一步：检查缓存
      const cacheResult = await this.cacheManager.checkGameCache(fileId);
      if (cacheResult.hit) {
        this.requestStats.cacheHits++;
        await this.streamGameFile(req, res, cacheResult.path);
        return;
      }
      
      // 🎯 第二步：获取文件信息
      const fileInfo = await this.getFileInfo(fileId);
      if (!fileInfo) {
        return this.respondError(res, '游戏文件未找到', 404);
      }

      // 🔐 关键：安装包/可下载文件必须做服务端“已购买”校验
      if (this.shouldRequirePurchase(fileInfo)) {
        const authResult = await this.ensurePurchased(req, fileInfo.gameId);
        if (!authResult.ok) {
          return this.respondError(res, authResult.message, authResult.status);
        }
      }
      
      // 🎯 第三步：智能文件分类
      const classification = this.config.fileClassifier.classify(fileInfo);
      
      // 🎯 第四步：根据策略处理
      const { strategy } = classification;
      
      if (strategy === 'direct') {
        // 直接下载（小文件）
        await this.handleDirectDownload(req, res, fileId, fileInfo, classification);
      } else if (strategy === 'tdlight') {
        // TDLight处理（大文件）
        await this.handleTDLightFile(req, res, fileId, fileInfo, classification);
      } else {
        // 默认直接下载
        await this.handleDirectDownload(req, res, fileId, fileInfo, classification);
      }
      
      // 🎯 记录成功
      this.requestStats.success++;
      
    } catch (error) {
      this.requestStats.failed++;
      
      GameLogger.error(`❌ 游戏文件处理失败: ${fileId}`, error);
      this.respondError(res, '文件处理失败', 500);
    }
  }

  /*------------------ 是否需要购买校验 --------------------*/
  shouldRequirePurchase(fileInfo) {
    // 预览内容（图片/视频/缩略图）允许公开访问
    if (fileInfo.isThumbnail) return false;

    // 仅限制安装包/可执行分发文件（document），避免“知道 fileId 直接下载绕过购买”
    const type = (fileInfo.type || '').toLowerCase();
    if (type !== 'document') return false;

    const name = (fileInfo.file_name || '').toLowerCase();
    const mime = (fileInfo.mime_type || '').toLowerCase();

    const installerExts = ['.apk', '.ipa', '.exe', '.dmg', '.zip', '.rar', '.7z'];
    const looksLikeInstaller =
      installerExts.some(ext => name.endsWith(ext)) ||
      mime.includes('android.package-archive') ||
      mime.includes('application/x-msdownload') ||
      mime.includes('application/zip') ||
      mime.includes('application/x-rar-compressed') ||
      mime.includes('application/x-7z-compressed');

    return looksLikeInstaller;
  }

  /*------------------ 校验当前用户是否已购买该游戏 --------------------*/
  async ensurePurchased(req, gameId) {
    try {
      if (!Order) {
        return { ok: false, status: 503, message: '订单服务未就绪，请稍后重试' };
      }

      const token = req.cookies?.token;
      if (!token) {
        return { ok: false, status: 401, message: '未登录，无法下载' };
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (e) {
        return { ok: false, status: 401, message: '登录已失效，请重新登录' };
      }

      const userId = decoded?.userId;
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return { ok: false, status: 401, message: '登录信息异常，请重新登录' };
      }

      const paid = await Order.findOne({
        userId: userId,
        gameId,
        status: 'paid'
      }).select('_id').lean();

      if (!paid) {
        return { ok: false, status: 403, message: '未购买该游戏，无法下载' };
      }

      return { ok: true };
    } catch (e) {
      GameLogger.error('❌ 下载鉴权失败', e);
      return { ok: false, status: 500, message: '下载鉴权失败' };
    }
  }
  
  /*------------------ 处理直接下载（小文件） --------------------*/
  async handleDirectDownload(req, res, fileId, fileInfo, classification) {
    try {
      const { cacheInfo, strategy } = classification;
      const { isThumbnail } = fileInfo;
      
      // 🎯 生成文件路径（如果是缩略图，使用特殊路径）
      let targetPath;
      if (isThumbnail) {
        // 缩略图路径：photo/thumb_{file_unique_id}.jpg
        targetPath = this.getThumbnailPath(fileInfo);
      } else {
        // 普通文件路径
        targetPath = this.config.getFilePath(fileId, fileInfo);
      }
      
      // 🎯 确保目录存在
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 🎯 检查文件是否已存在（防止重复下载）
      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        
        // 验证文件完整性（检查大小）
        if (fileInfo.file_size && stats.size === fileInfo.file_size) {
          GameLogger.file(`✅ 文件已存在，直接使用: ${targetPath}`);
          
          // 🎯 缓存文件（如果需要）
          if (cacheInfo.shouldCache) {
            this.cacheManager.addToGameCache(
              fileId, 
              targetPath, 
              stats.size, 
              false,
              null
            );
          }
          
          await this.streamGameFile(req, res, targetPath);
          return;
        } else {
          // 文件大小不匹配，删除重新下载
          GameLogger.warn(`⚠️ 文件大小不匹配，删除重新下载: ${targetPath}`);
          fs.unlinkSync(targetPath);
        }
      }
      
      // 🎯 带锁下载（如果是缩略图，使用特殊下载方法）
      let downloadedPath;
      if (isThumbnail) {
        downloadedPath = await this.downloadThumbnail(fileInfo, targetPath);
        
        // 🎯 下载成功后更新数据库中的thumb_path字段
        await this.updateThumbnailPathInDatabase(fileInfo, targetPath);
      } else {
        downloadedPath = await this.downloadWithLock(fileId, fileInfo, targetPath);
      }
      
      // 🎯 缓存文件
      if (cacheInfo.shouldCache) {
        const stats = fs.statSync(downloadedPath);
        this.cacheManager.addToGameCache(
          fileId, 
          downloadedPath, 
          stats.size, 
          false,
          null
        );
      }
      
      // 🎯 流式传输
      await this.streamGameFile(req, res, downloadedPath);
      
    } catch (error) {
      // 🎯 修复：不再抛出TDLIGHT_CACHE_MISSING错误，直接重新抛出原始错误
      GameLogger.error(`❌ 直接下载失败: ${fileId}`, error);
      
      // 🎯 如果是小文件下载失败，尝试备用方案
      if (error.message !== 'TDLIGHT_CACHE_MISSING') {
        throw error;
      }
      
      // 🎯 小文件不应该依赖TDLight缓存，直接重新抛出错误
      throw new Error(`文件下载失败: ${error.message}`);
    }
  }
  
  /*------------------ 获取缩略图路径 --------------------*/
  getThumbnailPath(fileInfo) {
    const { file_unique_id } = fileInfo;
    const baseDir = this.config.GAME_STORAGE_DIR;
    
    // 缩略图存储在 photo 目录下，使用 thumb_ 前缀
    const fileName = `thumb_${file_unique_id}.jpg`;
    return path.join(baseDir, 'photo', fileName);
  }
  
  /*------------------ 下载缩略图 --------------------*/
  async downloadThumbnail(fileInfo, targetPath) {
    try {
      const { file_id, isThumbnail, file_unique_id } = fileInfo;
      
      if (!isThumbnail) {
        throw new Error('不是缩略图请求');
      }
      
      GameLogger.download(`📥 开始下载缩略图: ${file_id} (${file_unique_id})`);
      
      // 通过Telegram API获取缩略图文件
      const fileUrl = await this.getThumbnailUrl(file_id);
      
      // 使用axios下载
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'stream',
        timeout: 30000 // 30秒超时
      });
      
      // 创建写入流
      const writeStream = fs.createWriteStream(targetPath);
      
      // 管道传输
      await new Promise((resolve, reject) => {
        response.data.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      
      // 验证下载
      const stats = fs.statSync(targetPath);
      if (stats.size === 0) {
        throw new Error('缩略图下载失败，文件大小为0');
      }
      
      GameLogger.download(`✅ 缩略图下载完成: ${targetPath} (${stats.size} bytes)`);
      
      return targetPath;
      
    } catch (error) {
      GameLogger.error(`❌ 缩略图下载失败: ${fileInfo.file_id}`, error);
      throw error;
    }
  }
  
  /*------------------ 获取缩略图URL --------------------*/
  async getThumbnailUrl(fileId) {
    try {
      // 先通过getFile接口获取文件路径
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile`,
        { 
          params: { file_id: fileId },
          timeout: 15000
        }
      );
      
      if (response.data.ok) {
        const filePath = response.data.result.file_path;
        return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
      }
      
      throw new Error(`Telegram API返回错误: ${response.data.description}`);
      
    } catch (error) {
      GameLogger.error(`❌ 获取缩略图URL失败: ${fileId}`, error);
      throw error;
    }
  }
  
  /*------------------ 更新数据库中的缩略图路径 --------------------*/
  async updateThumbnailPathInDatabase(fileInfo, thumbnailPath) {
    try {
      const { original_media, gameId } = fileInfo;
      
      if (!original_media || !gameId) {
        return;
      }
      
      // 获取相对路径（相对于存储根目录）
      const relativePath = path.relative(this.config.GAME_STORAGE_DIR, thumbnailPath);
      
      // 更新GameMessage模型
      const GameMessage = require('../models/GameMessage.api');
      
      const updateResult = await GameMessage.updateOne(
        { 
          gameId: gameId,
          'medias.file_unique_id': original_media.file_unique_id 
        },
        { 
          $set: { 'medias.$.thumb_path': relativePath } 
        }
      );
      
      if (updateResult.modifiedCount > 0) {
        GameLogger.file(`✅ 更新数据库thumb_path: ${relativePath}`);
      } else {
        GameLogger.warn(`⚠️ 数据库thumb_path未更新: ${original_media.file_unique_id}`);
      }
      
    } catch (error) {
      GameLogger.error(`❌ 更新缩略图路径失败`, error);
      // 不抛出错误，因为文件下载成功了
    }
  }
  
  /*------------------ 处理TDLight文件（大文件） --------------------*/
  async handleTDLightFile(req, res, fileId, fileInfo, classification) {
    try {
      // 🎯 检查是否为缩略图（缩略图不走TDLight）
      if (fileInfo.isThumbnail) {
        GameLogger.file(`ℹ️ 缩略图请求，跳过TDLight处理: ${fileId}`);
        return await this.handleDirectDownload(req, res, fileId, fileInfo, classification);
      }
      
      // 🎯 检查forwardService
      if (!this.forwardService) {
        throw new Error('TDLight转发服务未初始化');
      }
      
      // 🎯 检查file_unique_id
      if (!fileInfo.file_unique_id) {
        throw new Error('缺少文件唯一标识(file_unique_id)');
      }
      
      // 🎯 调用TDLight服务
      const tdlightResult = await this.forwardService.triggerTDLightCache(
        fileInfo,
        fileId,
        classification
      );
      
      if (!tdlightResult.success) {
        throw new Error(`TDLight服务失败: ${tdlightResult.error || tdlightResult.message}`);
      }
      
      // 🎯 获取要传输的文件路径
      let filePathToServe = tdlightResult.filePath || tdlightResult.symlink || tdlightResult.realPath;
      
      if (!filePathToServe) {
        throw new Error('TDLight未返回有效的文件路径');
      }
      
      // 🎯 验证文件存在
      if (!fs.existsSync(filePathToServe)) {
        throw new Error(`缓存文件不存在: ${filePathToServe}`);
      }
      
      // 🎯 流式传输文件
      await this.streamGameFile(req, res, filePathToServe);
      
    } catch (error) {
      GameLogger.error(`❌ TDLight文件处理失败: ${fileId}`, error);
      throw new Error(`TDLight文件处理失败: ${error.message}`);
    }
  }
  
  /*------------------ 等待数据库初始化 --------------------*/
  async waitForDatabase() {
    if (!this.dbInitialized && !this.initializingDb) {
      GameLogger.warn('🔄 数据库未初始化，尝试初始化...');
      await this.initializeDatabase();
    }
    
    if (this.initializingDb) {
      const maxWait = 5000;
      const waitStart = Date.now();
      
      while (this.initializingDb && Date.now() - waitStart < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    if (!this.dbInitialized || !this.database) {
      throw new Error('数据库未正确初始化');
    }
  }
  
  /*------------------ 带锁的下载 --------------------*/
  async downloadWithLock(fileId, fileInfo, targetPath) {
    if (!this.cacheManager.acquireDownloadLock(fileId)) {
      // 等待其他下载完成
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.cacheManager.downloadLocks.has(fileId)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
      
      const cacheResult = await this.cacheManager.checkGameCache(fileId);
      if (cacheResult.hit) {
        return cacheResult.path;
      }
      
      if (!this.cacheManager.acquireDownloadLock(fileId)) {
        throw new Error(`无法获取下载锁: ${fileId}`);
      }
    }
    
    try {
      const downloadedPath = await this.downloadHandler.downloadFile(
        fileId, 
        fileInfo, 
        targetPath
      );
      
      return downloadedPath;
      
    } finally {
      this.cacheManager.releaseDownloadLock(fileId);
    }
  }
  
  /*------------------ 流式传输游戏文件 --------------------*/
  async streamGameFile(req, res, filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    // 🎯 设置响应头
    const mimeType = this.getMimeType(filePath);
    const headers = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
      'Content-Length': fileSize
    };
    
    // 🎯 处理Range请求
    const range = req.headers.range;
    
    try {
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        
        if (start >= fileSize || end >= fileSize) {
          res.writeHead(416, {
            "Content-Range": `bytes */${fileSize}`
          });
          return res.end();
        }
        
        const chunkSize = (end - start) + 1;
        
        Object.assign(headers, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': chunkSize
        });
        
        res.writeHead(206, headers);
        
        // 🎯 使用更稳定的流式传输
        const fileStream = fs.createReadStream(filePath, { 
          start, 
          end,
          highWaterMark: 64 * 1024 // 64KB块大小
        });
        
        // 🎯 监听流错误
        fileStream.on('error', (error) => {
          GameLogger.error(`❌ 文件流错误: ${filePath}`, error);
          if (!res.headersSent) {
            res.status(500).end('Stream Error');
          }
        });
        
        // 🎯 处理客户端提前断开连接
        res.on('close', () => {
          if (!fileStream.destroyed) {
            fileStream.destroy();
          }
        });
        
        await pipeline(fileStream, res);
        
      } else {
        res.writeHead(200, headers);
        
        const fileStream = fs.createReadStream(filePath, {
          highWaterMark: 64 * 1024
        });
        
        fileStream.on('error', (error) => {
          GameLogger.error(`❌ 文件流错误: ${filePath}`, error);
          if (!res.headersSent) {
            res.status(500).end('Stream Error');
          }
        });
        
        res.on('close', () => {
          if (!fileStream.destroyed) {
            fileStream.destroy();
          }
        });
        
        await pipeline(fileStream, res);
      }
      
    } catch (error) {
      if (!res.headersSent) {
        if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          GameLogger.warn(`⚠️ 客户端提前关闭连接: ${filePath}`);
        } else {
          GameLogger.error(`❌ 流式传输失败: ${filePath}`, error);
          res.status(500).json({ 
            error: '文件传输失败', 
            message: error.message 
          });
        }
      }
    }
  }
  
  /*------------------ 获取文件信息（增强版，支持缩略图） --------------------*/
  async getFileInfo(fileId) {
    try {
      if (!this.database) {
        return null;
      }
      
      const result = await this.database.findFileById(fileId);
      
      if (!result || !result.media) {
        return null;
      }
      
      // 🎯 判断是否为缩略图请求
      const isThumbnail = result.media.thumb_file_id === fileId;
      
      return {
        file_id: isThumbnail ? result.media.thumb_file_id : result.media.file_id,
        file_unique_id: result.media.file_unique_id,
        tdlight_file_id: result.media.tdlight_file_id,
        thumb_file_id: result.media.thumb_file_id,
        file_size: result.media.file_size,
        file_path: isThumbnail ? result.media.thumb_path : result.media.file_path, // 🎯 缩略图用thumb_path
        mime_type: result.media.mime_type || (isThumbnail ? 'image/jpeg' : 'application/octet-stream'), // 🎯 缩略图默认jpeg
        file_name: result.media.file_name || (isThumbnail ? `thumb_${result.media.file_unique_id}.jpg` : ''),
        type: isThumbnail ? 'thumbnail' : result.media.type, // 🎯 标记为缩略图类型
        width: result.media.width,
        height: result.media.height,
        duration: result.media.duration,
        caption: result.media.caption,
        gameId: result.gameId,
        isThumbnail: isThumbnail, // 🎯 新增字段
        original_media: result.media // 🎯 保存原始媒体信息，用于更新thumb_path
      };
    } catch (error) {
      GameLogger.error(`❌ 获取文件信息失败: ${fileId}`, error);
      return null;
    }
  }
  
  /*------------------ 响应错误 --------------------*/
  respondError(res, message, status = 500) {
    if (!res.headersSent) {
      res.status(status).json({ 
        success: false, 
        error: message,
        system: 'game-file-service',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /*------------------ 获取MIME类型 --------------------*/
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.apk': 'application/vnd.android.package-archive',
      '.ipa': 'application/octet-stream',
      '.exe': 'application/x-msdownload',
      '.dmg': 'application/x-apple-diskimage',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed',
      '.pdf': 'application/pdf'
    };
    
    return mimeMap[ext] || 'application/octet-stream';
  }
  
  /*------------------ 获取控制器状态 --------------------*/
  getControllerStatus() {
    const cacheStats = this.cacheManager.getCacheStats();
    const forwardStatus = this.forwardService ? this.forwardService.getServiceStatus() : { status: 'not-initialized' };
    
    return {
      status: 'running',
      uptime: `${(Date.now() - this.requestStats.startTime) / 1000} 秒`,
      requestStats: this.requestStats,
      cacheStats,
      database: {
        initialized: this.dbInitialized,
        connected: dbManager.isConnected()
      },
      components: {
        cacheManager: 'running',
        fileClassifier: 'running',
        downloadHandler: 'running',
        forwardService: this.forwardService ? 'running' : 'not-initialized',
        healthMonitor: this.healthMonitor ? 'running' : 'not-initialized'
      },
      timestamp: new Date().toISOString()
    };
  }
  
  /*------------------ 健康检查端点 --------------------*/
  async handleHealthCheck(req, res) {
    try {
      const status = this.getControllerStatus();
      
      // 🎯 简单健康检查
      const healthCheck = {
        status: 'healthy',
        checks: {
          database: dbManager.isConnected(),
          cacheManager: true,
          downloadHandler: true
        },
        timestamp: new Date().toISOString()
      };
      
      res.json({
        success: true,
        status: 'healthy',
        controller: status,
        healthCheck: healthCheck,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /*------------------ 缓存清理端点 --------------------*/
  async handleCacheCleanup(req, res) {
    try {
      const statsBefore = this.cacheManager.getCacheStats();
      this.cacheManager.cleanupOldCache();
      const statsAfter = this.cacheManager.getCacheStats();
      
      res.json({
        success: true,
        message: '缓存清理完成',
        statsBefore,
        statsAfter,
        cleaned: statsBefore.totalEntries - statsAfter.totalEntries
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /*------------------ 重启服务端点 --------------------*/
  async handleRestart(req, res) {
    try {
      GameLogger.warn('🔄 手动重启文件模块...');
      await this.initializeDatabase();
      
      res.json({
        success: true,
        message: '重启命令已接收，正在重新初始化...'
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = GameFileController;