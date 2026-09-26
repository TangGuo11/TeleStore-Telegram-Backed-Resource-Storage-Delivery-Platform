const dbManager = require('../../db/DBManager');
const logger = require('../../utils/logger');
const {
  DAILY_UPDATE_CHAT_ID,
  DAILY_GOSSIP_CHAT_ID,
  DAILY_BEST_CHAT_ID,
} = require('../../db/chatIds');

// Group configuration
const GROUPS = {
  dailyUpdate: DAILY_UPDATE_CHAT_ID,
  dailyGossip: DAILY_GOSSIP_CHAT_ID,
  dailyBest: DAILY_BEST_CHAT_ID
};

// 自动识别媒体类型
const detectType = (item) => {
  if (item.video?.file_id) return 'video';
  if (item.photo?.file_id) return 'photo';
  if (item.document?.file_id) return 'document';
  return null;
};

// 获取媒体地址
const getMediaUrl = (item) => {
  const type = detectType(item);
  if (!type) return null;

  const media = item[type];
  return media?.file_id ? `/file/${media.file_id}` : null;
};

// 获取缩略图地址（视频、文档）
const getThumbnailUrl = (item) => {
  const type = detectType(item);
  if (!type) return null;

  const media = item[type];

  // photo 可能是数组
  if (Array.isArray(media)) {
    const first = media[0];
    if (first?.file_id) return `/file/${first.file_id}`;
    if (first?.thumb_file_id) return `/file/${first.thumb_file_id}`;
    return null;
  }

  // 🎥 如果是视频或文档，优先 thumb_file_id
  if (type === 'video' || type === 'document') {
    if (media?.thumb_file_id) {
      return `/file/${media.thumb_file_id}`;
    }
    // 有些视频没 thumb_file_id，用 file_id 兜底
    if (media?.file_id) {
      return `/file/${media.file_id}`;
    }
  }

  // 📸 照片类
  if (type === 'photo') {
    if (media?.file_id) return `/file/${media.file_id}`;
    if (media?.thumb_file_id) return `/file/${media.thumb_file_id}`;
  }

  return null;
};

function resolveFeedType(chatId) {
  const id = String(chatId || '');
  if (id && id === GROUPS.dailyUpdate) return 'dailyUpdate';
  if (id && id === GROUPS.dailyGossip) return 'dailyGossip';
  if (id && id === GROUPS.dailyBest) return 'dailyBest';
  return null;
}

function withFeedType(item) {
  if (!item) return item;
  const obj = typeof item.toObject === 'function' ? item.toObject() : { ...item };
  return {
    ...obj,
    feedType: obj.feedType || resolveFeedType(obj.chatId),
  };
}
  const type = detectType(item);
  if (!type) {
    console.warn('未识别类型', item._id, item);
    return null;
  }

  const caption = item[type]?.caption || '无标题';
  const mediaUrl = getMediaUrl(item);
  const thumbnail = getThumbnailUrl(item);

  // 构建结构化媒体数组
  const medias = mediaUrl ? [{ type, url: mediaUrl }] : [];

  return {
    title: caption,
    medias,
    chatId: item.chatId,
    feedType: resolveFeedType(item.chatId),
    ...(thumbnail ? { thumbnail } : {}),
    // 保留原始消息ID以便追踪
    originalMessageId: item._id,
    // 添加时间戳
    timestamp: item.timestamp
  };
};

// 辅助函数：提取消息里的 media_group_id，兼容顶层和嵌套字段
const getMediaGroupId = (doc) =>
  doc.media_group_id ||
  doc.photo?.media_group_id ||
  doc.video?.media_group_id ||
  doc.document?.media_group_id ||
  null;

// 辅助函数：获取消息标题，支持取第一个 media 的 caption 或默认
const getTitle = (doc) => {
  const type = detectType(doc);
  if (!type) return '无标题';

  // 有些字段是数组（例如 photo 是数组），有些是对象，这里统一处理
  const media = doc[type];
  if (Array.isArray(media)) {
    return media[0]?.caption || '无标题';
  }
  return media?.caption || '无标题';
};

/*------------ 1. 每日更新（单条内容）----------*/
const fetchDailyUpdate = async () => {
  try {
    const FeedMessage = await dbManager.getModel('FeedMessage');
    const list = await FeedMessage.find({ chatId: GROUPS.dailyUpdate, published: false })
      .sort({ timestamp: 1 })
      .limit(10);

    const ids = list.map(item => item._id);
    if (ids.length > 0) {
      await FeedMessage.updateMany({ _id: { $in: ids } }, { $set: { published: true } });
    }

    logger.db(`[dailyUpdate] 获取 ${list.length} 条项目`);
    return list.map(normalizeItem).filter(Boolean);
  } catch (error) {
    logger.error('fetchDailyUpdate 错误:', error);
    return [];
  }
};

/*------------ 2. 每日吃瓜（多媒体组，含详细日志与缩略图跟踪 + 独立缩略图修复）------------*/
const fetchGroupedFeeds = async (chatId, limit = 10) => {
  try {
    console.log(`\n🍉 [fetchGroupedFeeds] 开始处理 chatId=${chatId} limit=${limit}`);

    const FeedMessage = await dbManager.getModel('FeedMessage');

    // 🧩 Step 1. 聚合未发布的 media group id（兼容嵌套字段）
    const groups = await FeedMessage.aggregate([
      {
        $match: {
          chatId,
          published: false,
          $or: [
            { media_group_id: { $ne: null } },
            { 'photo.media_group_id': { $ne: null } },
            { 'video.media_group_id': { $ne: null } },
            { 'document.media_group_id': { $ne: null } }
          ]
        }
      },
      {
        $addFields: {
          media_group_id: {
            $ifNull: [
              '$media_group_id',
              {
                $ifNull: [
                  '$photo.media_group_id',
                  {
                    $ifNull: [
                      '$video.media_group_id',
                      '$document.media_group_id'
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      {
        $group: {
          _id: '$media_group_id',
          earliest: { $min: '$timestamp' }
        }
      },
      { $sort: { earliest: 1 } },
      { $limit: limit }
    ]);

    const groupIds = groups.map(g => g._id);
    console.log(`🧩 找到 ${groupIds.length} 个媒体组 ID:`, groupIds);

    // 🖼️ Step 2. 查找未发布的单条多媒体（没有 media_group_id）
    const soloMedias = await FeedMessage.find({
      chatId,
      published: false,
      media_group_id: null,
      'photo.media_group_id': null,
      'video.media_group_id': null,
      'document.media_group_id': null,
      $or: [
        { video: { $ne: null } },
        { photo: { $ne: null } },
        { document: { $ne: null } }
      ]
    }).sort({ timestamp: 1 }).limit(limit);

    console.log(`🖼️ 找到 ${soloMedias.length} 条独立多媒体消息`);

    const soloIds = soloMedias.map(doc => doc._id);
    let mediaDocs = [];

    // 🎬 Step 3. 查询属于这些 groupId 的消息
    if (groupIds.length > 0) {
      const groupDocs = await FeedMessage.find({
        chatId,
        published: false,
        $or: [
          { media_group_id: { $in: groupIds } },
          { 'photo.media_group_id': { $in: groupIds } },
          { 'video.media_group_id': { $in: groupIds } },
          { 'document.media_group_id': { $in: groupIds } }
        ]
      }).sort({ timestamp: 1 });

      console.log(`🎬 找到 ${groupDocs.length} 条属于媒体组的消息`);

      mediaDocs.push(...groupDocs);

      const groupDocIds = groupDocs.map(doc => doc._id);
      if (groupDocIds.length > 0) {
        await FeedMessage.updateMany(
          { _id: { $in: groupDocIds } },
          { $set: { published: true } }
        );
        console.log(`✅ 已标记 ${groupDocIds.length} 条组内消息为已发布`);
      }
    }

    // 🧱 Step 4. 合并单条多媒体
    if (soloMedias.length > 0) {
      mediaDocs.push(...soloMedias);
      await FeedMessage.updateMany(
        { _id: { $in: soloIds } },
        { $set: { published: true } }
      );
      console.log(`✅ 已标记 ${soloIds.length} 条独立消息为已发布`);
    }

    console.log(`📊 [dailyGossip] 共计 ${mediaDocs.length} 条媒体消息等待分组`);

    const grouped = {};

    // 🧠 Step 5. 每个 media_group_id 独立分组（增强版缩略图逻辑）
    for (const doc of mediaDocs) {
      const gid = getMediaGroupId(doc) || doc._id.toString();
      const type = detectType(doc);
      const url = getMediaUrl(doc);
      const caption = doc.caption || doc.video?.caption || doc.photo?.caption || '';

      // ✅ 新增多级缩略图检测逻辑（并加详细日志）
      let thumbnail =
        getThumbnailUrl(doc) ||
        (doc.video?.thumb_file_id ? `/file/${doc.video.thumb_file_id}` : null) ||
        (doc.video?.thumbnail?.file_id ? `/file/${doc.video.thumbnail.file_id}` : null) ||
        (doc.photo?.[0]?.file_id ? `/file/${doc.photo[0].file_id}` : null) ||
        null;

      console.log('🎯 [缩略图检测]', {
        gid,
        _id: doc._id,
        type,
        caption,
        url,
        from_video_thumb: doc.video?.thumb_file_id,
        from_video_thumbnail: doc.video?.thumbnail?.file_id,
        from_photo: doc.photo?.[0]?.file_id,
        final_thumbnail: thumbnail,
        media_group_id: doc.media_group_id || doc.video?.media_group_id || doc.photo?.media_group_id
      });

      if (!type) continue;

      if (!grouped[gid]) {
        const title = getTitle(doc);
        console.log(`🆕 创建新分组 ${gid}:`, { title });
        grouped[gid] = {
          title,
          medias: [],
          chatId,
          groupId: gid,
          originalMessageIds: [],
          timestamp: doc.timestamp,
          thumbnail: null
        };
      }

      if (url) {
        grouped[gid].medias.push({
          type,
          url,
          caption,
          ...(thumbnail ? { thumbnail } : {})
        });
        grouped[gid].originalMessageIds.push(doc._id);

        if (doc.timestamp < grouped[gid].timestamp) {
          grouped[gid].timestamp = doc.timestamp;
        }
      }
    }

    // 🖼️ Step 6. 给组设置默认缩略图（第一个有 thumbnail 的媒体）
    for (const gid in grouped) {
      const g = grouped[gid];
      const firstThumb = g.medias.find(m => m.thumbnail);
      if (firstThumb) {
        g.thumbnail = firstThumb.thumbnail;
        console.log(`🖼️ 组 ${gid} 使用第一个缩略图作为组缩略图: ${g.thumbnail}`);
      } else {
        console.log(`⚠️ 组 ${gid} 没有任何缩略图`);
      }
    }

    // 🧩 Step 6.5. 确保每个媒体都有独立缩略图（新增）
    for (const gid in grouped) {
      const g = grouped[gid];
      g.medias = g.medias.map((m, i) => {
        if (!m.thumbnail) {
          const docId = g.originalMessageIds[i];
          const doc = mediaDocs.find(d => d._id.equals(docId));
          const thumb =
            getThumbnailUrl(doc) ||
            (doc.video?.thumb_file_id ? `/file/${doc.video.thumb_file_id}` : null) ||
            (doc.video?.thumbnail?.file_id ? `/file/${doc.video.thumbnail.file_id}` : null) ||
            (doc.photo?.[0]?.file_id ? `/file/${doc.photo[0].file_id}` : null) ||
            null;
          console.log(`🔄 [补充缩略图] 分组 ${gid} 第 ${i + 1} 个媒体缺缩略图，补上:`, thumb);
          return { ...m, thumbnail: thumb };
        }
        return m;
      });
    }

    // 📦 Step 7. 打印最终结果汇总
    console.log(
      '📦 分组结果摘要:',
      Object.values(grouped).map(g => ({
        groupId: g.groupId,
        title: g.title,
        mediaCount: g.medias.length,
        hasGroupThumb: !!g.thumbnail,
        groupThumb: g.thumbnail,
        mediaThumbs: g.medias.map(m => m.thumbnail)
      }))
    );

    console.log(`🍉 [fetchGroupedFeeds] 处理完成，共 ${Object.keys(grouped).length} 个分组\n`);
    return Object.values(grouped);
  } catch (error) {
    logger.error('fetchGroupedFeeds 错误:', error);
    return [];
  }
};

// 每日吃瓜调用
const fetchDailyGossip = () => fetchGroupedFeeds(GROUPS.dailyGossip, 10);

/*------------- 3. 每日优选（单条内容）-----------*/
const fetchDailyBest = async () => {
  try {
    const FeedMessage = await dbManager.getModel('FeedMessage');
    const list = await FeedMessage.find({ chatId: GROUPS.dailyBest, published: false })
      .sort({ timestamp: 1 })
      .limit(5);

    const ids = list.map(item => item._id);
    if (ids.length > 0) {
      await FeedMessage.updateMany({ _id: { $in: ids } }, { $set: { published: true } });
    }

    console.log(`[dailyBest] Fetched ${list.length} items.`);
    return list.map(normalizeItem).filter(Boolean);
  } catch (error) {
    logger.error('fetchDailyBest 错误:', error);
    return [];
  }
};

// 将原始消息列表格式化为作品/会员页面所需结构
const formatGroupedWorkItems = (items) => {
  const groupedItems = {};
  items.forEach(item => {
    const groupId = item.video?.media_group_id || item.photo?.media_group_id || item.document?.media_group_id || item._id.toString();

    if (!groupedItems[groupId]) {
      groupedItems[groupId] = [];
    }
    groupedItems[groupId].push(item);
  });

  return Object.entries(groupedItems).map(([groupId, groupItems]) => {
    const medias = [];
    let thumbnail = null;

    groupItems.forEach(item => {
      if (item.video) {
        medias.push({
          type: 'video',
          url: `/file/${item.video.file_id}`,
          thumbnail: item.video.thumb_file_id ? `/file/${item.video.thumb_file_id}` : null,
          _id: item._id,
          duration: item.video.duration,
          width: item.video.width,
          height: item.video.height
        });

        if (!thumbnail && item.video.thumb_file_id) {
          thumbnail = `/file/${item.video.thumb_file_id}`;
        }
      }

      if (item.photo) {
        medias.push({
          type: 'photo',
          url: `/file/${item.photo.file_id}`,
          _id: item._id,
          width: item.photo.width,
          height: item.photo.height
        });

        if (!thumbnail) {
          thumbnail = `/file/${item.photo.file_id}`;
        }
      }

      if (item.document) {
        medias.push({
          type: 'document',
          url: `/file/${item.document.file_id}`,
          _id: item._id
        });

        if (!thumbnail && item.document.thumb_file_id) {
          thumbnail = `/file/${item.document.thumb_file_id}`;
        }
      }
    });

    const firstItem = groupItems.length > 0 ? groupItems[0] : null;

    let caption = '';
    if (firstItem) {
      for (const item of groupItems) {
        if (item.video?.caption) { caption = item.video.caption; break; }
        if (item.photo?.caption) { caption = item.photo.caption; break; }
        if (item.document?.caption) { caption = item.document.caption; break; }
        if (item.caption) { caption = item.caption; break; }
      }
    }

    const parsedData = parseCaption(caption || '');

    return {
      _id: firstItem?._id || groupId,
      title: parsedData.title || '无标题',
      description: parsedData.description || '',
      price: parsedData.price || 0,
      medias: medias.filter(m => m.url),
      thumbnail,
      chatId: firstItem?.chatId,
      originalMessageIds: groupItems.map(i => i._id),
      groupId: groupId,
      timestamp: firstItem?.timestamp || new Date(),
      createdAt: firstItem?.createdAt || new Date(),
      __v: firstItem?.__v || 0
    };
  });
};

// 作品：处理作品数据请求 - 更新为使用 YYTelegramMessage
const fetchWorkItems = async () => {
  try {
    const YYTelegramMessage = await dbManager.getModel('YYTelegramMessage');
    const items = await YYTelegramMessage.find({}).sort({ timestamp: -1 });

    console.log(`[feedController] 从作品数据库获取到 ${items.length} 条作品数据`);
    return formatGroupedWorkItems(items);
  } catch (error) {
    console.error('Error fetching work items:', error);
    return [];
  }
};

// 会员 VIP 分类内容
const fetchMemberItems = async (category) => {
  try {
    const MemberModel = await dbManager.getMemberModel(category);
    const items = await MemberModel.find({}).sort({ timestamp: -1 });

    console.log(`[feedController] 会员分类${category} 获取到 ${items.length} 条数据`);
    return formatGroupedWorkItems(items);
  } catch (error) {
    console.error(`Error fetching member items (category=${category}):`, error);
    return [];
  }
};

/*-------------- 主接口 - 获取内容数据 ---------------*/
exports.getFeeds = async (req, res) => {
  try {
    // ====================== 1. 处理YY页面请求 ======================
    if (req.headers.from === 'work') {
      console.log('[feedController] 处理作品页面请求');
      const workItems = await fetchWorkItems();
      return res.json(workItems);
    }

    // ====================== 1.5 处理会员 VIP 分类页面请求 ======================
    if (req.headers.from === 'member') {
      const category = parseInt(req.query.category, 10);
      if (!category || category < 1 || category > 5) {
        return res.status(400).json({ error: '无效的分类参数 category (1-5)' });
      }
      console.log(`[feedController] 处理会员分类${category}页面请求`);
      const memberItems = await fetchMemberItems(category);
      return res.json(memberItems);
    }

    // ====================== 2. 原有逻辑处理 ======================
    console.log('[feedController] 处理普通feed请求');
    
    // 2.1 优先检查缓存
    const FeedDigest = await dbManager.getModel('FeedDigest');
    const cachedFeeds = await FeedDigest.find()
      .sort({ timestamp: -1 })
      .limit(115);
    
    if (cachedFeeds.length > 0) {
      console.log(`[feedController] 返回 ${cachedFeeds.length} 条缓存数据`);
      return res.json(cachedFeeds.map(withFeedType));
    }
    
    console.log('[feedController] 无可用缓存，从原始数据源获取');

    // 2.2 并行获取三个分类的数据
    const [dailyUpdates, dailyGossips, dailyBests] = await Promise.all([
      fetchDailyUpdate().catch(e => {
        console.error('[fetchDailyUpdate] 错误:', e);
        return [];
      }),
      fetchDailyGossip().catch(e => {
        console.error('[fetchDailyGossip] 错误:', e);
        return [];
      }),
      fetchDailyBest().catch(e => {
        console.error('[fetchDailyBest] 错误:', e);
        return [];
      })
    ]);

    // 2.3 合并并过滤有效数据
    const allFeeds = [
      ...(dailyUpdates || []),
      ...(dailyGossips || []),
      ...(dailyBests || [])
    ].filter(item => item != null);

    console.log(`[feedController] 合并后获得 ${allFeeds.length} 条有效数据`);

    // 2.4 如果有新数据则写入缓存
    if (allFeeds.length > 0) {
      await FeedDigest.insertMany(allFeeds)
        .then(() => console.log('[feedController] 新数据已缓存'))
        .catch(e => console.error('[缓存写入] 错误:', e));
    }

    return res.json(allFeeds.map(withFeedType));

  } catch (err) {
    console.error('[feedController] 主接口错误:', err);
    return res.status(500).json({ 
      error: '服务器内部错误',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/*-------------- 辅助函数 ---------------*/
function parseCaption(caption) {
  const result = {
    title: '',
    price: 0,
    description: ''
  };

  if (!caption) return result;

  // 按行分割并去除空行
  const lines = caption.split('\n').filter(line => line.trim());
  
  lines.forEach(line => {
    // 解析标题（支持"标题："或"名称："前缀）
    const titleMatch = line.match(/^(标题|名称)[:：]\s*(.+)/);
    if (titleMatch) {
      result.title = titleMatch[2].trim();
      return;
    }
    
    // 解析价格（支持"价格："或"售价："前缀）
    const priceMatch = line.match(/^(价格|售价)[:：]\s*(\d+\.?\d*)/);
    if (priceMatch) {
      result.price = parseFloat(priceMatch[2]);
      return;
    }
    
    // 解析描述（支持"描述："或"说明："前缀）
    const descMatch = line.match(/^(描述|说明)[:：]\s*(.+)/);
    if (descMatch) {
      result.description = descMatch[2].trim();
      return;
    }
  });

  // 如果没有找到带标签的信息，尝试智能解析
  if (lines.length === 3 && !result.title) {
    // 假设格式为：第一行标题，第二行价格，第三行描述
    result.title = lines[0].trim();
    result.price = parseFloat(lines[1]) || 0;
    result.description = lines[2].trim();
  } else if (!result.title) {
    // 如果没有解析出标题，使用第一行作为标题
    result.title = lines[0]?.trim() || caption;
  }

  return result;
}

/*------------ 每日更新自动数据读取接口 -------------*/
exports.consumeDailyFeeds = async () => {
  console.log('📤 [feedController] consumeDailyFeeds 执行中...');

  // 抓取三个分类
  const [dailyUpdates, dailyGossips, dailyBests] = await Promise.all([
    fetchDailyUpdate().catch(e => { console.error('❌ [dailyUpdate] 错误:', e); return []; }),
    fetchDailyGossip().catch(e => { console.error('❌ [dailyGossip] 错误:', e); return []; }),
    fetchDailyBest().catch(e => { console.error('❌ [dailyBest] 错误:', e); return []; })
  ]);

  console.log(`📝 [dailyUpdate] 获取到 ${dailyUpdates.length} 条更新`);
  console.log(`🍿 [dailyGossip] 获取到 ${dailyGossips.length} 组吃瓜`);
  console.log(`🌟 [dailyBest] 获取到 ${dailyBests.length} 条优选`);

  const allFeeds = [
    ...(dailyUpdates || []),
    ...(dailyGossips || []),
    ...(dailyBests || [])
  ].filter(Boolean);

  console.log(`✨ [feedController] 总计 ${allFeeds.length} 条有效内容`);

  // 缓存写入
  if (allFeeds.length > 0) {
    const FeedDigest = await dbManager.getModel('FeedDigest');
    await FeedDigest.insertMany(allFeeds)
      .then(() => {
        console.log('💾 [consumeDailyFeeds] 新数据已缓存成功！');
        console.log(`🔍 [缓存详情] dailyUpdate: ${dailyUpdates.length}, dailyGossip: ${dailyGossips.length}, dailyBest: ${dailyBests.length}`);
      })
      .catch(e => console.error('❌ [consumeDailyFeeds 缓存写入] 错误:', e));
  } else {
    console.log('⚠️ [consumeDailyFeeds] 没有新数据需要缓存');
  }

  console.log('✅ [feedController] consumeDailyFeeds 执行完成！\n');
  return allFeeds;
};