//works/index.js-作品定时任务入口

const cron = require("node-cron");
const { getBeijingCron } = require("./utils");

const clearWorksCache = require("./clearWorksCache");

// 任务配置
const TASKS = [
  { name: "清理作品缓存", time: [5, 0], task: clearWorksCache }
];

function initWorksSchedules() {
  console.log("🎨 [Works] 作品定时任务初始化中...");

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

  console.log(`🎉 [Works] 已成功调度 ${scheduledCount}/${TASKS.length} 个作品定时任务`);
}

// 导出手动执行方法用于测试
module.exports = {
  initWorksSchedules,
  manual: {
    clearWorksCache
  }
};