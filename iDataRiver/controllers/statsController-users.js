const User = require('../models/User');
const dayjs = require('dayjs');

exports.getUserStats = async (req, res) => {
  try {
    const now = dayjs();

    // 今日和昨日的起始时间
    const todayStart = now.startOf('day').toDate();
    const yesterdayStart = now.subtract(1, 'day').startOf('day').toDate();
    const yesterdayEnd = todayStart;

    // 本周和上周的起始时间
    const weekStart = now.startOf('week').toDate();
    const lastWeekStart = now.subtract(1, 'week').startOf('week').toDate();
    const lastWeekEnd = weekStart;

    // 今日用户数
    const todayCount = await User.countDocuments({ createdAt: { $gte: todayStart } });
    // 昨日用户数
    const yesterdayCount = await User.countDocuments({ createdAt: { $gte: yesterdayStart, $lt: yesterdayEnd } });

    // 本周用户数
    const weekCount = await User.countDocuments({ createdAt: { $gte: weekStart } });
    // 上周用户数
    const lastWeekCount = await User.countDocuments({ createdAt: { $gte: lastWeekStart, $lt: lastWeekEnd } });

    // 总用户数
    const totalCount = await User.countDocuments();

    // 计算环比百分比函数，防止除以0
    function calcChange(current, previous) {
      if (previous === 0) return current === 0 ? 0 : 100;
      return ((current - previous) / previous * 100).toFixed(2);
    }

    res.json({
      today: {
        count: todayCount,
        change: parseFloat(calcChange(todayCount, yesterdayCount)),
      },
      week: {
        count: weekCount,
        change: parseFloat(calcChange(weekCount, lastWeekCount)),
      },
      total: {
        count: totalCount
      }
    });
  } catch (err) {
    console.error('获取用户统计出错:', err);
    res.status(500).json({ error: '服务器错误' });
  }
};




