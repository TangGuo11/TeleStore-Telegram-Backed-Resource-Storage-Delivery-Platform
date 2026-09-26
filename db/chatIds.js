// Central Telegram chat / channel IDs loaded from environment variables
function required(name) {
  return process.env[name] || '';
}

const MEMBER_CATEGORIES = [1, 2, 3, 4, 5].map((id) => ({
  id,
  chatId: required(`MEMBER_CHAT_ID_${id}`),
  collection: `vip_messages_${id}`,
  label: `Category ${id}`,
}));

module.exports = {
  YY_CHAT_ID: required('YY_CHAT_ID'),
  YX_CHAT_ID: required('YX_CHAT_ID'),
  DAILY_UPDATE_CHAT_ID: required('DAILY_UPDATE_CHAT_ID'),
  DAILY_GOSSIP_CHAT_ID: required('DAILY_GOSSIP_CHAT_ID'),
  DAILY_BEST_CHAT_ID: required('DAILY_BEST_CHAT_ID'),
  TELEGRAM_FEED_CHAT_ID: required('TELEGRAM_FEED_CHAT_ID'),
  GAME_FORWARD_CHAT_ID: required('GAME_FORWARD_CHAT_ID'),
  MEMBER_CATEGORIES,
};
