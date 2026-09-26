//bot/GameBot.js
const axios = require('axios');
const https = require('https');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const GameMessage = require('./models/GameMessage');

// 环境变量检查
if (!process.env.BOT_TOKEN || !process.env.MONGO_URL) {
  console.error('❌ 错误: 环境变量未设置');
  process.exit(1);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const TDLIGHT_URL = process.env.TDLIGHT_URL;
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// 强制 IPv4
const agent = new https.Agent({ family: 4 });
let lastUpdateId = 0;

// 限流控制
const pLimit = require('p-limit').default;
const limitGetFile = pLimit(3);
const limitSendMessage = pLimit(1);

const delay = ms => new Promise(r => setTimeout(r, ms));

// 常量定义
const FILE_SIZE_THRESHOLD = 20 * 1024 * 1024; // 20MB
const MAX_RETRIES = 5;
const BASE_DELAY = 5000;

/*------------ 平台检测函数 ------------*/
function detectPlatform(document) {
  if (!document || !document.file_name) return 'unknown';
  
  const name = document.file_name.toLowerCase();
  
  // 移动端识别
  if (name.includes('.apk') || name.includes('android') || name.includes('mobile') ||
      name.includes('手机版') || name.includes('安卓')) {
    return 'mobile';
  }
  
  // PC端识别
  if (name.includes('.exe') || name.includes('.msi') || name.includes('.dmg') ||
      name.includes('.pkg') || name.includes('windows') || name.includes('pc') ||
      name.includes('电脑版') || name.includes('win') || /\.(zip|rar|7z)$/i.test(name)) {
    return 'pc';
  }
  
  return 'unknown';
}

/*------------ 价格提取函数 ------------*/
function extractPrice(caption) {
  if (!caption) return null;
  const match = caption.match(/(?:¥|￥)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:元|RMB)?/i);
  return match ? parseFloat(match[1]) : null;
}

/*------------ 判断安装包 ------------*/
function isInstaller(document) {
  if (!document) return false;
  const name = (document.file_name || '').toLowerCase();

  // 基础扩展名
  if (/\.(apk|zip|rar|7z)$/i.test(name)) return true;

  // 分卷压缩包
  const multiPartPatterns = [
    /\.part\d+\.(zip|rar|7z)$/i,
    /\.(zip|rar|7z)\.\d+$/i,
    /\.z\d+$/i,
    /\.(\d{3})$/i,
    /(\d+)of(\d+)\.(zip|rar|7z)$/i
  ];

  return multiPartPatterns.some(p => p.test(name));
}

function isInstallerFromMedia(media) {
  return media.type === 'document' && isInstaller({ file_name: media.file_name });
}

/*------------ 媒体组管理 ------------*/
const mediaGroupCache = new Map();
const mediaGroupTimers = new Map();
const mediaGroupProcessing = new Set();

async function scheduleMediaGroupProcessing(mediaGroupId, chatId) {
  if (mediaGroupProcessing.has(mediaGroupId)) return;
  
  // 清除旧定时器
  if (mediaGroupTimers.has(mediaGroupId)) {
    clearTimeout(mediaGroupTimers.get(mediaGroupId));
    mediaGroupTimers.delete(mediaGroupId);
  }
  
  const groupMessages = mediaGroupCache.get(mediaGroupId) || [];
  const messageCount = groupMessages.length;
  
  // 动态等待时间
  const totalDelay = 10000 + (messageCount * 2000);
  
  const timer = setTimeout(() => processMediaGroup(mediaGroupId, chatId), totalDelay);
  mediaGroupTimers.set(mediaGroupId, timer);
}

async function processMediaGroup(mediaGroupId, chatId) {
  if (mediaGroupProcessing.has(mediaGroupId)) return;
  mediaGroupProcessing.add(mediaGroupId);
  
  // 清理定时器
  if (mediaGroupTimers.has(mediaGroupId)) {
    clearTimeout(mediaGroupTimers.get(mediaGroupId));
    mediaGroupTimers.delete(mediaGroupId);
  }
  
  await delay(1000);
  
  const groupMessages = mediaGroupCache.get(mediaGroupId);
  if (!groupMessages?.length) {
    cleanupMediaGroup(mediaGroupId);
    return;
  }

  console.log(`🔄 处理媒体组 ${mediaGroupId}, 包含 ${groupMessages.length} 条消息`);
  
  // 检查完整性
  groupMessages.sort((a, b) => a.message_id - b.message_id);
  const messageIds = groupMessages.map(m => m.message_id);
  const minId = Math.min(...messageIds);
  const maxId = Math.max(...messageIds);
  
  if (maxId - minId + 1 > groupMessages.length) {
    console.log(`⏳ 媒体组不完整，等待3秒...`);
    mediaGroupProcessing.delete(mediaGroupId);
    setTimeout(() => processMediaGroup(mediaGroupId, chatId), 3000);
    return;
  }
  
  // 合并媒体
  const allMedias = [];
  let caption = '';
  let timestamp = null;
  const originalMessageIds = [];
  let firstMessageId = null;

  for (const msgData of groupMessages) {
    if (msgData.medias) {
      for (const media of msgData.medias) {
        // 确保大文件路径已获取
        if (media.type === 'document' && media.file_size >= FILE_SIZE_THRESHOLD && !media.file_path) {
          const tdlightData = await getLargeFileWithCache(media.file_unique_id, media.tdlight_file_id).catch(() => null);
          if (tdlightData) {
            media.file_path = tdlightData.file_path;
            media.file_id = tdlightData.tdlight_file_id; // 🔥 大文件使用 TDLight file_id
          }
        }
        allMedias.push(media);
      }
    }
    if (msgData.caption && !caption) caption = msgData.caption;
    if (msgData.timestamp && !timestamp) timestamp = msgData.timestamp;
    if (msgData.message_id) {
      originalMessageIds.push(msgData.message_id);
      if (!firstMessageId) firstMessageId = msgData.message_id;
    }
  }

  // 保存到数据库
  const gameMsg = new GameMessage({
    groupId: mediaGroupId,
    originalMessageIds,
    chatId: chatId.toString(),
    messageId: firstMessageId || 0,
    title: caption || '',
    medias: allMedias,
    timestamp: timestamp || new Date(),
    price: extractPrice(caption) || 0,
    gameId: await generateGameId(),
    platform: 'unknown'
  });

  try {
    await gameMsg.save();
    console.log(`✅ 媒体组保存成功: ${allMedias.length}个媒体, GameID=${gameMsg.gameId}`);
    
    // 发送通知
    const message = formatSuccessMessage(allMedias, gameMsg.gameId, extractPrice(caption));
    await safeSendMessage(chatId, message);
    
  } catch (err) {
    console.error('❌ 媒体组保存失败:', err.message);
  } finally {
    cleanupMediaGroup(mediaGroupId);
  }
}

function cleanupMediaGroup(mediaGroupId) {
  mediaGroupCache.delete(mediaGroupId);
  mediaGroupTimers.delete(mediaGroupId);
  mediaGroupProcessing.delete(mediaGroupId);
}

/*------------ GameID生成 ------------*/
async function generateGameId() {
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");

  const randomDigits = () => String(Math.floor(1000 + Math.random() * 9000));
  const randomLetters = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return Array(4).fill().map(() => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  };

  while (true) {
    const gameId = `GM-${ymd}-${randomDigits()}-${randomLetters()}`;
    const exists = await GameMessage.findOne({ gameId }).lean();
    if (!exists) return gameId;
  }
}

/*------------ 消息发送 ------------*/
async function safeSendMessage(chatId, text, retry = 0) {
  return limitSendMessage(async () => {
    try {
      await axios.post(`${API_URL}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      }, { httpsAgent: agent, timeout: 10000 });
      console.log(`✅ 消息发送成功到 ${chatId}`);
      await delay(500);
    } catch (err) {
      if (err.response?.status === 429 && retry < 3) {
        const wait = (err.response.data.parameters?.retry_after || 1) * 1000;
        await delay(wait);
        return safeSendMessage(chatId, text, retry + 1);
      }
      console.warn('⚠️ sendMessage 失败:', err.message);
    }
  });
}

function formatSuccessMessage(medias, gameId, price) {
  const mediaTypes = new Set(medias.map(m => m.type));
  const hasInstaller = medias.some(isInstallerFromMedia);
  
  let message = '';
  if (hasInstaller) {
    const installers = medias.filter(isInstallerFromMedia);
    message = `📦 游戏安装包已保存\n包含 ${installers.length} 个安装文件\nGameID: <code>${gameId}</code>`;
  } else if (mediaTypes.has('photo') || mediaTypes.has('video')) {
    message = `🖼 游戏媒体已保存\n包含 ${medias.length} 个媒体文件\nGameID: <code>${gameId}</code>`;
  } else {
    message = `📁 游戏资源已保存\n包含 ${medias.length} 个文件\nGameID: <code>${gameId}</code>`;
  }
  
  if (price) message += `\n价格: ${price} 元`;
  return message;
}

/*------------ 平台信息更新 ------------*/
async function updateLatestGamePlatform(platform) {
  try {
    const latestGame = await GameMessage.findOne({ gameId: { $ne: null } })
      .sort({ createdAt: -1 }).lean();
    
    if (latestGame?.platform === 'unknown') {
      await GameMessage.updateOne(
        { _id: latestGame._id },
        { $set: { platform } }
      );
      console.log(`✅ 更新游戏平台: ${latestGame.gameId} -> ${platform}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('❌ 更新游戏平台失败:', err.message);
    return false;
  }
}

/*------------ 查找最近游戏 ------------*/
async function findLatestGameIntroduction() {
  try {
    return await GameMessage.findOne({ gameId: { $ne: null } })
      .sort({ createdAt: -1 }).lean();
  } catch (err) {
    console.error('❌ 查找最近游戏失败:', err.message);
    return null;
  }
}

/*------------ TDLight文件处理 ------------*/
async function getTDLightFileIdByUniqueId(fileUniqueId) {
  console.log(`🔍 查找 TDLight file_id: ${fileUniqueId}`);
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await delay(BASE_DELAY * Math.pow(2, attempt - 1));
      }
      
      const res = await axios.get(`${TDLIGHT_URL}/getUpdates`, {
        params: { limit: 100, timeout: 10 },
        timeout: 30000
      });
      
      if (!res.data.ok || !res.data.result) continue;
      
      for (const update of res.data.result) {
        const msg = update.message;
        if (!msg) continue;
        
        // 检查各类媒体
        if (msg.document?.file_unique_id === fileUniqueId) {
          return { tdlight_file_id: msg.document.file_id, file_size: msg.document.file_size };
        }
        if (msg.video?.file_unique_id === fileUniqueId) {
          return { tdlight_file_id: msg.video.file_id, file_size: msg.video.file_size };
        }
        if (msg.photo) {
          for (const photo of msg.photo) {
            if (photo.file_unique_id === fileUniqueId) {
              return { tdlight_file_id: photo.file_id, file_size: photo.file_size };
            }
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ 尝试 ${attempt + 1} 失败:`, err.message);
    }
  }
  
  console.warn('❌ 未找到TDLight file_id');
  return null;
}

async function getLargeFileWithCache(fileUniqueId, tdlightFileId = null) {
  console.log('🔄 开始大文件缓存流程');
  
  // 获取TDLight file_id
  if (!tdlightFileId) {
    const result = await getTDLightFileIdByUniqueId(fileUniqueId);
    if (!result) return null;
    tdlightFileId = result.tdlight_file_id;
  }
  
  // 等待文件缓存完成
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await delay(BASE_DELAY * Math.pow(2, attempt - 1));
      }
      
      const res = await axios.get(`${TDLIGHT_URL}/getFile`, {
        params: { file_id: tdlightFileId },
        timeout: 30000
      });
      
      if (res.data.ok && res.data.result?.file_path) {
        console.log(`✅ 大文件缓存成功`);
        return {
          tdlight_file_id: tdlightFileId,
          file_path: res.data.result.file_path,
          file_size: res.data.result.file_size || 0
        };
      }
    } catch (err) {
      console.warn(`⚠️ 缓存尝试 ${attempt + 1} 失败:`, err.message);
    }
  }
  
  console.error('❌ 大文件缓存失败');
  return null;
}

/*------------ 官方API文件处理 ------------*/
async function getSmallFileWithAPI(fileId) {
  try {
    const res = await axios.get(`${API_URL}/getFile`, {
      params: { file_id: fileId },
      httpsAgent: agent,
      timeout: 20000
    });

    if (res.data.ok && res.data.result?.file_path) {
      return {
        file_path: res.data.result.file_path,
        file_size: res.data.result.file_size || 0
      };
    }
  } catch (err) {
    console.error('❌ 官方API失败:', err.message);
  }
  return null;
}

/*------------ 主处理函数 ------------*/
async function handleUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const { chat, message_id, caption, photo, video, document, media_group_id, date } = msg;
  
  console.log(`📨 消息: chat=${chat.id}, id=${message_id}, type=${getMessageType(msg)}`);

  const medias = [];
  
  // 处理照片
  if (photo?.length) {
    const largest = photo[photo.length - 1];
    medias.push(createMediaObject('photo', largest, caption));
  }
  
  // 处理视频
  if (video) {
    await processVideoMedia(video, media_group_id, message_id, medias, caption);
  }
  
  // 处理文档
  if (document) {
    await processDocumentMedia(document, media_group_id, message_id, medias, caption);
  }

  if (medias.length === 0) return;

  // 媒体组处理
  if (media_group_id) {
    handleMediaGroup(media_group_id, message_id, medias, caption, date, chat.id);
    return;
  }

  // 独立消息处理
  await handleSingleMessage(chat.id, message_id, medias, caption, date, document);
}

function getMessageType(msg) {
  if (msg.photo) return 'photo';
  if (msg.video) return 'video';
  if (msg.document) return 'document';
  return 'text';
}

function createMediaObject(type, data, caption) {
  const base = {
    type,
    file_id: data.file_id,
    file_unique_id: data.file_unique_id,
    caption: caption || '',
    file_size: data.file_size || 0,
    file_path: ''
  };
  
  if (type === 'photo') {
    return { ...base, width: data.width, height: data.height };
  }
  if (type === 'video') {
    return { ...base, width: data.width, height: data.height, duration: data.duration };
  }
  return { ...base, file_name: data.file_name, mime_type: data.mime_type };
}

async function processVideoMedia(video, media_group_id, message_id, medias, caption) {
  const isLargeFile = (video.file_size || 0) >= FILE_SIZE_THRESHOLD;
  
  if (media_group_id && isLargeFile) {
    // 异步获取tdlight_file_id
    limitGetFile(() => getTDLightFileIdByUniqueId(video.file_unique_id)).then(result => {
      if (result && mediaGroupCache.has(media_group_id)) {
        updateMediaGroupTdlightId(media_group_id, message_id, result.tdlight_file_id);
      }
    });
  } else if (!media_group_id && isLargeFile) {
    // 同步等待缓存完成
    const cached = await limitGetFile(() => getLargeFileWithCache(video.file_unique_id));
    if (cached) {
      video.file_path = cached.file_path;
      video.tdlight_file_id = cached.tdlight_file_id;
      video.file_id = cached.tdlight_file_id; // 🔥 大文件使用 TDLight file_id
    }
  }
  
  medias.push(createMediaObject('video', video, caption));
}

async function processDocumentMedia(document, media_group_id, message_id, medias, caption) {
  const isLargeFile = (document.file_size || 0) >= FILE_SIZE_THRESHOLD;
  
  // 🔥 初始化文件元数据，默认使用官方API的file_id
  let fileMeta = { 
    file_path: '', 
    tdlight_file_id: '',
    file_id: document.file_id,  // 默认官方API file_id
    file_size: document.file_size || 0
  };
  
  if (media_group_id && isLargeFile) {
    // 媒体组大文件：异步获取tdlight_file_id
    limitGetFile(() => getTDLightFileIdByUniqueId(document.file_unique_id)).then(result => {
      if (result && mediaGroupCache.has(media_group_id)) {
        updateMediaGroupTdlightId(media_group_id, message_id, result.tdlight_file_id);
      }
    });
  } else if (!media_group_id) {
    if (isLargeFile) {
      // 🔥 独立大文件：同步等待缓存完成，使用TDLight file_id
      const cached = await limitGetFile(() => getLargeFileWithCache(document.file_unique_id));
      if (cached) {
        fileMeta = {
          ...fileMeta,
          file_path: cached.file_path,
          tdlight_file_id: cached.tdlight_file_id,
          file_id: cached.tdlight_file_id,  // 🔥 大文件使用 TDLight file_id
          file_size: cached.file_size || document.file_size
        };
        console.log(`✅ 大文件使用 TDLight file_id: ${cached.tdlight_file_id.substring(0, 20)}...`);
      }
    } else {
      // 小文件官方API
      const apiData = await limitGetFile(() => getSmallFileWithAPI(document.file_id));
      if (apiData) {
        fileMeta.file_path = apiData.file_path;
        // file_id 保持官方API的
      }
    }
  }
  
  medias.push({
    type: 'document',
    file_id: fileMeta.file_id,  // 🔥 大文件是TDLight file_id，小文件是官方API file_id
    file_unique_id: document.file_unique_id,
    file_name: document.file_name,
    mime_type: document.mime_type,
    caption: caption || '',
    file_size: fileMeta.file_size,
    file_path: fileMeta.file_path || '',
    tdlight_file_id: fileMeta.tdlight_file_id || '',
    thumb_file_id: document.thumb?.file_id || '',
    thumb_path: ''
  });
}

function updateMediaGroupTdlightId(media_group_id, message_id, tdlight_file_id) {
  const groupMessages = mediaGroupCache.get(media_group_id);
  if (!groupMessages) return;
  
  for (const msgData of groupMessages) {
    if (msgData.message_id === message_id && msgData.medias?.[0]) {
      msgData.medias[0].tdlight_file_id = tdlight_file_id;
      break;
    }
  }
}

function handleMediaGroup(media_group_id, message_id, medias, caption, date, chatId) {
  if (!mediaGroupCache.has(media_group_id)) {
    mediaGroupCache.set(media_group_id, []);
  }
  
  mediaGroupCache.get(media_group_id).push({
    message_id,
    medias,
    caption,
    timestamp: new Date(date * 1000)
  });
  
  scheduleMediaGroupProcessing(media_group_id, chatId);
}

async function handleSingleMessage(chatId, messageId, medias, caption, date, document) {
  const isInstallPackage = isInstaller(document);
  const platform = detectPlatform(document);
  const price = extractPrice(caption);
  
  let gameId;
  if (isInstallPackage) {
    const latestGame = await findLatestGameIntroduction();
    if (latestGame) {
      gameId = latestGame.gameId;
      if (latestGame.platform === 'unknown' && platform !== 'unknown') {
        await updateLatestGamePlatform(platform);
      }
    } else {
      gameId = await generateGameId();
    }
  } else {
    gameId = await generateGameId();
  }
  
  const gameMsg = new GameMessage({
    groupId: null,
    originalMessageIds: [messageId],
    chatId: chatId.toString(),
    messageId,
    title: caption || '',
    medias,
    timestamp: new Date(date * 1000),
    price: price || 0,
    gameId,
    platform: isInstallPackage ? platform : 'unknown'
  });

  try {
    await gameMsg.save();
    console.log(`✅ 保存成功: GameID=${gameId}`);
    
    const message = formatSuccessMessage(medias, gameId, price);
    await safeSendMessage(chatId, message);
    
  } catch (err) {
    console.error('❌ 保存失败:', err.message);
  }
}

/*------------ 启动轮询 ------------*/
async function startPolling() {
  console.log('🚀 机器人启动中...');
  console.log(`📏 文件阈值: ${FILE_SIZE_THRESHOLD / 1024 / 1024} MB`);
  
  // 连接MongoDB
  await mongoose.connect(MONGO_URL);
  console.log('✅ MongoDB connected');
  
  while (true) {
    try {
      const { data } = await axios.get(`${API_URL}/getUpdates`, {
        params: {
          offset: lastUpdateId + 1,
          timeout: 25,
          allowed_updates: JSON.stringify(['message'])
        },
        httpsAgent: agent,
        timeout: 30000
      });

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          await handleUpdate(update);
          lastUpdateId = update.update_id;
        }
      }
    } catch (err) {
      console.error('❌ 轮询失败:', err.message);
      await delay(5000);
    }
  }
}

/*------------ 启动 ------------*/
startPolling().catch(err => {
  console.error('💥 启动失败:', err);
  process.exit(1);
});