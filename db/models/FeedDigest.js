//日更读取固定数据量数据到feed_digests 集合中
const mongoose = require('mongoose');

const FeedDigestSchema = new mongoose.Schema({
  title: String,

  // ✅ 每个媒体都可以单独携带 thumbnail
  medias: [{
    type: { 
      type: String, 
      enum: ['photo', 'video', 'document'], 
      required: true 
    },
    url: { 
      type: String, 
      required: true 
    },
    caption: { type: String },
    thumbnail: { type: String } // ✅ 新增：每个媒体单独缩略图
  }],

  // ✅ 整个组的封面（取第一张或第一视频缩略图）
  thumbnail: String,

  chatId: String,
  media_group_id: String,
  file_path: String,

  // 溯源信息
  originalMessageId: mongoose.Schema.Types.ObjectId,
  originalMessageIds: [mongoose.Schema.Types.ObjectId],

  groupId: String,
  timestamp: Date,

  // 元信息
  createdAt: { type: Date, default: Date.now }
}, { collection: 'feed_digests' });

module.exports = conn => conn.model('FeedDigest', FeedDigestSchema);
