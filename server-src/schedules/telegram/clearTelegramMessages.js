//telegram/clearTelegramMessages.js- 清理推送数据库超过7天的数据
const { withMongo, safeExecute, setMessagesToDelete, getMessagesToDelete, clearSharedData } = require("./utils");

// Telegram 推送数据库
const TELEGRAM_DB_URI = process.env.TELEGRAM_DB_URI;
if (!TELEGRAM_DB_URI) throw new Error('TELEGRAM_DB_URI is not set');

async function clearTelegramMessages() {
  await safeExecute("清理Telegram推送数据", async () => {
    await withMongo(TELEGRAM_DB_URI, async (conn) => {
      const telegramMessagesCollection = conn.db.collection("telegrammessages");
      
      // 计算7天前的时间
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      console.log(`📅 [Telegram] 清理条件: 创建时间早于 ${sevenDaysAgo.toLocaleString('zh-CN')}`);
      
      // 构建查询条件
      const query = {
        $or: [
          { createdAt: { $lt: sevenDaysAgo } },
          { timestamp: { $lt: sevenDaysAgo.getTime() } }
        ]
      };
      
      // ★ 只查询要删除的记录，不执行删除
      const toDelete = await telegramMessagesCollection.find(query).toArray();
      console.log(`📝 [Telegram] 查询到 ${toDelete.length} 条需要清理的推送数据`);
      
      if (toDelete.length > 0) {
        // ★ 将数据存储到共享区域，供缓存清理任务使用
        setMessagesToDelete(toDelete);
        console.log(`💾 [Telegram] 已标记 ${toDelete.length} 条数据等待缓存清理`);
      } else {
        console.log("📭 [Telegram] [无需清理] 没有超过7天的推送数据需要清理");
        setMessagesToDelete([]); // 清空共享数据
      }
    });
  });
}

// 获取标记的消息数量（用于协调器）
function getMarkedMessagesCount() {
  const messages = getMessagesToDelete();
  return messages.length;
}

// 执行实际的数据库删除（由协调器调用）
async function executeDatabaseDeletion() {
  const messagesToDelete = getMessagesToDelete();
  
  if (messagesToDelete.length === 0) {
    console.log("📭 [Telegram] 没有需要删除的数据库记录");
    return { deletedCount: 0 };
  }
  
  return await withMongo(TELEGRAM_DB_URI, async (conn) => {
    const telegramMessagesCollection = conn.db.collection("telegrammessages");
    
    // 提取要删除的ID
    const idsToDelete = messagesToDelete.map(msg => msg._id);
    
    // 执行数据库删除
    const result = await telegramMessagesCollection.deleteMany({
      _id: { $in: idsToDelete }
    });
    
    console.log(`🔥 [Telegram] [数据库删除完成] 共删除 ${result.deletedCount} 条推送记录`);
    
    // 清空共享数据
    clearSharedData();
    
    return result;
  });
}

module.exports = {
  clearTelegramMessages,
  getMarkedMessagesCount,
  executeDatabaseDeletion
};