// telegram-bot.js - 主项目机器人 
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { getModelByChatId } = require('../db/TelegramDBManager');
const { MEMBER_CHAT_IDS, getCategoryByChatId, MEMBER_CATEGORIES } = require('../db/memberConfig');
const {
  YY_CHAT_ID,
  YX_CHAT_ID,
  DAILY_UPDATE_CHAT_ID,
  DAILY_GOSSIP_CHAT_ID,
  DAILY_BEST_CHAT_ID,
  TELEGRAM_FEED_CHAT_ID,
} = require('../db/chatIds');
const { logger } = require('../server-src/file/utils');

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN is not set');
const API_URL = `https://api.telegram.org/bot${token}`;
const tdlightBase = (process.env.TDLIGHT_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const TDLIGHT_URL = `${tdlightBase}/bot${token}`;

const { BASE_CACHE_DIR, TDLIGHT_BOT_DIR } = require('../server-src/file/config');
const TDLIGHT_CACHE_BASE = BASE_CACHE_DIR;
const TDLIGHT_BOT_TOKEN = process.env.FORWARD_BOT_DIR || token;
const LOCAL_CACHE_DIR = path.join(BASE_CACHE_DIR, 'local');

function getAllowedChatIds() {
  return [
    TELEGRAM_FEED_CHAT_ID,
    YY_CHAT_ID,
    YX_CHAT_ID,
    DAILY_UPDATE_CHAT_ID,
    DAILY_GOSSIP_CHAT_ID,
    DAILY_BEST_CHAT_ID,
    ...MEMBER_CHAT_IDS,
  ].filter(Boolean);
}

// === 强制使用 IPv4 的 HTTPS Agent ===
const agent = new https.Agent({ family: 4 });
let lastUpdateId = 0;

/*--------- 数据库连接 --------*/
// 1. 先定义变量
let HistoryMessage;

// 2. 懒加载函数
async function initModels() {
  if (!HistoryMessage) {
    const db = require('../db/DBManager');
    HistoryMessage = await db.getModel('Message');
  }
}

// 3. 启动函数
async function initBot() {
  await initModels();                     // 确保模型就绪
  const { initialize } = require('../db/TelegramDBManager');
  await initialize();                     // 确保 TelegramDBManager 就绪
  console.log('✅ DB ready, bot starting polling');
  startPolling();
}

//chatId → originDB 分类函数
function resolveOriginDB(chatIdStr) {
  if (chatIdStr === YY_CHAT_ID) return 'yy';
  if (chatIdStr === YX_CHAT_ID) return 'yx';

  if ([DAILY_UPDATE_CHAT_ID, DAILY_GOSSIP_CHAT_ID, DAILY_BEST_CHAT_ID].includes(chatIdStr))
    return 'daily';

  if (MEMBER_CHAT_IDS.includes(chatIdStr))
    return 'member';

  return 'telegram';
}

// 4. 仅直接运行时启动
if (require.main === module) {
  initBot().catch(err => {
    console.error('❌ Bot 启动失败:', err);
    process.exit(1);
  });
}

/*------------ 限流 + 工具函数 -------------*/
const pLimit = require('p-limit').default;
const limitGetFile = pLimit(5); // ≤ 5
const limitSendMessage = pLimit(1); // ≤ 1
const delay = ms => new Promise(r => setTimeout(r, ms));

async function safeSendMessage(chatId, text, retry = 0) {
  return limitSendMessage(async () => {
    try {
      await axios.post(`${API_URL}/sendMessage`, { chat_id: chatId, text }, { httpsAgent: agent });
      await delay(2000);
    } catch (err) {
      if (err.response?.status === 429 && retry < 3) {
        const wait = (err.response.data.parameters?.retry_after || 1) * 1000;
        console.warn(`429 -> 等 ${wait}ms 后重试`);
        await delay(wait);
        return safeSendMessage(chatId, text, retry + 1);
      }
      console.warn('⚠️ sendMessage 失败:', err.message);
    }
  });
}


/*------ TDLight file_id 缓存 -------*/
const tdlightFileIdCache = new Map();
let tdlightOffset = 0; // 防止重复扫描

/*-------------- 获取文件元信息 ---------------*/
async function getFileMeta(fileId, fileUniqueId, fileSize) {
  const MB20 = 20 * 1024 * 1024;

/*------- 小文件：走官方 API -------*/
  if ((fileSize || 0) < MB20) {
    try {
      const res = await axios.get(`${API_URL}/getFile`, {
        params: { file_id: fileId },
        httpsAgent: agent
      });

      if (res.data.ok) {
        return {
          file_id: fileId, // 小文件保存官方 file_id
          file_path: res.data.result.file_path || '',
          file_size: res.data.result.file_size || fileSize || 0
        };
      }
    } catch (err) {
      console.warn(`⚠️ 官方小文件 getFile 失败: ${fileId}`);
    }

    return {
      file_id: fileId,
      file_path: '',
      file_size: fileSize || 0
    };
  }

/*------- 大文件：走 TDLight --------*/
  // 1️⃣ 先查缓存
  if (tdlightFileIdCache.has(fileUniqueId)) {
    const tdFileId = tdlightFileIdCache.get(fileUniqueId);
    return await fetchFromTdlight(tdFileId, fileSize);
  }

  // 2️⃣ 扫描 TDLight updates
  try {
    const res = await axios.get(`${TDLIGHT_URL}/getUpdates`, {
      params: {
        offset: tdlightOffset + 1,
        timeout: 1
      }
    });

    if (res.data.ok) {
      for (const update of res.data.result) {
        tdlightOffset = update.update_id;

        const msg = update.message;
        if (!msg) continue;

        const media =
          msg.video ||
          msg.document ||
          (msg.photo?.length ? msg.photo[msg.photo.length - 1] : null);

        if (media?.file_unique_id === fileUniqueId) {
          const tdFileId = media.file_id;

          // 存入缓存
          tdlightFileIdCache.set(fileUniqueId, tdFileId);

          return await fetchFromTdlight(tdFileId, fileSize);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ TDLight getUpdates 扫描失败`);
  }

  console.warn(`❌ 未找到 TDLight file_id: ${fileUniqueId}`);

  // 找不到时兜底返回官方 file_id（避免程序崩溃）
  return {
    file_id: fileId,
    file_path: '',
    file_size: fileSize || 0
  };
}

/*----- 从TDLight 获取真实文件信息 ------*/
async function fetchFromTdlight(tdFileId, fileSize) {
  try {
    const res = await axios.get(`${TDLIGHT_URL}/getFile`, {
      params: { file_id: tdFileId }
    });

    if (res.data.ok) {
      return {
        file_id: tdFileId, // ⚠️ 这里替换为 TDLight 的 file_id
        file_path: res.data.result.file_path || '',
        file_size: res.data.result.file_size || fileSize || 0
      };
    }
  } catch (err) {
    console.warn(`⚠️ TDLight getFile 失败: ${tdFileId}`);
  }

  return {
    file_id: tdFileId,
    file_path: '',
    file_size: fileSize || 0
  };
}


/*------------ 单条 update 处理逻辑（幂等 upsert 版） ---------------*/
async function handleUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const {
    chat,
    text,
    photo,
    video,
    document,
    message_id,
    from,
    caption,
    media_group_id = null
  } = msg;

  const chatIdStr = chat.id.toString();

  // ✅ 必须显式声明（防止隐式全局变量）
  let videoInfo;
  let documentInfo;
  let photoInfo;

  // === 获取数据库模型（动态分配连接） ===
  const model = await getModelByChatId(chatIdStr);

  // === 根据频道类型输出提示（仅用于日志） ===
  let successMsg = '🤖 数据已保存';
  if (chatIdStr === YY_CHAT_ID) successMsg = 'YY data saved';
  else if (chatIdStr === YX_CHAT_ID) successMsg = 'YX data saved';
  else if ([DAILY_UPDATE_CHAT_ID, DAILY_GOSSIP_CHAT_ID, DAILY_BEST_CHAT_ID].includes(chatIdStr))
    successMsg = 'Daily database: data saved';
  else if (MEMBER_CHAT_IDS.includes(chatIdStr)) {
    const cat = getCategoryByChatId(chatIdStr);
    successMsg = `💎 会员分类${cat}：数据已保存`;
  } else {
    console.warn(`⚠️ 未知群组 chatId=${chatIdStr}，已写入默认 Telegram 库。请在 db/memberConfig.js 中配置此 ID`);
  }

  // === 视频 ===
  if (video) {
    const meta = await limitGetFile(() =>
      getFileMeta(
        video.file_id,
        video.file_unique_id,
        video.file_size || 0
      )
    );

    videoInfo = {
      file_id: meta.file_id,  // ⚠️ 使用 meta.file_id
      file_unique_id: video.file_unique_id,
      thumb_file_id: video.thumb?.file_id || '',
      duration: video.duration,
      width: video.width,
      height: video.height,
      caption: caption || '',
      file_size: meta.file_size,
      file_path: meta.file_path,
      media_group_id
    };
  }

  // === 文档 ===
  if (document) {
    const meta = await limitGetFile(() =>
      getFileMeta(
        document.file_id,
        document.file_unique_id,
        document.file_size || 0
      )
    );

    documentInfo = {
      file_id: meta.file_id, // ⚠️ 使用 meta.file_id
      file_unique_id: document.file_unique_id,
      file_name: document.file_name || '',
      mime_type: document.mime_type || '',
      caption: caption || '',
      thumb_file_id: document.thumb?.file_id || '',
      file_size: meta.file_size,
      file_path: meta.file_path,
      media_group_id
    };
  }

  // === 照片 ===
  if (photo?.length) {
    const largest = photo[photo.length - 1];
    photoInfo = {
      file_id: largest.file_id,
      file_unique_id: largest.file_unique_id,
      width: largest.width,
      height: largest.height,
      caption: caption || '',
      media_group_id
    };
  }

  // === 不可变字段 ===
  const immutablePart = {
    updateId: update.update_id,
    messageId: message_id,
    chatId: Number(chat.id),
    from: {
      id: Number(from.id),
      username: from.username || '',
      first_name: from.first_name || '',
      last_name: from.last_name || ''
    },
    timestamp: new Date(msg.date * 1000)
  };

  const originDB = resolveOriginDB(chatIdStr);

  // === 可变字段 ===
  const mutablePart = {
    text: text || '',
    photo: photoInfo,
    video: videoInfo,
    document: documentInfo,
    published: false,
    originDB
  };

  if (media_group_id) {
    mutablePart.group_pending = true;
    mutablePart.group_received_at = new Date();
  }

  try {
    const result = await model.updateOne(
      { updateId: update.update_id },
      { $setOnInsert: immutablePart, $set: mutablePart },
      { upsert: true }
    );

    if (result.upsertedCount === 1) {
      console.log(`✅ [${chatIdStr}] 首次保存消息:`, update.update_id);
      await safeSendMessage(chat.id, successMsg);
    } else {
      console.log(`🔄 [${chatIdStr}] 已存在，字段已更新:`, update.update_id);
    }
  } catch (err) {
    console.error('❌ 保存 / 更新消息失败:', err.message);
  }
}

/* ------------------ 串行长轮询 ------------------- */
async function startPolling() {
  while (true) {
    try {
      const { data } = await axios.get(`${API_URL}/getUpdates`, {
        params: { offset: lastUpdateId + 1, timeout: 25 },
        httpsAgent: agent
      });
      
      for (const update of data.result) {
        await handleUpdate(update);
        lastUpdateId = update.update_id;
      }
    } catch (err) {
      console.error('❌ getUpdates 失败:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

/*------------------ 文件转发服务 ----------------------*/
const forwardTimestamps = new Map();
const FORWARD_INTERVAL = 2 * 60 * 1000; // 2 分钟

async function forwardFileMessage(fileUniqueId, toChatId = null) {
  try {
    const now = Date.now();

    // 限制转发频率
    const lastTime = forwardTimestamps.get(fileUniqueId) || 0;
    if (now - lastTime < FORWARD_INTERVAL) {
      logger.tdlight(`⚠️ ${fileUniqueId} 转发太频繁，已跳过`);
      return false;
    }

    const dbManager = require('../db/DBManager');
    const result = await dbManager.findFileByUniqueId(fileUniqueId);

    if (!result || !result.doc) {
      logger.error(`❌ 未找到文件: ${fileUniqueId}`);
      return false;
    }

    const message = result.doc;
    const { originDB } = result;

    const originalChatId = message.chatId.toString();
    const allowedChatIds = getAllowedChatIds();

    if (!allowedChatIds.includes(originalChatId)) {
      logger.warn(`⚠️ ChatId ${originalChatId} 不在允许列表`);
      return false;
    }

    // 执行转发（走官方）
    const res = await axios.post(`${API_URL}/forwardMessage`, {
      chat_id: originalChatId,
      from_chat_id: originalChatId,
      message_id: message.messageId
    }, { httpsAgent: agent });

    if (!res.data?.ok) {
      logger.error('❌ 转发失败:', res.data);
      return false;
    }

    forwardTimestamps.set(fileUniqueId, now);
    logger.tdlight(`✅ 已转发 fileUniqueId=${fileUniqueId}`);

    // 🔥 等待并更新主文件路径
    const mainFileUpdateSuccess =
      await waitAndUpdateMainFilePath(fileUniqueId, message, originDB);

    if (mainFileUpdateSuccess) {
      logger.tdlight(`✅ 主文件路径更新成功`);
    } else {
      logger.tdlight(`⚠️ 主文件路径更新失败或无需更新`);
    }

    return true;

  } catch (err) {
    logger.error(`❌ 转发处理出错: ${err.message}`);
    return false;
  }
}


/*------- 等待并更新主文件路径 --------*/
async function waitAndUpdateMainFilePath(fileUniqueId, originalMessage, originDB) {
  try {
    const originalFileId =
      originalMessage.video?.file_id ||
      originalMessage.document?.file_id;

    if (!originalFileId) {
      logger.tdlight(`❌ 无法获取原始文件ID`);
      return false;
    }

    // ✅ 修复：从 video 或 document 中获取文件大小
    const fileSize = 
      originalMessage.video?.file_size || 
      originalMessage.document?.file_size || 
      0;
    
    const SIZE_LIMIT = 20 * 1024 * 1024;

    // ✅ 小文件直接跳过
    if (fileSize < SIZE_LIMIT) {
      logger.tdlight(`🟢 小文件(${(fileSize / 1024 / 1024).toFixed(2)}MB)，无需TDLight等待`);
      return true;
    }

    // 🔵 大文件才进入 TDLight 轮询
    logger.tdlight(`🔵 大文件(${(fileSize / 1024 / 1024).toFixed(2)}MB)，开始等待TDLight生成路径`);

    let finalFilePath = null;
    let finalFileSize = 0;

    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const tdRes = await axios.get(`${TDLIGHT_URL}/getFile`, {
        params: { file_id: originalFileId },
        timeout: 5000
      }).catch(err => {
        logger.tdlight(`⚠️ 第${attempt + 1}次查询失败: ${err.message}`);
        return null;
      });

      if (tdRes?.data?.ok && tdRes.data.result?.file_path) {
        const newPath = tdRes.data.result.file_path;
        finalFileSize = tdRes.data.result.file_size || 0;

        if (
          newPath !== 'videos/file_0' &&
          newPath !== 'documents/file_0'
        ) {
          finalFilePath = newPath;
          break;
        }
      }
    }

    if (finalFilePath) {
      const updateSuccess =
        await updateMainFilePathInDatabase(
          fileUniqueId,
          finalFilePath,
          finalFileSize,
          originDB
        );

      if (updateSuccess) {
        await verifyFileExists(finalFilePath);
        return true;
      }
    }

    logger.warn(`⚠️ 大文件路径生成超时`);
    return false;

  } catch (error) {
    logger.error(`❌ 主文件路径更新异常: ${error.message}`);
    return false;
  }
}

/*---------- 验证文件是否实际存在 ----------*/
async function verifyFileExists(filePath) {
  try {
    const forwardBotDirName = process.env.FORWARD_BOT_DIR || token;
    const forwardBotPath = path.join(BASE_CACHE_DIR, forwardBotDirName, filePath);
    const existsInForward = fs.existsSync(forwardBotPath);
    
    if (existsInForward) {
      const stats = fs.statSync(forwardBotPath);
      logger.tdlight(`✅ 文件确认存在: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      return true;
    }

    // 检查其他可能的目录名称
    const alternativePaths = [
      path.join(BASE_CACHE_DIR, TDLIGHT_BOT_DIR, filePath),
      path.join(BASE_CACHE_DIR, token.split(':')[0], filePath)
    ];
    
    for (const altPath of alternativePaths) {
      if (fs.existsSync(altPath)) {
        return true;
      }
    }
    
    logger.tdlight(`❌ 文件在所有路径都不存在`);
    return false;
    
  } catch (error) {
    logger.tdlight(`⚠️ 文件验证失败: ${error.message}`);
    return false;
  }
}

/*-------- 更新数据库中的主文件路径 --------*/
async function updateMainFilePathInDatabase(fileUniqueId, filePath, fileSize, originDB) {
  try {
    let dbManager;
    try {
      dbManager = require('../db/DBManager');
    } catch (e) {
      try {
        dbManager = require(path.join(__dirname, '../db/DBManager'));
      } catch (e2) {
        logger.error(`❌ 无法加载DBManager: ${e.message}`);
        return false;
      }
    }

    const updateObj = {};

    if (filePath.includes('video')) {
      updateObj['video.file_path'] = filePath;
      if (fileSize > 0) updateObj['video.file_size'] = fileSize;
    } else if (filePath.includes('document')) {
      updateObj['document.file_path'] = filePath;
      if (fileSize > 0) updateObj['document.file_size'] = fileSize;
    } else {
      updateObj['video.file_path'] = filePath;
      updateObj['document.file_path'] = filePath;
      if (fileSize > 0) {
        updateObj['video.file_size'] = fileSize;
        updateObj['document.file_size'] = fileSize;
      }
    }

    const query = {
      $or: [
        { 'video.file_unique_id': fileUniqueId },
        { 'document.file_unique_id': fileUniqueId }
      ]
    };

    if (originDB === 'member') {
      for (const { id } of MEMBER_CATEGORIES) {
        const Model = await dbManager.getMemberModel(id);
        const result = await Model.updateOne(query, { $set: updateObj });
        if (result.modifiedCount > 0 || result.matchedCount > 0) {
          logger.tdlight(`✅ 会员分类${id} 数据库更新成功`);
          return true;
        }
      }
      logger.tdlight(`⚠️ 会员数据库更新无影响: 未找到匹配记录`);
      return false;
    }

    const modelName = getModelNameByOriginDB(originDB);
    const result = await dbManager.update(modelName, query, { $set: updateObj });

    if (result.modifiedCount > 0 || result.matchedCount > 0) {
      logger.tdlight(`✅ 数据库更新成功`);
      return true;
    }

    logger.tdlight(`⚠️ 数据库更新无影响: 未找到匹配记录`);
    return false;

  } catch (error) {
    logger.error(`❌ 数据库更新失败: ${error.message}`);
    return false;
  }
}

/*------- 根据originDB获取模型名称 ------*/
function getModelNameByOriginDB(originDB) {
  const originToModelMap = {
    'yy': 'YYTelegramMessage',
    'yx': 'TelegramMessage',
    'daily': 'TestTelegramMessage',
    'member': 'TelegramMessage',
    'telegram': 'TelegramMessage'
  };
  return originToModelMap[originDB] || 'TelegramMessage';
}

/*------- 手动触发文件缓存（用于调试或特殊场景）----*/
async function manualTriggerCache(fileUniqueId) {
  try {
    logger.tdlight(`🔧 手动触发缓存: ${fileUniqueId}`);
    const result = await forwardFileMessage(fileUniqueId);
    return result;
  } catch (error) {
    logger.error(`❌ 手动触发异常: ${error.message}`);
    return false;
  }
}


/*------------------ 图片文件修复函数 ----------------------*/
async function forwardPhotoMessage(fileUniqueId, toChatId) {
  try {
    const now = Date.now();

    /* 🔁 限制转发频率 - 使用独立的 Map 避免冲突 */
    const lastTime = forwardTimestamps.get(`photo_${fileUniqueId}`) || 0;
    if (now - lastTime < FORWARD_INTERVAL) {
      console.warn(`⚠️ 图片 ${fileUniqueId} 转发太频繁，已跳过（距上次不足2分钟）`);
      return { success: false, error: '转发频率限制' };
    }

    /* 🔍 从数据库中查找原始消息 */
    let TelegramModel = TelegramMessageDefault;
    if (modelMap[toChatId]) TelegramModel = modelMap[toChatId];

    let message = await TelegramModel.findOne({
      $or: [
        { 'photo.file_unique_id': fileUniqueId }
      ]
    });

    // 🔁 日更数据库
    if (!message) {
      console.log('🔎 主库未找到图片，尝试日更数据库...');
      const DailyModel = require('./models/TelegramMessage')(dailyDB);
      message = await DailyModel.findOne({
        $or: [
          { 'photo.file_unique_id': fileUniqueId }
        ]
      });
    }

    // 🔎 YY 数据库
    if (!message) {
      console.log('🔎 日更未找到图片，尝试 YY 数据库...');
      for (const chatId of worksChatIds) {
        message = await worksModelMap[chatId].findOne({
          $or: [
            { 'photo.file_unique_id': fileUniqueId }
          ]
        });
        if (message) break;
      }
    }

    if (!message) {
      console.warn(`⚠️ 未找到图片 fileUniqueId=${fileUniqueId} 的原始消息`);
      return { success: false, error: '未找到原始消息' };
    }

    /* 🧭 检查允许的 ChatId */
    const originalChatId = message.chatId.toString();
    const originalMessageId = message.messageId;

    const allowedChatIds = getAllowedChatIds();
    if (!allowedChatIds.includes(originalChatId)) {
      console.warn(`⚠️ ChatId ${originalChatId} 不在允许自动转发列表`);
      return { success: false, error: '聊天ID不在允许列表' };
    }

    /* 🚀 执行转发 */
    console.log(`📤 正在转发图片 chatId=${originalChatId}, messageId=${originalMessageId} ...`);
    const res = await axios.post(`${API_URL}/forwardMessage`, {
      chat_id: originalChatId,
      from_chat_id: originalChatId,
      message_id: originalMessageId
    }, { httpsAgent: agent });

    if (!(res.data && res.data.ok)) {
      console.error('❌ 图片转发失败:', res.data);
      return { success: false, error: '转发API调用失败' };
    }

    forwardTimestamps.set(`photo_${fileUniqueId}`, now);
    console.log(`✅ 已转发图片 fileUniqueId=${fileUniqueId}，等待 TDLight 缓存...`);

    /* 🔄 从转发结果中提取新的 file_id（照片通常有多个尺寸，取最大的） */
    const forwardedMsg = res.data.result || {};
    let newFileId = null;
    let newFileUniqueId = null;

    // 处理照片消息（photo 数组）
    if (forwardedMsg.photo && Array.isArray(forwardedMsg.photo) && forwardedMsg.photo.length > 0) {
      // 取最大尺寸的照片（通常是最后一个）
      const largestPhoto = forwardedMsg.photo[forwardedMsg.photo.length - 1];
      newFileId = largestPhoto.file_id;
      newFileUniqueId = largestPhoto.file_unique_id;
      console.log(`🖼️ 检测到新图片 file_id=${newFileId}, file_unique_id=${newFileUniqueId}`);
    }

    if (!newFileId) {
      console.warn('⚠️ 未从转发结果中获取到新的 file_id');
      return { success: false, error: '未获取到新file_id' };
    }

    /* 💾 等待 TDLight 缓存图片文件路径 */
    let newFilePath = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const tdRes = await axios.get(`${TDLIGHT_URL}/getFile`, {
        params: { file_id: newFileId }
      }).catch(() => null);

      if (tdRes?.data?.ok && tdRes.data.result.file_path) {
        newFilePath = tdRes.data.result.file_path;
        console.log(`✅ TDLight 图片缓存成功: ${newFilePath}`);
        break;
      }
      
      if (i === 14) {
        console.warn(`⚠️ TDLight 图片缓存超时 fileUniqueId=${fileUniqueId}`);
        return { success: false, error: 'TDLight缓存超时' };
      }
    }

/* 📊 更新数据库 */
if (message.photo) {
  if (Array.isArray(message.photo)) {
    const photoIndex = message.photo.findIndex(p => p.file_unique_id === fileUniqueId);
    if (photoIndex !== -1) {
      message.photo[photoIndex].file_id = newFileId;
      message.photo[photoIndex].file_path = newFilePath;
      if (newFileUniqueId) message.photo[photoIndex].file_unique_id = newFileUniqueId;
    } else {
      const lastIndex = message.photo.length - 1;
      message.photo[lastIndex].file_id = newFileId;
      message.photo[lastIndex].file_path = newFilePath;
      if (newFileUniqueId) message.photo[lastIndex].file_unique_id = newFileUniqueId;
    }
  } else if (typeof message.photo === 'object') {
    message.photo.file_id = newFileId;
    message.photo.file_path = newFilePath;
    if (newFileUniqueId) message.photo.file_unique_id = newFileUniqueId;
  }
}

try {
  await message.save();
  console.log('📦 机器人数据库已更新图片 file_id 和 file_path');
} catch (saveErr) {
  console.warn('⚠️ 保存图片信息到机器人数据库失败:', saveErr.message);
}

/* 同步更新历史数据库 */
try {
  await HistoryMessage.updateOne(
    { 'photo.file_unique_id': fileUniqueId },
    {
      $set: {
        'photo.file_id': newFileId,
        'photo.file_path': newFilePath,
        ...(newFileUniqueId && { 'photo.file_unique_id': newFileUniqueId })
      }
    }
  );
  console.log(`📜 历史数据库已同步更新图片 file_id=${fileUniqueId}`);
} catch (historyErr) {
  console.warn(`⚠️ 更新历史数据库图片 file_id 失败: ${historyErr.message}`);
}


    // 更新历史数据库
    try {
      await HistoryMessage.updateOne(
        { 'photo.file_unique_id': fileUniqueId },
        { 
          $set: { 
            'photo.$[elem].file_id': newFileId,
            'photo.$[elem].file_path': newFilePath,
            ...(newFileUniqueId && { 'photo.$[elem].file_unique_id': newFileUniqueId })
          }
        },
        {
          arrayFilters: [{ 'elem.file_unique_id': fileUniqueId }]
        }
      );
      console.log(`📜 历史数据库已同步更新图片 file_id=${fileUniqueId}`);
    } catch (historyErr) {
      console.warn(`⚠️ 更新历史数据库图片 file_id 失败: ${historyErr.message}`);
    }

    /* 💽 尝试缓存图片到本地 */
    let cachedLocalPath = null;
    if (newFilePath) {
      try {
        const ext = path.extname(newFilePath) || '.jpg';
        const localFileName = `${newFileId}.${newFileUniqueId || fileUniqueId}${ext}`;
        const localSavePath = path.join(LOCAL_CACHE_DIR, localFileName);

        // 确保本地缓存目录存在
        await fs.promises.mkdir(LOCAL_CACHE_DIR, { recursive: true });

        // TDLight 存储的绝对路径
        const absTdPath = path.join(TDLIGHT_CACHE_BASE, TDLIGHT_BOT_TOKEN, newFilePath);

        if (fs.existsSync(absTdPath)) {
          // 直接复制文件
          await fs.promises.copyFile(absTdPath, localSavePath);
          cachedLocalPath = localSavePath;
          console.log(`💾 图片已从 TDLight 缓存复制到本地: ${localSavePath}`);
        } else {
          // 通过 proxy 下载
          try {
            const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
            const proxyUrl = `${TDLIGHT_PROXY}/proxy-file?path=${encodePath(newFilePath)}`;
            console.log(`🔁 TDLight 文件不在磁盘，尝试通过 proxy 下载: ${proxyUrl}`);
            
            const streamRes = await axios.get(proxyUrl, { 
              responseType: 'stream', 
              timeout: 10 * 1000 
            });

            const writer = fs.createWriteStream(localSavePath);
            streamRes.data.pipe(writer);
            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });
            cachedLocalPath = localSavePath;
            console.log(`💾 图片通过 proxy 下载并保存至: ${localSavePath}`);
          } catch (proxyErr) {
            console.warn(`⚠️ proxy 下载图片失败: ${proxyErr.message}`);
          }
        }
      } catch (cacheErr) {
        console.warn(`⚠️ 本地图片缓存失败: ${cacheErr.message}`);
      }
    }

    /* 📬 通知 server.js 文件已更新 */
    try {
      // 通知新的 file_id
      await axios.get(`http://localhost:3000/file/${newFileId}`);
      console.log(`📬 已通知 /file/${newFileId}（新文件）`);
      
      // 同时通知原 file_unique_id 以便更新缓存
      await axios.get(`http://localhost:3000/file/${fileUniqueId}`);
      console.log(`📬 已通知 /file/${fileUniqueId}（原文件ID）`);
    } catch (notifyErr) {
      console.warn(`⚠️ 通知 server.js 出错: ${notifyErr.message}`);
    }

    console.log(`✅ 图片修复完成: ${fileUniqueId} -> ${newFileId}`);
    return { 
      success: true, 
      newFileId: newFileId,
      newFileUniqueId: newFileUniqueId,
      filePath: newFilePath,
      cachedLocalPath: cachedLocalPath
    };

  } catch (err) {
    console.error(`❌ 图片转发处理出错 fileUniqueId=${fileUniqueId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/*---------  暴露forwardFileMessage() forwardPhotoMessage() 函数让/file/:fileId调用  ---------*/
module.exports = {
  forwardFileMessage,
  forwardPhotoMessage,
  startPolling,  // 若其他模块想主动触发，可直接调用
  manualTriggerCache
};