//作品数据读取数据模型

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
  published: { type: Boolean, default: false }
}, {
  timestamps: true
});

// 索引
TelegramMessageSchema.index({ published: 1, timestamp: 1 });

module.exports = (connection) => {
  return connection.models.YYTelegramMessage || 
         connection.model('YYTelegramMessage', TelegramMessageSchema, 'telegrammessages');
};
