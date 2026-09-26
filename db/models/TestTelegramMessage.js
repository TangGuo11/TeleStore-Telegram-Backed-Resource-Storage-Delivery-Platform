//server.js_数据读取所有数据 数据模型

const mongoose = require('mongoose');

// Telegram 消息数据结构定义
const TelegramMessageSchema = new mongoose.Schema({
  updateId: { type: Number, unique: true, required: true },
  messageId: Number,
  chatId: { type: String, required: true },
  from: {
    id: Number,
    username: String,
    first_name: String,
    last_name: String
  },
  text: String,
  photo: {
    media_group_id: String,
    file_id: String,
    file_unique_id: String,
    width: Number,
    height: Number,
    caption: String,
  },
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
  originalChatId: Number,
  originalMessageId: Number,
  timestamp: Date,
  originDB: { type: String, index: true },
  published: { type: Boolean, default: false }
}, {
  timestamps: true
});

// 索引
TelegramMessageSchema.index({ published: 1, timestamp: 1 });

/**
 * ✅ 创建模型时强制绑定集合名为 'telegrammessages'
 *    避免默认用模型名生成错的集合名（如 testtelegrammessages）
 */
module.exports = (connection) => {
  return connection.models.TestTelegramMessage ||
         connection.model('TestTelegramMessage', TelegramMessageSchema, 'telegrammessages');
  //                        ↑               ↑               ↑
  //             模型名称（随意）   schema        集合名称（必须明确为 telegrammessages）
};








