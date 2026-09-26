// 所有数据保存 数据模型
const mongoose = require('mongoose');

// Telegram 消息数据结构定义
const TelegramMessageSchema = new mongoose.Schema(
  {
    // 🔹 Telegram 更新 ID
    updateId: { type: Number, unique: true, required: true },

    // 🔹 当前 chat 中的消息 ID
    messageId: { type: Number, required: true },

    // 🔹 来源 Chat 信息
    chatId: { type: String, required: true },
    chatType: String,
    chatTitle: String,

    // 🔹 发送者信息
    from: {
      id: Number,
      is_bot: Boolean,
      username: String,
      first_name: String,
      last_name: String,
      language_code: String
    },

    // 📝 文本
    text: String,
    entities: [mongoose.Schema.Types.Mixed], // 支持解析 @mention / URL / hashtag 等富文本

    // 🖼️ 图片（photo 实际是数组，仅保留最大尺寸）
    photo: {
      media_group_id: String,
      file_id: String,
      file_unique_id: String,
      width: Number,
      height: Number,
      caption: String,
      file_size: Number,
      file_path: String
    },

    // 📹 视频
    video: {
      media_group_id: String,
      file_id: String,
      file_unique_id: String,
      thumb_file_id: String,
      duration: Number,
      width: Number,
      height: Number,
      caption: String,
      file_size: Number,
      file_path: String
    },

    // 📎 文档（含文件名和封面）
    document: {
      media_group_id: String,
      file_id: String,
      file_unique_id: String,
      file_name: String,
      mime_type: String,
      file_size: Number,
      thumb_file_id: String,
      caption: String,
      file_path: String
    },

    // 🔗 音频（Audio）
    audio: {
      file_id: String,
      file_unique_id: String,
      duration: Number,
      mime_type: String,
      file_size: Number,
      file_path: String,
      caption: String
    },

    // 🎤 语音消息（Voice）
    voice: {
      file_id: String,
      file_unique_id: String,
      duration: Number,
      mime_type: String,
      file_size: Number,
      file_path: String
    },

    // 📸 视频消息（Video Note）
    video_note: {
      file_id: String,
      file_unique_id: String,
      length: Number,
      duration: Number,
      file_size: Number,
      file_path: String
    },

    // 📷 媒体组 ID
    media_group_id: { type: String },

    // 🧭 文件来源（转发时记录原始来源）
    originalChatId: Number,
    originalMessageId: Number,

    // ⏰ 消息时间
    timestamp: { type: Date },

    // 🕒 群组等待状态
    group_pending: { type: Boolean, default: false },
    group_received_at: { type: Date },

    // 🚀 是否已发布到聊天室
    published: { type: Boolean, default: false },

    // 🚀 数据归属分类（缓存目录、系统分库使用）
    originDB: { type: String, index: true, default: '' }
  },
  {
    timestamps: true,
    collection: 'telegrammessages'
  }
);

// 🔍 索引优化
TelegramMessageSchema.index({ published: 1, timestamp: 1 });
TelegramMessageSchema.index({ chatId: 1, media_group_id: 1 });

// 导出模型（防止重复注册）
module.exports = (connection) => {
  return (
    connection.models.TelegramMessage ||
    connection.model('TelegramMessage', TelegramMessageSchema)
  );
};
