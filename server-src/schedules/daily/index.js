//daily/index.js-日更定时任务入口

const cron = require("node-cron");
const { getBeijingCron, safeExecute } = require("./utils");

const clearFeedDigests = require("./clearFeedDigests");
const clearPublishedMessages = require("./clearPublishedMessages");
const clearDailyCache = require("./clearDailyCache");

// 任务配置
const TASKS = [
  { name: "清理FeedDigests", time: [5, 0], task: clearFeedDigests },
  { name: "清理已发布消息", time: [5, 5], task: clearPublishedMessages },
  { name: "清理Daily缓存", time: [5, 10], task: clearDailyCache }
];

function initDailySchedules() {
  console.log("📅 [Daily] 日更定时任务初始化中...");

  let scheduledCount = 0;

  TASKS.forEach(({ name, time, task }) => {
    const [hour, minute] = time;
    const cronExpression = getBeijingCron(hour, minute);
    
    try {
      // 注册定时任务 - 添加额外的错误捕获
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

  console.log(`🎉 [Daily] 已成功调度 ${scheduledCount}/${TASKS.length} 个日更定时任务`);
}

// 导出手动执行方法用于测试
module.exports = {
  initDailySchedules,
  manual: {
    clearFeedDigests,
    clearPublishedMessages, 
    clearDailyCache
  }
};