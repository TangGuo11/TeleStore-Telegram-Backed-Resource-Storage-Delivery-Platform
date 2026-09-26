// yx/game-shop/models/Order.js
const mongoose = require('mongoose');
const orderConnection = require('../connections/orderDB');

const OrderSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },

  gameId: { 
    type: String, 
    required: true 
  },

  title: String,

  amount: { 
    type: Number, 
    required: true 
  },

  status: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  },

  payPlatform: {
    type: String,
    default: 'idataRiver'
  },

  // iDataRiver 平台订单号
  payOrderId: {
    type: String,
    index: true
  },

  // 多支付方式支持
  alipayUrl: String,
  wxpayUrl: String,

  /**
   * 🔥 自动过期字段
   * 订单创建时设置为：当前时间 + 4分钟
   * MongoDB 会在到期后自动删除
   */
  expireAt: {
    type: Date,
    default: null
  }

}, {
  timestamps: true,
  collection: 'game_orders'
});

/**
 * 🔥 TTL 自动删除索引
 * expireAfterSeconds: 0 表示时间一到立即过期
 */
OrderSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = orderConnection.model('Order', OrderSchema);