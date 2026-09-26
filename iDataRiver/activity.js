// activity.js - 直接读取数据库的活跃度统计
const express = require('express');
const router = express.Router();
const UserActivity = require('./models/UserActivity');
const User = require('./models/User');

// 📊 获取详细的用户页面时间统计
router.get('/user-page-stats', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const userStats = await UserActivity.aggregate([
      {
        $match: {
          loginAt: { $gte: todayStart }
        }
      },
      {
        $sort: { lastSeenAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $ne: ["$userId", null] },
              "$userId",
              "$visitorId"
            ]
          },
          latestActivity: { $first: "$$ROOT" }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'latestActivity.userId',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      {
        $project: {
          username: {
            $cond: [
              { $gt: [{ $size: "$userInfo" }, 0] },
              { $arrayElemAt: ["$userInfo.username", 0] },
              "游客"
            ]
          },
          userType: {
            $cond: [
              { $ne: ["$latestActivity.userId", null] },
              "registered",
              "guest"
            ]
          },
          lastSeenAt: "$latestActivity.lastSeenAt",
          pageStats: "$latestActivity.pageStats",
          loginAt: "$latestActivity.loginAt"
        }
      },
      {
        $sort: { lastSeenAt: -1 }
      }
    ]);

    console.log(`📊 用户页面统计查询完成，共 ${userStats.length} 条记录`);
    res.json({ 
      success: true, 
      data: userStats 
    });
  } catch (err) {
    console.error('获取用户页面统计错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 👥 获取在线用户列表
router.get('/online-users', async (req, res) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const onlineUsers = await UserActivity.find({
      lastSeenAt: { $gte: fiveMinutesAgo },
      logoutAt: null
    })
    .populate('userId', 'username email avatar')
    .sort({ lastSeenAt: -1 })
    .limit(100);

    console.log(`👥 在线用户查询完成，共 ${onlineUsers.length} 人在线`);
    res.json({ 
      success: true, 
      data: onlineUsers,
      total: onlineUsers.length
    });
  } catch (err) {
    console.error('获取在线用户错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📈 获取今日活跃统计
router.get('/today-stats', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const totalActive = await UserActivity.countDocuments({
      loginAt: { $gte: todayStart }
    });

    const uniqueUsers = await UserActivity.distinct('userId', {
      loginAt: { $gte: todayStart },
      userId: { $ne: null }
    });

    const uniqueVisitors = await UserActivity.distinct('visitorId', {
      loginAt: { $gte: todayStart }
    });

    // 获取当前在线用户数
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineNow = await UserActivity.countDocuments({
      lastSeenAt: { $gte: fiveMinutesAgo },
      logoutAt: null
    });

    console.log(`📈 今日统计: ${totalActive} 会话, ${onlineNow} 在线`);
    res.json({
      success: true,
      data: {
        totalSessions: totalActive,
        uniqueUsers: uniqueUsers.length,
        uniqueVisitors: uniqueVisitors.length,
        onlineNow: onlineNow
      }
    });
  } catch (err) {
    console.error('获取统计错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📊 获取7天趋势
router.get('/weekly-trend', async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const trend = await UserActivity.aggregate([
      {
        $match: {
          loginAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$loginAt"
            }
          },
          dailyActive: { $sum: 1 },
          uniqueUsers: { 
            $addToSet: {
              $cond: [
                { $ne: ["$userId", null] },
                "$userId",
                "$visitorId"
              ]
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      },
      {
        $project: {
          date: "$_id",
          dailyActive: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
          _id: 0
        }
      }
    ]);

    console.log(`📅 7天趋势数据查询完成，共 ${trend.length} 天数据`);
    res.json({ success: true, data: trend });
  } catch (err) {
    console.error('获取趋势错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;