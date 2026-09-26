// models/UserActivity.js
const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: false
  },
  visitorId: { type: String },
  username: { type: String, default: 'Guest' },
  loginAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  logoutAt: { type: Date, default: null },
  durationSec: { type: Number, default: null },
  // 添加页面停留时间统计
  pageStats: {
    home: { type: Number, default: 0 },        // 在首页的秒数
    chat: { type: Number, default: 0 },        // 在聊天室的秒数  
    works: { type: Number, default: 0 },       // 在作品页的秒数
    lastPath: { type: String, default: '' }    // 最后访问的页面
  },
  meta: { type: Object, default: {} }
}, { timestamps: true });

userActivitySchema.index({ userId: 1, loginAt: -1 });
userActivitySchema.index({ visitorId: 1, loginAt: -1 });
userActivitySchema.index({ loginAt: -1 });
userActivitySchema.index({ lastSeenAt: 1 });

module.exports = mongoose.model('UserActivity', userActivitySchema);