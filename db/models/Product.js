//读取数据来验证用户是否登录数据模型

// models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  imageUrl: String, // 可选，存放封面图链接
  createdAt: { type: Date, default: Date.now }
}, { collection: 'products' });

module.exports = (conn) => {
  return conn.models.Product || conn.model('Product', productSchema);
};

