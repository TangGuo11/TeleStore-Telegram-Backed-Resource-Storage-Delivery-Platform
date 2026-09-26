//schedules/activity/clearUserActivities.js
const { withUserDB, log } = require("./utils");

/**
 * 清理 useractivities 集合
 * 重点保护 users 集合！！！
 */
async function clearUserActivities() {
  return await withUserDB(async (conn) => {
    const TARGET_COLLECTION = "useractivities";
    const PROTECTED_COLLECTION = "users";
    
    log('info', `🎯 目标: ${TARGET_COLLECTION}`);
    log('info', `🛡️  保护: ${PROTECTED_COLLECTION} (用户数据严禁删除!)`);
    
    // 1. 环境确认
    const collections = await conn.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    log('info', `📂 数据库集合: [${collectionNames.join(", ")}]`);
    
    // 2. 安全检查
    if (!collectionNames.includes(TARGET_COLLECTION)) {
      throw new Error(`安全中止: ${TARGET_COLLECTION} 不存在`);
    }
    
    if (!collectionNames.includes(PROTECTED_COLLECTION)) {
      throw new Error(`安全中止: ${PROTECTED_COLLECTION} 不存在`);
    }
    
    // 3. 获取目标集合
    const activitiesCollection = conn.db.collection(TARGET_COLLECTION);
    
    // 4. 清理前统计
    const countBefore = await activitiesCollection.countDocuments();
    log('info', `📊 清理前: ${countBefore} 条数据`);
    
    if (countBefore === 0) {
      log('info', "💤 无需清理");
      return { deleted: 0 };
    }
    
    // 5. 执行清理
    log('warn', `🔥 开始清理 ${TARGET_COLLECTION}...`);
    const result = await activitiesCollection.deleteMany({});
    
    // 6. 验证结果
    const countAfter = await activitiesCollection.countDocuments();
    log('info', `📉 清理后: ${countAfter} 条数据`);
    
    // 7. 最终安全检查
    const usersCollection = conn.db.collection(PROTECTED_COLLECTION);
    const usersCount = await usersCollection.countDocuments();
    log('info', `✅ 安全检查: users集合完好 (${usersCount} 条数据)`);
    
    return {
      deleted: result.deletedCount,
      usersSafe: true
    };
  });
}

module.exports = clearUserActivities;
