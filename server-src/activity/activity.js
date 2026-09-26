//activity.js 心跳检测 / 用户活跃接口
const express = require('express');
const multer = require('multer');
const router = express.Router();
const path = require('path');
const dbManager = require('../../db/DBManager');
const { v4: uuidv4 } = require('uuid');

let UserActivity, User;

// 共享 activityTracker 的 activeUsers Map
let activeUsers;
try {
  const activityTracker = require('./activityTracker');
  activeUsers = activityTracker.activeUsers || activityTracker.getActiveUsersMap?.() || new Map();
} catch (err) {
  console.warn('无法导入 activityTracker 的 activeUsers，创建新的 Map');
  activeUsers = new Map();
}

const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30分钟无活动视为离线

// 配置 multer 用于解析 multipart/form-data
const upload = multer();

async function initModels() {
  if (!UserActivity) UserActivity = await dbManager.getModel('UserActivity');
  if (!User) User = await dbManager.getModel('User');
}

/* -----------------------------------------------------------
 * 💓 心跳接口（统一管理活跃状态）
 * --------------------------------------------------------- */
router.post('/ping', upload.none(), async (req, res) => {
  try {
    await initModels();

    let currentPath, ts, isPageUnload;
    
    if (req.is('application/json')) {
      // JSON 格式 - 来自正常心跳
      if (!req.body || typeof req.body !== 'object') {
        console.log('❌ activity ping: Invalid JSON body');
        return res.status(400).json({ ok: false, error: 'Invalid request body' });
      }
      currentPath = req.body.path;
      ts = req.body.ts;
      isPageUnload = req.body.isPageUnload || false;
    } else if (req.is('application/x-www-form-urlencoded') || req.is('multipart/form-data')) {
      // FormData 格式 - 来自 sendBeacon (页面卸载)
      currentPath = req.body?.path;
      ts = req.body?.ts;
      isPageUnload = true;
    } else {
      console.log('❌ activity ping: Unsupported content type', req.headers['content-type']);
      currentPath = req.body?.path || '/';
      ts = req.body?.ts || Date.now();
      isPageUnload = false;
    }

    const safePath = String(currentPath || '/');
    const safeTimestamp = Number(ts) || Date.now();

    const user = req.user || req.session?.user;
    let userId = user?._id?.toString() || req.session?.userId || null;
    let username = user?.username || 'Guest';

    if (userId === 'guest') {
      userId = null;
      username = 'Guest';
    }

    let visitorId = req.cookies?.visitorId;
    if (!visitorId) {
      visitorId = uuidv4();
    }

    const key = userId || visitorId;
    const now = new Date(safeTimestamp);

    if (isPageUnload) {
      // 页面卸载，只更新最后活跃时间
      const cache = activeUsers.get(key);
      if (cache) {
        cache.lastSeenAt = now;
        cache.lastPath = safePath;
        
        await UserActivity.findByIdAndUpdate(cache.activityId, {
          lastSeenAt: now,
          $set: { 
            'pageStats.lastPath': safePath,
            lastActive: now 
          }
        });

        if (userId) {
          await User.findByIdAndUpdate(userId, { 
            lastSeenAt: now
          });
        }
      } else {
        // 首次访问就关闭页面，创建快速退出记录
        const newActivity = new UserActivity({
          userId: userId || undefined,
          visitorId,
          username,
          loginAt: now,
          lastSeenAt: now,
          lastActive: now,
          pageStats: { 
            lastPath: safePath 
          },
          meta: {
            ip: req.ip,
            ua: req.headers['user-agent'],
          },
          pingCount: 0,
          isQuickExit: true
        });

        await newActivity.save();
        
        if (userId) {
          await User.findByIdAndUpdate(userId, {
            lastSeenAt: now
          });
        }
      }
      
      return res.json({ ok: true, type: 'unload' });
    }

    // 正常的活跃状态更新
    const cache = activeUsers.get(key);
    
    if (cache && now - cache.lastSeenAt <= INACTIVE_TIMEOUT) {
      cache.lastSeenAt = now;
      cache.lastPath = safePath;
      
      await UserActivity.findByIdAndUpdate(cache.activityId, {
        lastSeenAt: now,
        $set: { 
          'pageStats.lastPath': safePath,
          lastActive: now 
        },
        $inc: { pingCount: 1 }
      });

      if (userId) {
        await User.findByIdAndUpdate(userId, { 
          lastSeenAt: now,
          isOnline: true
        });
      }
    } else {
      const newActivity = new UserActivity({
        userId: userId || undefined,
        visitorId,
        username,
        loginAt: now,
        lastSeenAt: now,
        lastActive: now,
        pageStats: { 
          lastPath: safePath 
        },
        meta: {
          ip: req.ip,
          ua: req.headers['user-agent'],
        },
        pingCount: 1
      });

      await newActivity.save();

      if (userId) {
        await User.findByIdAndUpdate(userId, {
          isOnline: true,
          lastLoginAt: now,
          lastSeenAt: now,
          lastActivityId: newActivity._id,
        });
      }

      activeUsers.set(key, {
        activityId: newActivity._id,
        lastSeenAt: now,
        lastPath: safePath,
        username: username
      });
    }

    const response = { ok: true };
    if (!req.cookies?.visitorId && visitorId) {
      response.visitorId = visitorId;
    }

    res.json(response);
  } catch (err) {
    console.error('❌ activity ping error:', err.message);
    res.status(200).json({ ok: false });
  }
});

/* -----------------------------------------------------------
 * 📊 获取用户页面时间统计
 * --------------------------------------------------------- */
router.get('/user-page-stats', async (req, res) => {
  try {
    await initModels();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const userStats = await UserActivity.aggregate([
      { $match: { loginAt: { $gte: todayStart } } },
      { $sort: { lastSeenAt: -1 } },
      {
        $group: {
          _id: {
            $ifNull: ["$userId", { $concat: ["visitor_", "$visitorId"] }],
          },
          latestActivity: { $first: "$$ROOT" },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'latestActivity.userId',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      {
        $project: {
          username: {
            $ifNull: [
              { $arrayElemAt: ["$userInfo.username", 0] },
              "$latestActivity.username",
              "游客",
            ],
          },
          userType: {
            $cond: [
              { $ne: ["$latestActivity.userId", null] },
              "registered",
              "guest",
            ],
          },
          lastSeenAt: "$latestActivity.lastSeenAt",
          pageStats: "$latestActivity.pageStats",
          loginAt: "$latestActivity.loginAt",
          lastActive: "$latestActivity.lastActive",
          pingCount: "$latestActivity.pingCount",
          isQuickExit: "$latestActivity.isQuickExit",
        },
      },
      { $sort: { lastSeenAt: -1 } },
    ]);

    const enhancedStats = userStats.map(stat => {
      const userId = stat._id?.toString();
      const isCurrentlyOnline = Array.from(activeUsers.values()).some(
        cache => {
          const cacheKey = cache.username === stat.username ? stat._id : null;
          return cacheKey && (Date.now() - cache.lastSeenAt.getTime() <= INACTIVE_TIMEOUT);
        }
      );
      
      return {
        ...stat,
        isCurrentlyOnline,
        currentPath: Array.from(activeUsers.values()).find(
          cache => cache.username === stat.username
        )?.lastPath || stat.pageStats?.lastPath
      };
    });

    res.json({ success: true, data: enhancedStats });
  } catch (err) {
    console.error('获取用户页面统计错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* -----------------------------------------------------------
 * 👥 获取在线用户列表
 * --------------------------------------------------------- */
router.get('/online-users', async (req, res) => {
  try {
    await initModels();

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const onlineUsers = await UserActivity.find({
      lastSeenAt: { $gte: fiveMinutesAgo },
      logoutAt: null,
    })
      .populate('userId', 'username email avatar')
      .sort({ lastSeenAt: -1 })
      .limit(100);

    const enhancedUsers = onlineUsers.map(user => {
      const key = user.userId?._id?.toString() || user.visitorId;
      const cache = activeUsers.get(key);
      const isActive = cache && (Date.now() - cache.lastSeenAt.getTime() <= INACTIVE_TIMEOUT);
      
      return {
        ...user.toObject(),
        isCurrentlyActive: isActive,
        currentPath: cache?.lastPath || user.pageStats?.lastPath,
        lastSeenFromCache: cache?.lastSeenAt
      };
    });

    res.json({ 
      success: true, 
      data: enhancedUsers, 
      total: enhancedUsers.length,
      activeInMemory: activeUsers.size
    });
  } catch (err) {
    console.error('获取在线用户错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* -----------------------------------------------------------
 * 📈 今日活跃统计
 * --------------------------------------------------------- */
router.get('/today-stats', async (req, res) => {
  try {
    await initModels();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const totalActive = await UserActivity.countDocuments({
      loginAt: { $gte: todayStart },
    });

    const uniqueUsers = await UserActivity.distinct('userId', {
      loginAt: { $gte: todayStart },
      userId: { $ne: null },
    });

    const uniqueVisitors = await UserActivity.distinct('visitorId', {
      loginAt: { $gte: todayStart },
    });

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const onlineNow = await UserActivity.countDocuments({
      lastSeenAt: { $gte: fiveMinutesAgo },
      logoutAt: null,
    });

    const realTimeActive = Array.from(activeUsers.values()).filter(
      cache => Date.now() - cache.lastSeenAt.getTime() <= INACTIVE_TIMEOUT
    ).length;

    const quickExits = await UserActivity.countDocuments({
      loginAt: { $gte: todayStart },
      isQuickExit: true
    });

    res.json({
      success: true,
      data: {
        totalSessions: totalActive,
        uniqueUsers: uniqueUsers.length,
        uniqueVisitors: uniqueVisitors.length,
        onlineNow,
        realTimeActive,
        activeInMemory: activeUsers.size,
        quickExits
      },
    });
  } catch (err) {
    console.error('获取统计错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* -----------------------------------------------------------
 * 📊 7天趋势
 * --------------------------------------------------------- */
router.get('/weekly-trend', async (req, res) => {
  try {
    await initModels();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trend = await UserActivity.aggregate([
      { $match: { loginAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$loginAt" } },
          dailyActive: { $sum: 1 },
          uniqueUsers: {
            $addToSet: {
              $ifNull: ["$userId", { $concat: ["visitor_", "$visitorId"] }],
            },
          },
          quickExits: {
            $sum: { $cond: ["$isQuickExit", 1, 0] }
          }
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          date: "$_id",
          dailyActive: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
          quickExits: 1,
          _id: 0,
        },
      },
    ]);

    res.json({ success: true, data: trend });
  } catch (err) {
    console.error('获取趋势错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* -----------------------------------------------------------
 * 🎯 获取实时活跃会话
 * --------------------------------------------------------- */
router.get('/active-sessions', (req, res) => {
  try {
    const now = new Date();
    const activeSessions = Array.from(activeUsers.entries())
      .filter(([key, cache]) => now - cache.lastSeenAt <= INACTIVE_TIMEOUT)
      .map(([key, cache]) => ({
        key,
        activityId: cache.activityId,
        lastSeenAt: cache.lastSeenAt,
        lastPath: cache.lastPath,
        username: cache.username,
        isActive: true,
        idleTime: Math.round((now - cache.lastSeenAt) / 1000)
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    res.json({
      success: true,
      data: activeSessions,
      total: activeSessions.length
    });
  } catch (err) {
    console.error('获取活跃会话错误:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* -----------------------------------------------------------
 * 🎯 管理面板页面
 * --------------------------------------------------------- */
router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/activity-dashboard.html'));
});

module.exports = router;