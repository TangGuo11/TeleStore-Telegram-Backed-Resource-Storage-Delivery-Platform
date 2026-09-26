//购买记录模型 
// models/Purchase.js
const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  purchasedAt: { type: Date, default: Date.now },
  priceAtTime: { type: Number }
}, { collection: 'purchases' });

module.exports = (conn) => {
  return conn.models.Purchase || conn.model('Purchase', purchaseSchema);
};

