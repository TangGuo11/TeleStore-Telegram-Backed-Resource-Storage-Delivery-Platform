//db/models/index.js
module.exports = {
  createUserModel: require('./User'), //用户数据模型                       
  createMessageModel: require('./Message'), //聊天室数据模型                 
  createTelegramMessageModel: require('./TelegramMessage'), //数据保存数据模型
  createYYTelegramMessageModel: require('./yyTelegramMessage'), //作品读取数据模型    
  createUserActivityModel: require('./UserActivity'), //用户活跃数据模型      
  createPurchaseModel: require('./Purchase'), //购买记录模型               
  createProductModel: require('./Product'), //读取数据来验证用户是否登录数据模型                
  createFeedMessageModel: require('./FeedMessage'), //每日更新数据保存数据模型        
  createFeedDigestModel: require('./FeedDigest'), //日更读取固定数据量数据到新集合 数据模型
  createTestTelegramMessageModel: require('./TestTelegramMessage'),   //server.js_数据读取所有数据 数据模型
  createMemberTelegramMessageModel: require('./memberTelegramMessage'), // 会员 VIP 分类数据模型
};
