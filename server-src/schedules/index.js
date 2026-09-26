// schedules/index.js - 所有定时任务入口

const { initDailySchedules } = require("./daily");
const { initTelegramSchedules } = require("./telegram");
const { initWorksSchedules } = require("./works");
const { initTdlightSchedules } = require("./tdlight");
const { initActivitySchedules } = require("./activity"); // 新增

function initSchedules() {
  console.log("📆 正在初始化所有定时任务系统...");
  console.log("=".repeat(50));

  // 初始化日更定时任务 
  initDailySchedules(); 

  console.log("-".repeat(30));

  // 初始化聊天室定时任务
  initTelegramSchedules();

  console.log("-".repeat(30));

  // 初始化作品定时任务
  initWorksSchedules();

  console.log("-".repeat(30));

  // 初始化TDLight缓存任务
  initTdlightSchedules();

  console.log("-".repeat(30));

  // 初始化活动数据任务
  initActivitySchedules();

  console.log("=".repeat(50));
  
  console.log("\n🎉 所有定时任务初始化完成（日更任务已暂停）");
  console.log("⏰ 当前服务器时间:", new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
}

// 导出手动测试方法
module.exports = {
  initSchedules,
  daily: require("./daily").manual,
  telegram: require("./telegram").manual,
  works: require("./works").manual,
  tdlight: require("./tdlight").manual,
  activity: require("./activity").manual  // 新增
};