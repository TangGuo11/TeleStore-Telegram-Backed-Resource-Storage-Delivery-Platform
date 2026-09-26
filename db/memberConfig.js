// VIP category config: chatId -> collection name
const { MEMBER_CATEGORIES } = require('./chatIds');

const MEMBER_CHAT_IDS = MEMBER_CATEGORIES.map((c) => c.chatId).filter(Boolean);

const CHAT_TO_CATEGORY = Object.fromEntries(
  MEMBER_CATEGORIES.filter((c) => c.chatId).map((c) => [c.chatId, c.id])
);

const CHAT_TO_COLLECTION = Object.fromEntries(
  MEMBER_CATEGORIES.filter((c) => c.chatId).map((c) => [c.chatId, c.collection])
);

function getCategoryByChatId(chatId) {
  return CHAT_TO_CATEGORY[String(chatId)] || null;
}

function getCategoryConfig(categoryId) {
  return MEMBER_CATEGORIES.find((c) => c.id === Number(categoryId)) || null;
}

module.exports = {
  MEMBER_CATEGORIES,
  MEMBER_CHAT_IDS,
  CHAT_TO_CATEGORY,
  CHAT_TO_COLLECTION,
  getCategoryByChatId,
  getCategoryConfig,
};
