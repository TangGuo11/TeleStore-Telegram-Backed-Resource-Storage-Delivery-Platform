//telegram/coordinator.js - 协调器

const { safeExecute } = require("./utils");

// 修复：使用相对路径导入，避免循环依赖
const clearTelegramMessagesModule = require("./clearTelegramMessages");
const { clearTargetedCache } = require("./clearTelegramCache");

/**
 * 协调执行推送数据清理流程
 * 确保缓存清理和数据库删除的原子性
 */
async function coordinateTelegramCleanup() {
  await safeExecute("协调Telegram数据清理", async () => {
    console.log("🔄 [Telegram] 开始协调数据清理流程...");
    
    // ★ 第1步：查询要删除的数据
    console.log("📝 [Telegram] 步骤1: 查询要删除的推送数据...");
    await clearTelegramMessagesModule.clearTelegramMessages();
    
    const markedCount = clearTelegramMessagesModule.getMarkedMessagesCount();
    console.log(`📊 [Telegram] 已标记 ${markedCount} 条待删除数据`);
    
    if (markedCount === 0) {
      console.log("✅ [Telegram] 没有需要清理的数据，流程结束");
      return;
    }
    
    // ★ 第2步：清理对应的缓存文件
    console.log("🗑️ [Telegram] 步骤2: 清理对应的缓存文件...");
    await clearTargetedCache();
    
    // ★ 第3步：执行数据库删除
    console.log("🔥 [Telegram] 步骤3: 执行数据库删除...");
    const deletionResult = await clearTelegramMessagesModule.executeDatabaseDeletion();
    
    console.log("🎉 [Telegram] 数据清理流程完成!");
    console.log(`📈 总结: 清理了 ${deletionResult.deletedCount} 条数据库记录及其缓存文件`);
  });
}

module.exports = {
  coordinateTelegramCleanup
};
