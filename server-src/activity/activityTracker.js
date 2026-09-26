//activityTracker.js 行为追踪中间件（不再包含 ping 路由）
const { v4: uuidv4 } = require('uuid');
const dbManager = require('../../db/DBManager');

let User, UserActivity;
const activeUsers = new Map();
const INACTIVE_TIMEOUT = 30 * 60 * 1000;

async function initModels() {
  if (!User) User = await dbManager.getModel('User');
  if (!UserActivity) UserActivity = await dbManager.getModel('UserActivity');
}

module.exports = function activityTracker() {
  return async function (req, res, next) {
    try {
      await initModels();

      const user = req.user;
      let userId = user?._id?.toString() || null;
      let username = user?.username || 'Guest';

      if (userId === 'guest') {
        userId = null;
        username = 'Guest';
      }

      let visitorId = req.cookies.visitorId;
      if (!visitorId) {
        visitorId = uuidv4();
        res.cookie('visitorId', visitorId, {
          httpOnly: false,
          maxAge: 30 * 24 * 3600 * 1000,
        });
      }

      const now = new Date();
      const key = userId || visitorId;
      const cache = activeUsers.get(key);

      if (!cache || now - cache.lastSeenAt > INACTIVE_TIMEOUT) {
        // 新会话，创建新记录
        const newActivity = new UserActivity({
          userId: userId || undefined,
          visitorId,
          username,
          loginAt: now,
          lastSeenAt: now,
          pageStats: { lastPath: req.url },
          meta: {
            ip: req.ip,
            ua: req.headers['user-agent'],
          },
        });

        await newActivity.save();

        if (userId)
          await User.findByIdAndUpdate(userId, {
            isOnline: true,
            lastLoginAt: now,
            lastSeenAt: now,
            lastActivityId: newActivity._id,
          });

        activeUsers.set(key, {
          activityId: newActivity._id,
          lastSeenAt: now,
          lastPath: req.url,
        });

        console.log(`[+] 上线：${username} (${key})`);
      } else {
        // 更新已有会话
        await UserActivity.findByIdAndUpdate(cache.activityId, {
          lastSeenAt: now,
        });

        if (userId)
          await User.findByIdAndUpdate(userId, { lastSeenAt: now });

        cache.lastSeenAt = now;
      }

      next();
    } catch (err) {
      console.error('activityTracker error:', err);
      next();
    }
  };
};

/* ------------------------------
 * ⏰ 定时下线检测（保留）
 * ------------------------------ */
setInterval(async () => {
  try {
    await initModels();
    const now = new Date();

    for (const [key, cache] of activeUsers.entries()) {
      if (now - cache.lastSeenAt > INACTIVE_TIMEOUT) {
        try {
          const activity = await UserActivity.findById(cache.activityId);
          if (activity && !activity.logoutAt) {
            const logoutAt = new Date(activity.lastSeenAt.getTime() + 1000);
            const durationSec = Math.round(
              (logoutAt - activity.loginAt) / 1000
            );

            await UserActivity.findByIdAndUpdate(activity._id, {
              logoutAt,
              durationSec,
            });

            if (activity.userId)
              await User.findByIdAndUpdate(activity.userId, {
                isOnline: false,
              });

            console.log(`[-] 下线：${activity.username} (${key})`);
          }
        } catch (e) {
          console.error('auto-logout error:', e);
        }

        activeUsers.delete(key);
      }
    }
  } catch (err) {
    console.error('定时检测出错:', err);
  }
}, 5 * 60 * 1000);
