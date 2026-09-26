//telegram/clearChatHistory.js-清理聊天历史推送信息超过7天的数据

const { withMongo, safeExecute } = require("./utils");

// 聊天室历史信息数据库
const CHAT_DB_URI = process.env.CHAT_DB_URI;
if (!CHAT_DB_URI) throw new Error('CHAT_DB_URI is not set');

async function clearChatHistory() {
  await safeExecute("清理聊天历史数据", async () => {
    await withMongo(CHAT_DB_URI, async (conn) => {
      const messagesCollection = conn.db.collection("messages");
      
      // 计算7天前的时间戳
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoTimestamp = sevenDaysAgo.getTime();
      
      console.log(`📅 [Telegram] 清理条件: 仅Telegram推送历史 且时间早于 ${sevenDaysAgo.toLocaleString('zh-CN')}`);
      
      // 只匹配 Telegram 推送到聊天室的历史（避免误删普通用户聊天记录）
      const telegramSourceQuery = {
        $or: [
          { telegramMessageIds: { $exists: true, $ne: [] } }, // 当前主链路
          { telegramMessageId: { $exists: true, $ne: null } }, // 历史兼容字段
          { groupId: { $exists: true, $ne: null } } // 兜底：Telegram推送组ID
        ]
      };

      // 兼容历史数据：时间字段可能是 Date 或 Number
      const timeQuery = {
        $or: [
          { timestamp: { $type: "date", $lt: sevenDaysAgo } },
          { timestamp: { $type: "number", $lt: sevenDaysAgoTimestamp } },
          { createdAt: { $lt: sevenDaysAgo } },
          { historySortKey: { $lt: sevenDaysAgoTimestamp } }
        ]
      };

      const query = {
        $and: [telegramSourceQuery, timeQuery]
      };
      
      // 统计清理前数据
      const countBefore = await messagesCollection.countDocuments(query);
      console.log(`🔎 [Telegram] [清理前] 符合条件的聊天历史数据: ${countBefore} 条`);
      
      if (countBefore > 0) {
        const result = await messagesCollection.deleteMany(query);
        console.log(`🔥 [Telegram] [清理完成] 共删除 ${result.deletedCount} 条聊天历史记录`);
        
        // 验证清理结果
        const countAfter = await messagesCollection.countDocuments(query);
        console.log(`📉 [Telegram] [清理后] 剩余 ${countAfter} 条符合条件的记录`);
        
        // 额外统计：当前历史消息总量（便于观察清理效果）
        const totalMessages = await messagesCollection.estimatedDocumentCount();
        console.log(`📊 [Telegram] 当前聊天室历史消息总量: ${totalMessages} 条`);
      } else {
        console.log("📭 [Telegram] [无需清理] 没有符合条件的聊天历史数据需要清理");
      }
    });
  });
}

module.exports = clearChatHistory;