//telegram/index.js-聊天室定时任务入口
const cron = require("node-cron");
const { getBeijingCron } = require("./utils");

const clearChatHistory = require("./clearChatHistory");
const { coordinateTelegramCleanup } = require("./coordinator");
const { clearOrphanedCache } = require("./clearTelegramCache"); // 改为清理孤立缓存

// 任务配置
const TASKS = [
  { name: "清理聊天历史数据", time: [5, 0], task: clearChatHistory },
  { name: "协调清理推送数据及缓存", time: [5, 0], task: coordinateTelegramCleanup },
  { name: "清理孤立缓存文件", time: [5, 5], task: clearOrphanedCache } // 使用新的孤立缓存清理
];

function initTelegramSchedules() {
  console.log("💬 [Telegram] 聊天室定时任务初始化中...");

  let scheduledCount = 0;

  TASKS.forEach(({ name, time, task }) => {
    const [hour, minute] = time;
    const cronExpression = getBeijingCron(hour, minute);
    
    try {
      // 注册定时任务
      cron.schedule(cronExpression, async () => {
        try {
          await task();
        } catch (error) {
          console.error(`❌ [${name}] 任务执行失败:`, error);
        }
      }, {
        timezone: "Asia/Shanghai"
      });
      
      scheduledCount++;
      console.log(`⏰ ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} → ${name} 已启用`);
    } catch (error) {
      console.error(`❌ 调度任务失败 ${name}:`, error);
    }
  });

  console.log(`🎉 [Telegram] 已成功调度 ${scheduledCount}/${TASKS.length} 个聊天室定时任务`);
}

// 导出手动执行方法用于测试
module.exports = {
  initTelegramSchedules,
  manual: {
    clearChatHistory,
    coordinateTelegramCleanup,
    clearOrphanedCache
  }
};