// game-api/file/GameForwardService.js - TDLight转发服务
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const GameLogger = require('./GameLogger');
const GameConfig = require('./gameConfig');
const GameForwardBotService = require('./GameForwardBotService');

class GameForwardService {
  constructor(cacheManager, database) {
    this.cacheManager = cacheManager;
    this.database = database;
    this.config = GameConfig;
    
    // 🎯 TDLight配置
    this.tdlightUrl = process.env.TDLIGHT_URL;
    if (!this.tdlightUrl) {
      throw new Error('TDLIGHT_URL is not set');
    }
    
    // 🎯 等待队列
    this.pendingRequests = new Map(); // fileId -> { promise, timestamp }
    this.processingFiles = new Set();
    
    // 🎯 初始化游戏商店转发机器人
    this.botService = new GameForwardBotService(this);
    
    GameLogger.tdlight('🎯 GameForwardService 初始化完成');
  }
  
  /*------------------ 智能TDLight缓存处理（核心方法） --------------------*/
  async triggerTDLightCache(fileInfo, fileId, classification) {
    const { baseType, file_path, file_size } = fileInfo;
    const startTime = Date.now();
    
    try {
      // 🎯 检查是否已在处理中
      if (this.pendingRequests.has(fileId)) {
        GameLogger.tdlight(`⏳ 文件已在处理队列中: ${fileId}`);
        const existing = this.pendingRequests.get(fileId);
        return await existing.promise;
      }
      
      if (this.processingFiles.has(fileId)) {
        GameLogger.tdlight(`🔄 文件正在处理中: ${fileId}`);
        return await this.waitForProcessing(fileId, startTime);
      }
      
      // 🎯 标记为处理中
      this.processingFiles.add(fileId);
      const processPromise = this.processTDLightRequest(fileInfo, fileId, classification);
      
      // 🎯 保存到等待队列
      this.pendingRequests.set(fileId, {
        promise: processPromise,
        timestamp: startTime
      });
      
      // 🎯 执行处理
      const result = await processPromise;
      const waitTime = Date.now() - startTime;
      
      result.waitTime = waitTime;
      
      GameLogger.tdlight(`✅ TDLight处理完成: ${fileId}`, {
        waitTime: `${(waitTime / 1000).toFixed(2)}s`,
        success: result.success,
        hasTdlightFileId: !!result.tdlightFileId
      });
      
      return result;
      
    } catch (error) {
      GameLogger.error(`❌ TDLight缓存失败: ${fileId}`, error);
      
      return {
        success: false,
        error: error.message,
        waitTime: Date.now() - startTime
      };
      
    } finally {
      // 🎯 清理状态
      this.pendingRequests.delete(fileId);
      this.processingFiles.delete(fileId);
    }
  }
  
  /*------------------ 处理TDLight请求 --------------------*/
  async processTDLightRequest(fileInfo, fileId, classification) {
    try {
      const { file_unique_id, file_path, file_size, baseType } = fileInfo;
      
      // 🎯 检查file_unique_id
      if (!file_unique_id) {
        throw new Error('无法使用TDLight：缺少file_unique_id');
      }
      
      GameLogger.tdlight(`🔍 开始处理TDLight请求`, {
        fileId,
        file_unique_id,
        hasFilePath: !!file_path,
        file_size,
        baseType
      });
      
      // 🎯 情况1：已有file_path但文件不存在 → 先尝试已有 tdlight_file_id，再转发
      if (file_path && this.isTDLightPath(file_path)) {
        const tdlightPath = this.config.getTDLightCachePath(file_path);
        
        if (!fs.existsSync(tdlightPath)) {
          GameLogger.tdlight(`⚠️ file_path存在但文件不存在，触发转发: ${file_unique_id}`);

          const existingTdlightId = fileInfo.tdlight_file_id;
          if (existingTdlightId) {
            const recovered = await this.botService.tryRecoverExistingCache(
              file_unique_id,
              existingTdlightId,
              file_size
            );
            if (recovered) {
              return await this.buildRecoveredCacheResult(
                file_unique_id,
                fileInfo,
                fileId,
                recovered
              );
            }
          }

          return await this.handleFileForwardAndCache(file_unique_id, fileInfo, fileId);
        }
      }
      
      // 🎯 情况2：没有file_path → 需要转发
      if (!file_path || file_path.trim() === '') {
        GameLogger.tdlight(`📝 file_path为空，触发转发: ${file_unique_id}`);
        return await this.handleFileForwardAndCache(file_unique_id, fileInfo, fileId);
      }
      
      // 🎯 情况3：有非TDLight格式的file_path → 需要转换
      if (file_path && !this.isTDLightPath(file_path)) {
        GameLogger.tdlight(`🔄 file_path不是TDLight格式，触发转发: ${file_unique_id}`);
        return await this.handleFileForwardAndCache(file_unique_id, fileInfo, fileId);
      }
      
      // 🎯 理论上不应该执行到这里
      throw new Error(`未知的文件状态: file_path=${file_path}`);
      
    } catch (error) {
      GameLogger.error(`❌ 处理TDLight请求失败: ${fileId}`, error);
      throw error;
    }
  }
  
  /*------------------ 从已有 tdlight_file_id 恢复后构建返回结果 --------------------*/
  async buildRecoveredCacheResult(fileUniqueId, fileInfo, fileId, recovered) {
    const fullPath = path.join(this.config.TDLIGHT_BASE_DIR, recovered.filePath);

    const filePathResult = await this.cacheManager.symlinkManager.smartGetFilePath(
      fileId,
      fileInfo,
      fullPath
    );

    if (!filePathResult.success) {
      throw new Error(`无法获取可用的文件路径: ${filePathResult.error || '未知错误'}`);
    }

    GameLogger.tdlight(`✅ 通过已有 tdlight_file_id 恢复缓存成功: ${fileUniqueId}`, {
      tdlightFileId: recovered.tdlightFileId,
      filePath: recovered.filePath
    });

    return {
      success: true,
      message: '已有tdlight_file_id恢复缓存完成',
      tdlightFileId: recovered.tdlightFileId,
      filePath: filePathResult.filePath,
      realPath: filePathResult.realPath,
      isSymlink: filePathResult.isSymlink,
      cacheFilePath: recovered.filePath,
      waitTime: 0,
      recovered: true,
      details: filePathResult
    };
  }

  /*------------------ 处理文件转发与缓存（修复版）- 返回TDLight file_id --------------------*/
  async handleFileForwardAndCache(fileUniqueId, fileInfo, fileId) {
    const startTime = Date.now();
    
    try {
      GameLogger.tdlight(`🤖 开始文件转发与缓存流程: ${fileUniqueId}`);
      
      // 🎯 1. 调用机器人转发服务（获取TDLight file_id）
      const forwardResult = await this.botService.forwardAndUpdateFile(fileUniqueId);
      
      if (!forwardResult.success) {
        throw new Error(`机器人转发失败: ${forwardResult.message}`);
      }
      
      // 🎯 2. 获取TDLight file_id和缓存文件路径
      const tdlightFileId = forwardResult.tdlightFileId;
      const cacheFilePath = forwardResult.cacheResult?.filePath;
      
      if (!tdlightFileId) {
        throw new Error('未获取到TDLight file_id');
      }
      
      if (!cacheFilePath) {
        throw new Error('未获取到缓存文件路径');
      }
      
      // 🎯 3. 构建完整路径
      const fullPath = path.join(this.config.TDLIGHT_BASE_DIR, cacheFilePath);
      
      // 🎯 4. 验证文件存在
      if (!fs.existsSync(fullPath)) {
        throw new Error(`缓存文件不存在: ${fullPath}`);
      }
      
      // 🔥 修复点：使用智能获取文件路径，自动降级
      const filePathResult = await this.cacheManager.symlinkManager.smartGetFilePath(
        fileId,
        fileInfo,
        fullPath
      );
      
      if (!filePathResult.success) {
        throw new Error(`无法获取可用的文件路径: ${filePathResult.error || '未知错误'}`);
      }
      
      const duration = Date.now() - startTime;
      
      GameLogger.tdlight(`✅ 文件转发与缓存成功: ${fileUniqueId}`, {
        duration: `${duration}ms`,
        tdlightFileId,
        cacheFilePath,
        fullPath,
        finalFilePath: filePathResult.filePath,
        isSymlink: filePathResult.isSymlink,
        size: fs.statSync(fullPath).size
      });
      
      return {
        success: true,
        message: '文件转发与缓存完成',
        tdlightFileId, // 🔥 返回TDLight file_id
        filePath: filePathResult.filePath,
        realPath: filePathResult.realPath,
        isSymlink: filePathResult.isSymlink,
        cacheFilePath: cacheFilePath,
        waitTime: duration,
        forwardResult,
        details: filePathResult
      };
      
    } catch (error) {
      GameLogger.error(`❌ 文件转发与缓存失败: ${fileUniqueId}`, error);
      throw error;
    }
  }
  
  /*------------------ 判断是否是TDLight路径 --------------------*/
  isTDLightPath(file_path) {
    return file_path && (
      file_path.startsWith('videos/') || 
      file_path.startsWith('documents/') || 
      file_path.startsWith('photos/')
    );
  }
  
  /*------------------ 检查是否需要转发 --------------------*/
  async checkNeedForward(fileInfo) {
    const { file_unique_id, file_path } = fileInfo;
    
    // 🎯 必须有file_unique_id
    if (!file_unique_id) {
      return {
        needForward: false,
        reason: '缺少file_unique_id',
        message: '无法转发：缺少file_unique_id'
      };
    }
    
    // 🎯 检查file_path
    if (file_path && this.isTDLightPath(file_path)) {
      const tdlightPath = this.config.getTDLightCachePath(file_path);
      
      if (fs.existsSync(tdlightPath)) {
        return {
          needForward: false,
          reason: '已有TDLight缓存文件',
          filePath: file_path,
          fullPath: tdlightPath
        };
      } else {
        return {
          needForward: true,
          reason: 'file_path存在但文件不存在',
          filePath: file_path
        };
      }
    }
    
    // 🎯 没有file_path或不是TDLight格式
    if (!file_path || file_path.trim() === '') {
      return {
        needForward: true,
        reason: 'file_path为空'
      };
    }
    
    return {
      needForward: true,
      reason: 'file_path不是TDLight格式'
    };
  }
  
  /*------------------ 快速检查TDLight缓存 --------------------*/
  async quickCheckTDLightCache(fileUniqueId, file_path) {
    try {
      if (!file_path || !this.isTDLightPath(file_path)) {
        return { exists: false, reason: '不是TDLight路径' };
      }
      
      const fullPath = this.config.getTDLightCachePath(file_path);
      
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        return {
          exists: true,
          filePath: file_path,
          fullPath,
          size: stats.size
        };
      }
      
      return { exists: false, reason: '文件不存在', fullPath };
      
    } catch (error) {
      GameLogger.error(`❌ 快速检查缓存失败: ${fileUniqueId}`, error);
      return { exists: false, reason: error.message };
    }
  }
  
  /*------------------ 简化版：直接获取可用文件路径 --------------------*/
  async getAvailableFilePath(fileId, fileInfo) {
    try {
      const { file_path } = fileInfo;
      
      // 🎯 检查数据库中的file_path
      if (file_path && this.isTDLightPath(file_path)) {
        const fullPath = this.config.getTDLightCachePath(file_path);
        
        if (fs.existsSync(fullPath)) {
          // 使用智能方法获取路径
          const result = await this.cacheManager.symlinkManager.smartGetFilePath(
            fileId,
            fileInfo,
            fullPath
          );
          
          if (result.success) {
            return {
              success: true,
              filePath: result.filePath,
              realPath: result.realPath,
              isSymlink: result.isSymlink,
              source: 'database_file_path'
            };
          }
        }
      }
      
      // 🎯 尝试直接下载（小文件）
      if (!this.needTDLightCache(fileInfo)) {
        GameLogger.tdlight(`📥 小文件，使用直接下载: ${fileId}`);
        return {
          success: false,
          needForward: false,
          reason: '小文件直接下载'
        };
      }
      
      // 🎯 需要TDLight缓存
      return {
        success: false,
        needForward: true,
        reason: '需要TDLight缓存'
      };
      
    } catch (error) {
      GameLogger.error(`❌ 获取可用文件路径失败: ${fileId}`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /*------------------ 判断是否需要TDLight缓存 --------------------*/
  needTDLightCache(fileInfo) {
    const { type, file_size } = fileInfo;
    
    // 图片永远不需要TDLight
    if (type === 'photo') return false;
    
    // 大文件需要TDLight
    if (file_size && file_size > 20 * 1024 * 1024) return true;
    
    // 文档和视频类型需要TDLight
    return type === 'document' || type === 'video';
  }
  
  /*------------------ 调用TDLight API（备选方案） --------------------*/
  async callTDLightAPI(fileUniqueId, fileInfo) {
    const { baseType, file_size } = fileInfo;
    const timeout = this.getTDLightTimeout(file_size);
    
    try {
      GameLogger.tdlight(`📡 调用TDLight API: ${fileUniqueId}`, {
        type: baseType,
        size: file_size
      });
      
      const requestData = {
        file_unique_id: fileUniqueId,
        file_size: file_size,
        file_type: baseType,
        priority: 'high'
      };
      
      const response = await axios.post(
        `${this.tdlightUrl}/forward`,
        requestData,
        {
          timeout: timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data?.success) {
        return {
          success: true,
          taskId: response.data.task_id,
          estimatedTime: response.data.estimated_time
        };
      } else {
        return {
          success: false,
          message: response.data?.message || 'TDLight响应异常'
        };
      }
      
    } catch (error) {
      GameLogger.error(`❌ TDLight API调用失败: ${fileUniqueId}`, error);
      
      return {
        success: false,
        message: error.message,
        code: error.code
      };
    }
  }
  
  /*------------------ 等待TDLight缓存（备选方案） --------------------*/
  async waitForTDLightCache(fileUniqueId, fileInfo, pollingInterval = 3000) {
    const { file_size, file_path } = fileInfo;
    const timeout = this.getTDLightTimeout(file_size);
    const startTime = Date.now();
    const endTime = startTime + timeout;
    
    GameLogger.tdlight(`⏳ 等待TDLight缓存: ${fileUniqueId}`, {
      timeout: `${timeout}ms`,
      fileSize: file_size
    });
    
    // 🎯 如果有已知的file_path，直接检查该路径
    if (file_path) {
      const expectedPath = this.config.getTDLightCachePath(file_path);
      
      while (Date.now() < endTime) {
        if (fs.existsSync(expectedPath)) {
          const stats = fs.statSync(expectedPath);
          const elapsed = Date.now() - startTime;
          
          return {
            success: true,
            filePath: file_path,
            size: stats.size,
            elapsed
          };
        }
        
        await new Promise(resolve => 
          setTimeout(resolve, Math.min(pollingInterval, endTime - Date.now()))
        );
      }
    } else {
      // 🎯 没有file_path，通过TDLight API查询状态
      while (Date.now() < endTime) {
        try {
          const status = await this.checkTDLightStatus(fileUniqueId);
          
          if (status.status === 'completed' && status.file_path) {
            const tdlightPath = this.config.getTDLightCachePath(status.file_path);
            if (fs.existsSync(tdlightPath)) {
              const stats = fs.statSync(tdlightPath);
              const elapsed = Date.now() - startTime;
              
              return {
                success: true,
                filePath: status.file_path,
                size: stats.size,
                elapsed
              };
            }
          }
          
          if (status.status === 'failed') {
            throw new Error(`TDLight缓存失败: ${status.message}`);
          }
          
        } catch (error) {
          // 忽略查询错误，继续轮询
        }
        
        await new Promise(resolve => 
          setTimeout(resolve, Math.min(pollingInterval, endTime - Date.now()))
        );
      }
    }
    
    // 🎯 超时
    throw new Error(`TDLight缓存超时: ${timeout}ms`);
  }
  
  /*------------------ 检查TDLight状态 --------------------*/
  async checkTDLightStatus(fileUniqueId) {
    try {
      const response = await axios.get(
        `${this.tdlightUrl}/status/${fileUniqueId}`,
        { timeout: 5000 }
      );
      
      return response.data || { status: 'unknown' };
      
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }
  
  /*------------------ 更新数据库file_id和file_path字段 --------------------*/
  async updateDatabaseFileInfo(fileInfo, cacheResult) {
    try {
      const { file_path, tdlightFileId } = cacheResult;
      const { file_unique_id } = fileInfo;
      
      if (!file_path || !tdlightFileId) {
        return { success: false, message: '缺少必要信息' };
      }
      
      // 更新GameMessage模型的medias数组中的对应文件
      const GameMessage = require('../models/GameMessage.api');
      
      const updateResult = await GameMessage.updateOne(
        { 'medias.file_unique_id': file_unique_id },
        { 
          $set: { 
            'medias.$.file_path': file_path,
            'medias.$.file_id': tdlightFileId, // 🔥 更新为TDLight file_id
            'medias.$.tdlight_file_id': tdlightFileId
          } 
        }
      );
      
      if (updateResult.modifiedCount > 0) {
        GameLogger.tdlight(`✅ 数据库更新成功: ${file_unique_id}`, {
          newFileId: tdlightFileId,
          newFilePath: file_path
        });
      }
      
      return {
        success: updateResult.modifiedCount > 0,
        modifiedCount: updateResult.modifiedCount
      };
      
    } catch (error) {
      GameLogger.error(`❌ 更新数据库失败`, error);
      return { success: false, error: error.message };
    }
  }
  
  /*------------------ 工具方法 --------------------*/
  async waitForProcessing(fileId, startTime) {
    const maxWait = 300000; // 5分钟
    
    while (this.processingFiles.has(fileId)) {
      if (Date.now() - startTime > maxWait) {
        throw new Error(`等待处理超时: ${fileId}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return this.pendingRequests.get(fileId)?.promise || 
      { success: false, message: '处理已完成' };
  }
  
  getTDLightTimeout(fileSize) {
    if (!fileSize || fileSize < 100 * 1024 * 1024) return 180000; // 3分钟
    if (fileSize < 500 * 1024 * 1024) return 300000; // 5分钟
    if (fileSize < 1024 * 1024 * 1024) return 600000; // 10分钟
    return 900000; // 15分钟（超大文件）
  }
  
  /*------------------ 服务状态 --------------------*/
  getServiceStatus() {
    return {
      pendingRequests: this.pendingRequests.size,
      processingFiles: this.processingFiles.size,
      tdlightUrl: this.tdlightUrl,
      botService: this.botService ? this.botService.getServiceStatus() : '未初始化',
      uptime: process.uptime()
    };
  }
}

module.exports = GameForwardService;