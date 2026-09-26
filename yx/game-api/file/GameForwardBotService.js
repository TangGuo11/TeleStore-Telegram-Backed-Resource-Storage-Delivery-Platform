// game-api/file/GameForwardBotService.js - 转发机器人服务
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const GameLogger = require('./GameLogger');
const GameConfig = require('./gameConfig');

class GameForwardBotService {
  constructor(forwardService) {
    this.forwardService = forwardService;
    this.config = GameConfig;
    
    // 🎯 游戏商店专用配置
    this.botToken = process.env.BOT_TOKEN;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.tdlightUrl = process.env.TDLIGHT_URL;
    
    // 🎯 目标群组（固定）
    this.targetChatId = process.env.GAME_FORWARD_CHAT_ID || '';
    
    // 🎯 转发频率控制
    this.forwardTimestamps = new Map();  // key: fileUniqueId, value: timestamp
    this.FORWARD_INTERVAL = 2 * 60 * 1000; // 2分钟
    
    // 🎯 游戏商店数据库模型
    this.GameMessage = null;
    this.loadGameModels();
    
    GameLogger.tdlight('🎮 游戏商店转发服务初始化完成', {
      targetChat: this.targetChatId,
      gameStorageDir: this.config.GAME_STORAGE_DIR,
      tdlightBaseDir: this.config.TDLIGHT_BASE_DIR
    });
  }
  
  /*------------------ 加载游戏商店数据库模型 --------------------*/
  loadGameModels() {
    try {
      this.GameMessage = require('../models/GameMessage.api');
      GameLogger.tdlight('✅ 游戏商店数据库模型加载成功');
    } catch (error) {
      GameLogger.error('❌ 加载游戏商店数据库模型失败', error);
      this.GameMessage = null;
    }
  }
  
  /*------------------ 主方法：转发文件到游戏商店群 --------------------*/
  async forwardFileToGameChat(fileUniqueId) {
    const startTime = Date.now();
    
    try {
      GameLogger.tdlight(`🤖 开始转发文件到游戏群: ${fileUniqueId}`);
      
      // 🎯 1. 频率限制检查
      const frequencyCheck = this.checkForwardFrequency(fileUniqueId);
      if (!frequencyCheck.allowed) {
        return {
          success: false,
          message: '转发频率限制',
          retryAfter: frequencyCheck.retryAfter
        };
      }
      
      // 🎯 2. 查询文件信息
      const fileInfo = await this.findFileByUniqueId(fileUniqueId);
      if (!fileInfo) {
        return {
          success: false,
          message: '文件未找到'
        };
      }
      
      const { messageId, sourceChatId, gameId } = fileInfo;
      
      GameLogger.tdlight(`📄 找到文件`, {
        fileUniqueId,
        sourceChatId,
        messageId,
        gameId
      });
      
      // 🎯 3. 执行转发到目标群（增加超时时间）
      const forwardResult = await this.executeForward(
        sourceChatId,
        messageId,
        this.targetChatId
      );
      
      if (!forwardResult.success) {
        return forwardResult;
      }
      
      // 🎯 4. 更新转发时间戳
      this.forwardTimestamps.set(fileUniqueId, Date.now());
      
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        message: '转发成功',
        forwardedMessage: forwardResult.forwardedMessage,
        fileUniqueId,
        duration: `${duration}ms`,
        targetChatId: this.targetChatId
      };
      
    } catch (error) {
      GameLogger.error(`❌ 转发失败: ${fileUniqueId}`, error);
      
      return {
        success: false,
        message: error.message
      };
    }
  }
  
  /*------------------ 查询文件信息（简化版） --------------------*/
  async findFileByUniqueId(fileUniqueId) {
    try {
      if (!this.GameMessage) {
        throw new Error('数据库模型未加载');
      }
      
      // 在游戏商店数据库中查找
      const gameDoc = await this.GameMessage.findOne({
        'medias.file_unique_id': fileUniqueId
      }).lean();
      
      if (!gameDoc) {
        GameLogger.tdlight(`❌ 未找到文件: ${fileUniqueId}`);
        return null;
      }
      
      // 查找对应的媒体文件
      let targetMedia = null;
      for (const media of gameDoc.medias) {
        if (media.file_unique_id === fileUniqueId) {
          targetMedia = media;
          break;
        }
      }
      
      if (!targetMedia) {
        return null;
      }
      
      return {
        gameDoc,
        media: targetMedia,
        gameId: gameDoc.gameId,
        messageId: gameDoc.messageId,
        sourceChatId: gameDoc.chatId // 原始群组
      };
      
    } catch (error) {
      GameLogger.error(`❌ 查询文件失败: ${fileUniqueId}`, error);
      return null;
    }
  }
  
  /*------------------ 检查转发频率 --------------------*/
  checkForwardFrequency(fileUniqueId) {
    const lastTime = this.forwardTimestamps.get(fileUniqueId) || 0;
    const now = Date.now();
    const timeSinceLast = now - lastTime;
    
    if (timeSinceLast < this.FORWARD_INTERVAL) {
      const retryAfter = this.FORWARD_INTERVAL - timeSinceLast;
      
      GameLogger.tdlight(`⏳ 转发频率限制`, {
        fileUniqueId,
        lastTime: new Date(lastTime).toISOString(),
        retryAfter: `${Math.ceil(retryAfter / 1000)}秒`
      });
      
      return {
        allowed: false,
        retryAfter
      };
    }
    
    return { allowed: true };
  }
  
  /*------------------ 从消息中提取文件信息 --------------------*/
  extractFileInfoFromMessage(msg) {
    if (!msg) return null;

    if (msg.document) {
      return {
        tdlightFileId: msg.document.file_id,
        filePath: msg.document.file_path,
        fileSize: msg.document.file_size,
        fileUniqueId: msg.document.file_unique_id,
        source: 'document'
      };
    }

    if (msg.video) {
      return {
        tdlightFileId: msg.video.file_id,
        filePath: msg.video.file_path,
        fileSize: msg.video.file_size,
        fileUniqueId: msg.video.file_unique_id,
        source: 'video'
      };
    }

    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      return {
        tdlightFileId: photo.file_id,
        filePath: photo.file_path,
        fileSize: photo.file_size,
        fileUniqueId: photo.file_unique_id,
        source: 'photo'
      };
    }

    return null;
  }

  /*------------------ 获取当前 TDLight update offset --------------------*/
  async getLatestUpdateOffset() {
    try {
      const response = await axios.get(
        `${this.tdlightUrl}/getUpdates`,
        {
          params: { limit: 1, offset: -1, timeout: 0 },
          timeout: 10000
        }
      );

      const updates = response.data?.result || [];
      if (updates.length > 0) {
        return updates[updates.length - 1].update_id + 1;
      }
    } catch (error) {
      GameLogger.tdlight(`⚠️ 获取update offset失败: ${error.message}`);
    }

    return 0;
  }

  /*------------------ 🔥 执行转发（通过 TDLight，确保 update 可被 TDLight 接收） --------------------*/
  async executeForward(fromChatId, messageId, toChatId) {
    try {
      GameLogger.tdlight(`📤 转发消息`, {
        fromChatId,
        toChatId,
        messageId
      });
      
      // 增加超时时间到60秒
      const response = await axios.post(
        `${this.tdlightUrl}/forwardMessage`,
        {
          chat_id: toChatId,
          from_chat_id: fromChatId,
          message_id: messageId
        },
        {
          timeout: 60000, // 增加到60秒
          headers: { 'Content-Type': 'application/json' }
        }
      );
      
      if (response.data.ok) {
        const result = response.data.result;
        
        GameLogger.tdlight(`✅ 转发成功`, {
          toChatId,
          forwardedMessageId: result.message_id
        });
        
        return {
          success: true,
          targetChatId: toChatId,
          forwardedMessage: result
        };
      } else {
        GameLogger.error(`❌ Telegram API返回错误`, response.data);
        return {
          success: false,
          message: response.data.description || '转发失败'
        };
      }
      
    } catch (error) {
      GameLogger.error(`❌ 转发请求失败`, error);
      
      // 如果是超时错误，给出更友好的提示
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return {
          success: false,
          message: '转发超时，请稍后重试',
          code: 'TIMEOUT'
        };
      }
      
      return {
        success: false,
        message: error.message,
        code: error.code
      };
    }
  }
  
  /*------------------ 🔥 从TDLight的getUpdates获取TDLight file_id --------------------*/
  async getTdlightFileIdFromUpdates(fileUniqueId, options = {}) {
    const {
      maxAttempts = 60,
      startOffset = 0,
      targetChatId = null,
      forwardedMessageId = null
    } = options;

    try {
      GameLogger.tdlight(`🔍 从TDLight getUpdates查找file_id: ${fileUniqueId}`, {
        startOffset,
        targetChatId,
        forwardedMessageId
      });

      let offset = startOffset;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await axios.get(
            `${this.tdlightUrl}/getUpdates`,
            {
              params: {
                offset,
                limit: 100,
                timeout: 10
              },
              timeout: 30000
            }
          );

          if (!response.data?.ok || !response.data.result) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }

          for (const update of response.data.result) {
            offset = update.update_id + 1;

            const msg = update.message || update.channel_post;
            if (!msg) continue;

            const fileInfo = this.extractFileInfoFromMessage(msg);
            if (!fileInfo) continue;

            const chatMatch = !targetChatId || String(msg.chat?.id) === String(targetChatId);
            const messageMatch = !forwardedMessageId || msg.message_id === forwardedMessageId;
            const uniqueIdMatch = fileInfo.fileUniqueId === fileUniqueId;

            if ((chatMatch && messageMatch) || uniqueIdMatch) {
              GameLogger.tdlight(`✅ 从getUpdates找到TDLight file_id`, {
                attempt: attempt + 1,
                fileUniqueId,
                tdlightFileId: fileInfo.tdlightFileId,
                filePath: fileInfo.filePath,
                matchedBy: chatMatch && messageMatch ? 'message_id' : 'file_unique_id'
              });

              return {
                success: true,
                tdlightFileId: fileInfo.tdlightFileId,
                filePath: fileInfo.filePath,
                fileSize: fileInfo.fileSize,
                source: `getUpdates_${fileInfo.source}`
              };
            }
          }

          if (attempt % 10 === 0) {
            GameLogger.tdlight(`🔄 等待TDLight getUpdates返回数据... ${attempt + 1}/${maxAttempts}`);
          }

          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (pollError) {
          if (attempt % 10 === 0) {
            GameLogger.tdlight(`⚠️ getUpdates请求失败: ${pollError.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      throw new Error(`无法从getUpdates获取TDLight file_id: ${fileUniqueId}`);

    } catch (error) {
      GameLogger.error(`❌ 获取TDLight file_id失败: ${fileUniqueId}`, error);
      throw error;
    }
  }
  
  /*------------------ 🔥 使用TDLight file_id缓存文件 --------------------*/
  async cacheFileWithTdlightFileId(tdlightFileId, fileUniqueId, maxAttempts = 30) {
    try {
      GameLogger.tdlight(`⏳ 使用TDLight file_id缓存文件: ${tdlightFileId}`);
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          // 增加超时时间
          const response = await axios.get(
            `${this.tdlightUrl}/getFile`,
            {
              params: { file_id: tdlightFileId },
              timeout: 30000 // 30秒超时
            }
          );
          
          if (response.data?.ok && response.data.result) {
            const result = response.data.result;
            const filePath = result.file_path;
            
            // 检查是否为真实文件路径（不是占位符）
            if (filePath && !this.isPlaceholderPath(filePath)) {
              const size = result.file_size || 0;
              
              GameLogger.tdlight(`✅ TDLight文件缓存成功`, {
                attempt: attempt + 1,
                tdlightFileId,
                filePath,
                size: `${(size / 1024 / 1024).toFixed(2)} MB`
              });
              
              return {
                success: true,
                tdlightFileId,
                filePath,
                size
              };
            } else if (filePath && this.isPlaceholderPath(filePath)) {
              if (attempt % 5 === 0) {
                GameLogger.tdlight(`🔄 文件还在处理中... ${attempt + 1}/${maxAttempts}`);
              }
            }
          }
        } catch (error) {
          if (attempt % 10 === 0) {
            GameLogger.tdlight(`⚠️ getFile请求失败: ${error.message}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      throw new Error(`TDLight文件缓存超时: ${tdlightFileId}`);
      
    } catch (error) {
      GameLogger.error(`❌ 缓存文件失败: ${fileUniqueId}`, error);
      throw error;
    }
  }
  
  /*------------------ 检查是否为占位符路径 --------------------*/
  isPlaceholderPath(filePath) {
    const placeholderPaths = [
      'videos/file_0',
      'documents/file_0',
      'photos/file_0',
      'videos/file_0.MP4',
      'documents/file_0.apk',
      'documents/file_0.7z',
      'documents/file_0.zip',
      'documents/file_0.rar'
    ];
    
    // 检查是否包含 file_0 模式
    if (filePath.includes('file_0')) {
      return true;
    }
    
    return placeholderPaths.some(p => filePath.includes(p));
  }
  
  /*------------------ 验证TDLight文件存在 --------------------*/
  async verifyTDLightFile(filePath) {
    try {
      const fullPath = path.join(this.config.TDLIGHT_BASE_DIR, filePath);
      
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        GameLogger.tdlight(`✅ TDLight文件存在`, {
          path: fullPath,
          size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`
        });
        return {
          exists: true,
          path: fullPath,
          size: stats.size
        };
      }
      
      GameLogger.warn(`❌ TDLight文件不存在: ${fullPath}`);
      return {
        exists: false,
        path: fullPath
      };
      
    } catch (error) {
      GameLogger.error(`❌ 验证文件失败`, error);
      return {
        exists: false,
        error: error.message
      };
    }
  }
  
  /*------------------ 更新数据库file_id和file_path字段 --------------------*/
  async updateFileInfoInDatabase(fileUniqueId, tdlightFileId, filePath, fileSize = 0) {
    try {
      if (!this.GameMessage) {
        throw new Error('数据库模型未加载');
      }
      
      const updateData = {
        'medias.$.file_path': filePath,
        'medias.$.file_id': tdlightFileId, // 🔥 更新为TDLight file_id
        'medias.$.tdlight_file_id': tdlightFileId
      };
      
      if (fileSize > 0) {
        updateData['medias.$.file_size'] = fileSize;
      }
      
      const result = await this.GameMessage.updateOne(
        { 'medias.file_unique_id': fileUniqueId },
        { $set: updateData }
      );
      
      if (result.modifiedCount > 0) {
        GameLogger.tdlight(`✅ 数据库更新成功`, {
          fileUniqueId,
          tdlightFileId,
          filePath,
          modifiedCount: result.modifiedCount
        });
        return {
          success: true,
          modifiedCount: result.modifiedCount
        };
      } else {
        GameLogger.tdlight(`ℹ️ 数据库无需更新`, {
          fileUniqueId
        });
        return {
          success: false,
          message: '未找到匹配记录或无需更新'
        };
      }
      
    } catch (error) {
      GameLogger.error(`❌ 更新数据库失败`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /*------------------ 根据文件大小计算缓存轮询次数 --------------------*/
  getCacheMaxAttempts(fileSize = 0) {
    if (fileSize > 200 * 1024 * 1024) return 150;
    if (fileSize > 100 * 1024 * 1024) return 90;
    if (fileSize > 20 * 1024 * 1024) return 60;
    return 30;
  }

  /*------------------ 尝试用已有 tdlight_file_id 恢复缓存 --------------------*/
  async tryRecoverExistingCache(fileUniqueId, tdlightFileId, fileSize = 0) {
    if (!tdlightFileId) return null;

    try {
      GameLogger.tdlight(`🔄 尝试用已有 tdlight_file_id 恢复缓存: ${tdlightFileId}`);

      const cacheResult = await this.cacheFileWithTdlightFileId(
        tdlightFileId,
        fileUniqueId,
        this.getCacheMaxAttempts(fileSize)
      );

      if (!cacheResult.success) return null;

      const verifyResult = await this.verifyTDLightFile(cacheResult.filePath);
      if (!verifyResult.exists) return null;

      await this.updateFileInfoInDatabase(
        fileUniqueId,
        tdlightFileId,
        cacheResult.filePath,
        cacheResult.size
      );

      return {
        success: true,
        tdlightFileId,
        filePath: cacheResult.filePath,
        cacheResult,
        verifyResult
      };
    } catch (error) {
      GameLogger.tdlight(`⚠️ 已有 tdlight_file_id 恢复失败: ${error.message}`);
      return null;
    }
  }

  /*------------------ 🔥 完整的转发与更新流程（使用getUpdates获取TDLight file_id） --------------------*/
  async forwardAndUpdateFile(fileUniqueId) {
    try {
      GameLogger.tdlight(`🚀 开始完整转发与更新流程: ${fileUniqueId}`);

      const fileInfo = await this.findFileByUniqueId(fileUniqueId);
      const fileSize = fileInfo?.media?.file_size || 0;
      const cacheMaxAttempts = this.getCacheMaxAttempts(fileSize);

      // 🎯 1. 记录转发前的 update offset，避免重复读取旧更新
      const startOffset = await this.getLatestUpdateOffset();

      // 🎯 2. 转发文件到游戏群（获取新的消息）
      const forwardResult = await this.forwardFileToGameChat(fileUniqueId);
      
      if (!forwardResult.success) {
        return forwardResult;
      }
      
      GameLogger.tdlight(`✅ 转发完成，等待TDLight处理...`);

      const forwardedMessage = forwardResult.forwardedMessage;
      const forwardedMessageId = forwardedMessage?.message_id;
      let tdlightIdResult = null;

      // 🎯 3. 优先使用转发响应中的 file_id（TDLight 转发时可直接获得）
      const directFileInfo = this.extractFileInfoFromMessage(forwardedMessage);
      if (directFileInfo?.tdlightFileId) {
        GameLogger.tdlight(`📎 转发响应已包含 file_id，跳过 getUpdates 轮询`, {
          tdlightFileId: directFileInfo.tdlightFileId
        });
        tdlightIdResult = {
          success: true,
          tdlightFileId: directFileInfo.tdlightFileId,
          filePath: directFileInfo.filePath,
          fileSize: directFileInfo.fileSize,
          source: 'forward_response'
        };
      }

      // 🎯 4. 回退：从 TDLight getUpdates 查找（带 offset 和消息 ID 匹配）
      if (!tdlightIdResult) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        tdlightIdResult = await this.getTdlightFileIdFromUpdates(fileUniqueId, {
          startOffset,
          targetChatId: this.targetChatId,
          forwardedMessageId
        });
      }
      
      if (!tdlightIdResult.success) {
        return {
          success: false,
          message: '无法获取TDLight file_id',
          forwardResult
        };
      }
      
      GameLogger.tdlight(`✅ 获取到TDLight file_id: ${tdlightIdResult.tdlightFileId}`);
      
      // 🎯 5. 使用TDLight file_id缓存文件
      const cacheResult = await this.cacheFileWithTdlightFileId(
        tdlightIdResult.tdlightFileId,
        fileUniqueId,
        cacheMaxAttempts
      );
      
      if (!cacheResult.success) {
        return {
          success: false,
          message: 'TDLight文件缓存失败',
          forwardResult,
          tdlightIdResult
        };
      }
      
      // 🎯 5. 验证文件存在
      const verifyResult = await this.verifyTDLightFile(cacheResult.filePath);
      
      if (!verifyResult.exists) {
        return {
          success: false,
          message: 'TDLight文件不存在',
          forwardResult,
          tdlightIdResult,
          cacheResult
        };
      }
      
      // 🎯 6. 更新数据库（使用TDLight自己的file_id）
      const updateResult = await this.updateFileInfoInDatabase(
        fileUniqueId,
        tdlightIdResult.tdlightFileId, // 🔥 TDLight自己的file_id
        cacheResult.filePath,
        cacheResult.size
      );
      
      GameLogger.tdlight(`🎉 完整流程成功`, {
        fileUniqueId,
        tdlightFileId: tdlightIdResult.tdlightFileId,
        filePath: cacheResult.filePath,
        source: tdlightIdResult.source
      });
      
      return {
        success: true,
        message: '转发与缓存完成',
        tdlightFileId: tdlightIdResult.tdlightFileId, // 🔥 返回TDLight自己的file_id
        filePath: cacheResult.filePath,
        forwardResult,
        tdlightIdResult,
        cacheResult,
        verifyResult,
        updateResult
      };
      
    } catch (error) {
      GameLogger.error(`❌ 完整流程失败: ${fileUniqueId}`, error);
      return {
        success: false,
        message: error.message
      };
    }
  }
  
  /*------------------ 清理过期时间戳 --------------------*/
  cleanupOldTimestamps() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    let cleaned = 0;
    
    for (const [fileUniqueId, timestamp] of this.forwardTimestamps.entries()) {
      if (timestamp < oneHourAgo) {
        this.forwardTimestamps.delete(fileUniqueId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      GameLogger.cleanup(`🧹 清理过期转发记录: ${cleaned} 条`);
    }
  }
  
  /*------------------ 获取服务状态 --------------------*/
  getServiceStatus() {
    return {
      initialized: !!this.GameMessage,
      targetChatId: this.targetChatId,
      forwardTimestampsSize: this.forwardTimestamps.size,
      botTokenConfigured: !!this.botToken,
      tdlightUrl: this.tdlightUrl
    };
  }
}

module.exports = GameForwardBotService;