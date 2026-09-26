// game-api/routes/games.js 
const express = require('express');
const router = express.Router();

// 使用统一的 mongoose 实例
const { mongoose } = require('../db/mongoose');
// 🎯 导入新的清理函数
const { 
  buildGameViewModel, 
  cleanGameTitle, 
  extractCleanDescription,
  getGameTitle,
  getGameDescription,
  getGamePrice 
} = require('../models/GameViewModel');

console.log('🎮 Games 路由开始加载...');

// 🎯 安全的模型导入 - 使用延迟加载
let GameMessage;
try {
  // 注意：这里使用统一的 mongoose 实例
  GameMessage = require('../models/GameMessage.api');
  console.log('🎮 GameMessage 模型加载成功');
} catch (error) {
  console.error('🎮 无法加载 GameMessage 模型:', error.message);
  GameMessage = null;
}

/* ------------------------- 🔍 DEBUG ROUTE（关键） ------------------------- */
router.get('/debug', async (req, res) => {
  const logs = [];
  function log(msg, data) {
    logs.push({ msg, data });
    console.log(`🔍 DEBUG: ${msg}`, data || '');
  }

  try {
    log("进入 /debug", new Date().toISOString());

    // 1. 模型是否加载
    if (!GameMessage) {
      log("GameMessage 模型加载失败");
      return res.json({ ok: false, step: "model-missing", logs });
    }
    log("模型名称", GameMessage.modelName);

    // 2. 数据库连接状态（使用统一的 mongoose）
    log("mongoose.connection.readyState", mongoose.connection.readyState);
    if (mongoose.connection.readyState !== 1) {
      return res.json({ ok: false, step: "db-not-connected", logs });
    }

    // 3. 列出所有集合
    const collections = await mongoose.connection.db.listCollections().toArray();
    const names = collections.map(c => c.name);
    log("当前数据库所有集合:", names);

    const exists = names.includes('game_messages');
    log("game_messages 存在吗？", exists);

    if (!exists) {
      return res.json({ ok: false, step: "collection-missing", logs });
    }

    // 4. 总数检查 - 使用 estimatedDocumentCount 更可靠
    const count = await GameMessage.estimatedDocumentCount();
    log("文档数量 estimatedDocumentCount()", count);

    // 5. findOne 检查
    const first = await GameMessage.findOne({});
    log("findOne 查询结果", first ? '找到文档' : '无文档');

    // 6. aggregate 测试
    const agg = await GameMessage.aggregate([{ $limit: 1 }]);
    log("aggregate([{ $limit: 1 }]) 结果", agg.length > 0 ? '成功' : '无结果');

    return res.json({ 
      ok: true, 
      logs,
      summary: {
        database: 'connected',
        model: 'loaded',
        collection: 'exists',
        documentCount: count
      }
    });

  } catch (err) {
    log("异常", err.message);
    return res.json({
      ok: false,
      step: "exception",
      logs,
      error: err.message,
      stack: err.stack
    });
  }
});


/* ------------------------- 🎯 游戏列表 API ------------------------- */
router.get('/', async (req, res) => {
  console.log('🎮 [GET /] 游戏列表API被调用', {
    query: req.query,
    timestamp: new Date().toISOString()
  });

  try {
    if (!GameMessage) {
      return res.json({ success: true, message: '模型加载中...', data: [] });
    }

    const { platform, page = 1, limit = 20, search } = req.query;

    const query = {};
    if (platform && platform !== 'all') query.platform = platform;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { 'medias.caption': { $regex: search, $options: 'i' } }
      ];
    }

    console.log('🎮 [GET /] 查询条件:', query);

    // 🎯 修改：先分组获取所有游戏ID
    const gameGroups = await GameMessage.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$gameId",
          docs: { $push: "$$ROOT" },
          latestCreated: { $max: "$createdAt" }
        }
      },
      { $sort: { latestCreated: -1 } },
      { $skip: (page - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    ]);

    console.log('🎮 [GET /] 游戏分组数量:', gameGroups.length);

    // 🎯 对每个游戏合并所有文档，并使用 ViewModel 清理数据
    const games = gameGroups.map((group) => {
      // 🎯 合并所有媒体
      const allMedias = group.docs.flatMap(doc => doc.medias || []);
      
      // 🎯 找到有标题的文档（用于获取原始数据）
      const titleDoc = group.docs.find(doc => doc.title && doc.title.trim() !== '');
      
      // 🎯 合并价格（取最高价格）
      let mergedPrice = 0;
      for (const doc of group.docs) {
        if (doc.price && doc.price > mergedPrice) {
          mergedPrice = doc.price;
        }
      }
      
      // 🎯 创建合并的文档对象，供 ViewModel 处理
      const mergedDoc = {
        gameId: group._id,
        title: titleDoc ? titleDoc.title : (group.docs[0]?.title || ''),
        platform: titleDoc ? titleDoc.platform : (group.docs[0]?.platform || 'unknown'),
        price: mergedPrice,
        medias: allMedias,
        createdAt: group.docs[0]?.createdAt || new Date(),
        updatedAt: group.docs[group.docs.length - 1]?.updatedAt || new Date()
      };
      
      // 🎯 使用 ViewModel 获取清理后的数据
      const title = getGameTitle(mergedDoc);
      const cardDescription = getGameDescription(mergedDoc, true);
      const fullDescription = getGameDescription(mergedDoc, false);
      const price = getGamePrice(mergedDoc);
      
      // 🎯 分类媒体
      const images = allMedias
        .filter(m => m.type === 'photo')
        .map(m => ({
          url: `/game-api/file/${m.file_id}`,
          fileId: m.file_id,
          width: m.width,
          height: m.height
        }));
      
      const videos = allMedias
        .filter(m => m.type === 'video')
        .map(m => ({
          url: `/game-api/file/${m.file_id}`,
          fileId: m.file_id,
          size: m.file_size,
          duration: m.duration || 0,
          thumb: m.thumb_file_id ? `/game-api/file/${m.thumb_file_id}` : null,
          thumbPath: m.thumb_path,
          hasThumbnail: !!(m.thumb_file_id || m.thumb_path)
        }));
      
      const installers = allMedias
        .filter(m => m.type === 'document' && 
                (m.mime_type === 'application/vnd.android.package-archive' || 
                 m.file_name?.endsWith('.apk') ||
                 m.file_name?.includes('安装包')))
        .map(m => ({
          name: m.file_name || 'download',
          size: m.file_size || 0,
          url: `/game-api/file/${m.file_id}`,
          fileId: m.file_id,
          mimeType: m.mime_type
        }));
      
      return {
        gameId: group._id,
        title: title,
        description: cardDescription, // 🎯 使用清理后的描述
        fullDescription: fullDescription, // 🎯 完整描述，用于详情页
        platform: mergedDoc.platform,
        price: price, // 🎯 清理后的价格
        images: images,
        videos: videos,
        installers: installers,
        stats: {
          totalSize: allMedias.reduce((sum, media) => sum + (media.file_size || 0), 0),
          imageCount: images.length,
          videoCount: videos.length,
          videoWithThumbnailCount: videos.filter(v => v.hasThumbnail).length,
          installerCount: installers.length
        },
        createdAt: mergedDoc.createdAt,
        updatedAt: mergedDoc.updatedAt
      };
    });

    console.log('🎮 [GET /] 处理后的游戏数量:', games.length);
    
    // 获取总游戏数
    const totalGamesAgg = await GameMessage.aggregate([
      { $match: query },
      { $group: { _id: "$gameId" } },
      { $count: "total" }
    ]);
    
    const totalGames = totalGamesAgg[0]?.total || 0;
    console.log('🎮 [GET /] 总游戏数:', totalGames);

    res.json({
      success: true,
      data: games,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalGames,
        hasMore: (page * limit) < totalGames
      }
    });

  } catch (error) {
    console.error('🎮 [GET /] API错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      system: 'game-api'
    });
  }
});


/* ------------------------- 🎯 游戏详情 API ------------------------- */
router.get('/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  console.log('🎮 [GET /:gameId] 游戏详情API被调用', { gameId });

  try {
    if (!GameMessage) {
      return res.json({ success: true, data: null });
    }

    const gameDocs = await GameMessage.find({ gameId }).sort({ createdAt: 1 });

    if (!gameDocs.length) {
      return res.status(404).json({
        success: false,
        error: '游戏未找到',
        gameId
      });
    }

    console.log('🎮 [GET /:gameId] 找到文档数量:', gameDocs.length);
    
    // 🎯 合并所有文档的媒体
    const allMedias = gameDocs.flatMap(doc => doc.medias || []);
    
    // 🎯 合并价格（取最高价格）
    let mergedPrice = 0;
    for (const doc of gameDocs) {
      if (doc.price && doc.price > mergedPrice) {
        mergedPrice = doc.price;
      }
    }
    
    // 🎯 找到有标题的文档
    const titleDoc = gameDocs.find(doc => doc.title && doc.title.trim() !== '');
    
    // 🎯 创建合并的文档
    const mergedGameDoc = {
      gameId: gameId,
      title: titleDoc ? titleDoc.title : (gameDocs[0]?.title || ''),
      platform: titleDoc ? titleDoc.platform : (gameDocs[0]?.platform || 'unknown'),
      price: mergedPrice,
      medias: allMedias,
      createdAt: gameDocs[0]?.createdAt || new Date(),
      updatedAt: gameDocs[gameDocs.length - 1]?.updatedAt || new Date(),
      timestamp: gameDocs[0]?.timestamp || new Date()
    };

    console.log('🎮 [GET /:gameId] 原始标题:', mergedGameDoc.title);
    
    // 🎯 使用新的 ViewModel 构建游戏详情
    const gameDetail = buildGameViewModel(mergedGameDoc);
    
    console.log('🎮 [GET /:gameId] 清理后标题:', gameDetail.title);
    console.log('🎮 [GET /:gameId] 价格:', gameDetail.price);

    // 🎯 添加额外信息
    gameDetail.additionalInfo = {
      sourceCount: gameDocs.length,
      originalMessageIds: gameDocs.flatMap(doc => doc.originalMessageIds),
      timeRange: {
        firstCreated: gameDocs[0].createdAt,
        lastUpdated: gameDocs[gameDocs.length - 1].updatedAt
      }
    };

    res.json({ 
      success: true, 
      data: gameDetail 
    });

  } catch (error) {
    console.error('🎮 [GET /:gameId] API错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      system: 'game-api'
    });
  }
});

/* ------------------------- 🎯 缩略图管理API ------------------------- */

// 🎯 获取所有需要缩略图的视频
router.get('/thumbnails/pending', async (req, res) => {
  try {
    if (!GameMessage) {
      return res.json({ success: false, error: '数据库模型未加载' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    const videos = await GameMessage.findVideosNeedThumbnail(limit + skip);
    
    // 提取需要的信息
    const pendingThumbnails = [];
    
    videos.forEach(game => {
      game.medias.forEach(media => {
        if (media.type === 'video' && 
            media.thumb_file_id && 
            (!media.thumb_path || media.thumb_path === '')) {
          
          pendingThumbnails.push({
            gameId: game.gameId,
            fileUniqueId: media.file_unique_id,
            thumbFileId: media.thumb_file_id,
            videoFileId: media.file_id,
            width: media.width,
            height: media.height,
            duration: media.duration,
            fileSize: media.file_size,
            hasThumbPath: !!media.thumb_path,
            needsDownload: !media.thumb_path || media.thumb_path === '',
            thumbnailUrl: `/game-api/file/${media.thumb_file_id}`
          });
        }
      });
    });

    // 分页处理
    const total = pendingThumbnails.length;
    const paginatedData = pendingThumbnails.slice(skip, skip + limit);

    res.json({
      success: true,
      count: paginatedData.length,
      total: total,
      page: page,
      limit: limit,
      pages: Math.ceil(total / limit),
      data: paginatedData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎮 获取待处理缩略图失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      system: 'game-api'
    });
  }
});

// 🎯 获取游戏的缩略图信息
router.get('/:gameId/thumbnails', async (req, res) => {
  const gameId = req.params.gameId;
  
  try {
    if (!GameMessage) {
      return res.json({ success: false, error: '数据库模型未加载' });
    }

    const thumbnails = await GameMessage.getGameThumbnails(gameId);
    
    // 分类统计
    const stats = {
      total: thumbnails.length,
      withThumbFileId: thumbnails.filter(t => t.hasThumbFileId).length,
      withThumbPath: thumbnails.filter(t => t.hasThumbPath).length,
      videos: thumbnails.filter(t => t.type === 'video').length,
      photos: thumbnails.filter(t => t.type === 'photo').length,
      missingThumbPath: thumbnails.filter(t => t.hasThumbFileId && !t.hasThumbPath).length,
      completionRate: thumbnails.filter(t => t.hasThumbFileId).length > 0 
        ? ((thumbnails.filter(t => t.hasThumbPath).length / thumbnails.filter(t => t.hasThumbFileId).length) * 100).toFixed(2) + '%'
        : 'N/A'
    };

    // 为每个缩略图添加访问URL
    const thumbnailsWithUrls = thumbnails.map(thumb => ({
      ...thumb,
      thumbnailUrl: thumb.thumbFileId ? `/game-api/file/${thumb.thumbFileId}` : null,
      fileUrl: thumb.fileId ? `/game-api/file/${thumb.fileId}` : null
    }));

    res.json({
      success: true,
      gameId,
      stats,
      data: thumbnailsWithUrls,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`🎮 获取游戏 ${gameId} 缩略图失败:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      gameId,
      system: 'game-api'
    });
  }
});

// 🎯 更新缩略图路径（单个）
router.post('/thumbnails/update', async (req, res) => {
  try {
    const { fileUniqueId, thumbPath, thumbFileId } = req.body;
    
    if (!fileUniqueId || !thumbPath) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: fileUniqueId 和 thumbPath'
      });
    }

    const result = await GameMessage.updateThumbPath(fileUniqueId, thumbPath, thumbFileId);
    
    if (result.modifiedCount > 0) {
      res.json({
        success: true,
        message: '缩略图路径更新成功',
        fileUniqueId,
        thumbPath,
        thumbFileId,
        modifiedCount: result.modifiedCount,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: '未找到匹配的记录',
        fileUniqueId,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('🎮 更新缩略图路径失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🎯 批量更新缩略图路径
router.post('/thumbnails/batch-update', async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '需要 updates 数组'
      });
    }

    // 验证数据
    const validUpdates = updates.filter(update => 
      update.fileUniqueId && update.thumbPath
    );

    if (validUpdates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有有效的更新数据'
      });
    }

    const result = await GameMessage.batchUpdateThumbPaths(validUpdates);
    
    res.json({
      success: true,
      message: `批量更新完成，成功更新 ${result.modifiedCount} 条记录`,
      totalUpdates: updates.length,
      validUpdates: validUpdates.length,
      modifiedCount: result.modifiedCount,
      details: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎮 批量更新缩略图失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🎯 手动触发缩略图下载（管理接口）
router.post('/thumbnails/download', async (req, res) => {
  try {
    const { fileUniqueId, thumbFileId } = req.body;
    
    if (!fileUniqueId || !thumbFileId) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: fileUniqueId 和 thumbFileId'
      });
    }

    // 查找文件信息
    const gameDoc = await GameMessage.findOne({
      'medias.file_unique_id': fileUniqueId,
      'medias.thumb_file_id': thumbFileId
    }).lean();

    if (!gameDoc) {
      return res.status(404).json({
        success: false,
        error: '未找到对应的媒体文件',
        fileUniqueId,
        thumbFileId
      });
    }

    // 获取媒体信息
    const media = gameDoc.medias.find(m => 
      m.file_unique_id === fileUniqueId && m.thumb_file_id === thumbFileId
    );

    if (!media) {
      return res.status(404).json({
        success: false,
        error: '未找到媒体记录',
        fileUniqueId,
        thumbFileId
      });
    }

    // 构建缩略图信息
    const thumbnailInfo = {
      file_id: thumbFileId,
      file_unique_id: media.file_unique_id,
      thumb_file_id: thumbFileId,
      file_size: media.file_size,
      mime_type: 'image/jpeg',
      file_name: `thumb_${media.file_unique_id}.jpg`,
      type: 'thumbnail',
      width: media.width,
      height: media.height,
      gameId: gameDoc.gameId,
      isThumbnail: true,
      original_media: media
    };

    res.json({
      success: true,
      message: '缩略图信息已准备',
      thumbnailInfo,
      downloadUrl: `/game-api/file/${thumbFileId}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎮 准备缩略图下载失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🎯 缩略图统计信息
router.get('/thumbnails/stats', async (req, res) => {
  try {
    if (!GameMessage) {
      return res.json({ success: false, error: '数据库模型未加载' });
    }

    // 获取所有游戏
    const allGames = await GameMessage.aggregate([
      { $match: { is_active: true } },
      { $group: { _id: "$gameId" } },
      { $count: "totalGames" }
    ]);

    // 获取有视频的游戏
    const gamesWithVideos = await GameMessage.aggregate([
      { $match: { 
        is_active: true,
        'medias.type': 'video'
      }},
      { $group: { _id: "$gameId" } },
      { $count: "total" }
    ]);

    // 获取有缩略图的视频
    const videosWithThumbs = await GameMessage.aggregate([
      { $match: { 
        is_active: true,
        'medias.type': 'video',
        'medias.thumb_file_id': { $exists: true, $ne: '' }
      }},
      { $unwind: "$medias" },
      { $match: { 
        'medias.type': 'video',
        'medias.thumb_file_id': { $exists: true, $ne: '' }
      }},
      { $group: { _id: null, count: { $sum: 1 } } }
    ]);

    // 获取有thumb_path的视频
    const videosWithThumbPath = await GameMessage.aggregate([
      { $match: { 
        is_active: true,
        'medias.type': 'video',
        'medias.thumb_path': { $exists: true, $ne: '' }
      }},
      { $unwind: "$medias" },
      { $match: { 
        'medias.type': 'video',
        'medias.thumb_path': { $exists: true, $ne: '' }
      }},
      { $group: { _id: null, count: { $sum: 1 } } }
    ]);

    // 使用新的统计方法
    const detailedStats = await GameMessage.getThumbnailStats();
    const gamesWithThumbnails = await GameMessage.findGamesWithThumbnails(10);

    const stats = {
      totalGames: allGames[0]?.totalGames || 0,
      gamesWithVideos: gamesWithVideos[0]?.total || 0,
      videosWithThumbFileId: videosWithThumbs[0]?.count || 0,
      videosWithThumbPath: videosWithThumbPath[0]?.count || 0,
      pendingThumbnails: (videosWithThumbs[0]?.count || 0) - (videosWithThumbPath[0]?.count || 0),
      completionRate: videosWithThumbs[0]?.count ? 
        ((videosWithThumbPath[0]?.count || 0) / videosWithThumbs[0]?.count * 100).toFixed(2) + '%' : '0%',
      detailedStats: detailedStats[0] || {},
      topGamesNeedingThumbnails: gamesWithThumbnails.filter(g => g.missingThumbnails > 0)
    };

    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎮 获取缩略图统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🎯 批量下载缩略图任务
router.post('/thumbnails/batch-download', async (req, res) => {
  try {
    const { limit = 10, gameId } = req.body;
    
    if (!GameMessage) {
      return res.json({ success: false, error: '数据库模型未加载' });
    }

    // 构建查询条件
    const query = {
      'medias.type': 'video',
      'medias.thumb_file_id': { $exists: true, $ne: '' },
      $or: [
        { 'medias.thumb_path': { $exists: false } },
        { 'medias.thumb_path': '' }
      ],
      is_active: true
    };

    if (gameId) {
      query.gameId = gameId;
    }

    // 查找需要缩略图的视频
    const games = await GameMessage.find(query)
      .limit(parseInt(limit))
      .select('gameId medias')
      .lean();

    // 提取缩略图信息
    const thumbnailTasks = [];
    
    games.forEach(game => {
      game.medias.forEach(media => {
        if (media.type === 'video' && 
            media.thumb_file_id && 
            (!media.thumb_path || media.thumb_path === '')) {
          
          thumbnailTasks.push({
            taskId: `thumb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            gameId: game.gameId,
            fileUniqueId: media.file_unique_id,
            thumbFileId: media.thumb_file_id,
            videoFileId: media.file_id,
            width: media.width,
            height: media.height,
            downloadUrl: `/game-api/file/${media.thumb_file_id}`,
            status: 'pending',
            createdAt: new Date().toISOString()
          });
        }
      });
    });

    res.json({
      success: true,
      message: `找到 ${thumbnailTasks.length} 个需要下载的缩略图`,
      totalTasks: thumbnailTasks.length,
      tasks: thumbnailTasks,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎮 创建批量下载任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🎯 清理无效的缩略图记录
router.post('/thumbnails/cleanup', async (req, res) => {
  try {
    if (!GameMessage) {
      return res.json({ success: false, error: '数据库模型未加载' });
    }

    // 查找有thumb_file_id但没有对应文件的记录
    const gamesWithInvalidThumbs = await GameMessage.find({
      'medias.thumb_file_id': { $exists: true, $ne: '' },
      'medias.thumb_path': { $exists: false }
    }).select('gameId medias').lean();

    const cleanupResults = {
      totalRecords: gamesWithInvalidThumbs.length,
      cleanedRecords: 0,
      details: []
    };

    // 这里可以添加更复杂的清理逻辑
    // 例如：检查文件是否实际存在，然后决定是否清理

    res.json({
      success: true,
      message: '缩略图清理检查完成',
      results: cleanupResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🎮 清理缩略图记录失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* ------------------------- 🎮 路由加载完成 ------------------------- */
console.log('🎮 Games 路由加载完成（含 DEBUG 路由和缩略图管理API）');
module.exports = router;