//schedules/activity/index.js - 用户活跃数据定时任务
const cron = require("node-cron");
const { getMondayCron, safeExecute, log } = require("./utils");

const clearUserActivities = require("./clearUserActivities");

function initActivitySchedules() {
  console.log("📅 初始化活动数据定时任务...");
  
  const cronExpression = getMondayCron();
  
  try {
    // 每周一早上5:20执行
    cron.schedule(cronExpression, async () => {
      await safeExecute("清理UserActivities", clearUserActivities);
    }, {
      timezone: "Asia/Shanghai"
    });
    
    console.log(`⏰ 每周一 05:20 → 清理UserActivities`);
    console.log(`🔧 Cron: ${cronExpression}`);
    console.log("✅ 活动数据任务初始化完成");
  } catch (error) {
    console.error("❌ 活动数据任务调度失败:", error);
  }
}

// 导出手动执行方法
module.exports = {
  initActivitySchedules,
  manual: {
    clearUserActivities: () => safeExecute("手动清理UserActivities", clearUserActivities)
  }
};
