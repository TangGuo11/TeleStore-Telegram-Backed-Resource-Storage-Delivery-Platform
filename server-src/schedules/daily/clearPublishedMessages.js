//daily/clearPublishedMessages.js-清理 telegrammessages.published=true

const { withMongo, safeExecute } = require("./utils");

async function clearPublishedMessages() {
  await safeExecute("清理已发布消息", async () => {
    await withMongo(async (conn) => {
      const collection = conn.db.collection("telegrammessages");
      
      // 检查集合是否存在
      const collections = await conn.db.listCollections({ name: "telegrammessages" }).toArray();
      if (collections.length === 0) {
        console.log("📭 telegrammessages 集合不存在，跳过清理");
        return;
      }

      const before = await collection.countDocuments({ published: true });
      console.log(`🔎 [清理前] 有 ${before} 条 published=true 的消息`);

      if (before > 0) {
        const result = await collection.deleteMany({ published: true });
        console.log(`🔥 [清理完成] 删除 ${result.deletedCount} 条已发布消息`);
        
        const after = await collection.countDocuments({ published: true });
        console.log(`📉 [清理后] 剩余 ${after} 条 published=true 的消息`);
      } else {
        console.log("📭 [无需清理] 没有已发布的消息需要清理");
      }
    });
  });
}

module.exports = clearPublishedMessages;