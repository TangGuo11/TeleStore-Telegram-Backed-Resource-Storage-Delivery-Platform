// models/Order.js
const mongoose = require('mongoose');
const orderConnection = require('../connections/orderDB'); // ✅ 引入 orderConnection

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true },
  groupId: { type: String, required: true }, // 👈 使用 groupId 替代 productId
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

// ✅ 用 orderConnection 注册模型
module.exports = orderConnection.model('Order', orderSchema);
