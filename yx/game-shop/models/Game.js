// game-shop/models/Game.js
const { mongoose } = require('../../game-api/db/mongoose');

const GameSchema = new mongoose.Schema({
  gameId: { type: String, unique: true },
  title: String,
  price: Number,
  chatId: String,
  messageId: Number,
  medias: Array
}, {
  timestamps: true,
  collection: 'game_messages'  // 指定集合名
});

module.exports = mongoose.model('Game', GameSchema);
