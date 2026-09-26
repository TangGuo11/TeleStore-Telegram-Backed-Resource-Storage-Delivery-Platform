//daily/clearFeedDigests.js - 清理 feed_digests集合下的所有数据

const { withMongo, safeExecute } = require("./utils");

async function clearFeedDigests() {
  await safeExecute("清理FeedDigests", async () => {
    await withMongo(async (conn) => {
      const collections = await conn.db.listCollections().toArray();
      console.log(`📂 [Mongo] 当前集合: [${collections.map(c => c.name).join(", ")}]`);

      const feedCollection = conn.db.collection("feed_digests");
      
      const countBefore = await feedCollection.countDocuments();
      console.log(`🔎 [清理前] feed_digests 有 ${countBefore} 条数据`);

      if (countBefore > 0) {
        const result = await feedCollection.deleteMany({});
        console.log(`🔥 [清理完成] 共删除 ${result.deletedCount} 条记录`);
        
        const countAfter = await feedCollection.countDocuments();
        console.log(`📉 [清理后] 剩余 ${countAfter} 条数据`);
      } else {
        console.log("📭 [无需清理] feed_digests 为空");
      }
    });
  });
}

module.exports = clearFeedDigests;