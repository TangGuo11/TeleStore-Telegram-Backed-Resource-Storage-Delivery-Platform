// 会员 VIP 数据模型（按集合名分库）
const mongoose = require('mongoose');

const MemberTelegramMessageSchema = new mongoose.Schema({
  updateId: { type: Number, unique: true, required: true },
  messageId: Number,
  chatId: { type: mongoose.Schema.Types.Mixed, required: true },
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
  media_group_id: String,
  originalChatId: Number,
  originalMessageId: Number,
  timestamp: Date,
  published: { type: Boolean, default: false },
  originDB: { type: String, default: 'member' }
}, {
  timestamps: true
});

MemberTelegramMessageSchema.index({ published: 1, timestamp: 1 });
MemberTelegramMessageSchema.index({ chatId: 1, 'video.media_group_id': 1 });
MemberTelegramMessageSchema.index({ chatId: 1, 'photo.media_group_id': 1 });

module.exports = (connection, modelName, collectionName) => {
  return connection.models[modelName] ||
    connection.model(modelName, MemberTelegramMessageSchema, collectionName);
};
