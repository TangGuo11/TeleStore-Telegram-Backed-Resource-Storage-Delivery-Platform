// chatServer.js
const express = require('express');
const dbManager = require('../../db/DBManager');

/* ---------- 全局状态管理 ---------- */
let modelsInitialized = false;
let Message, TelegramMessage;
let socketInitialized = false;      // ✅ 防重复注册保护
let telegramPushing = false;        // ✅ 防重入保护

module.exports = function initChatServer(app, io) {

  /* ---------- 提前初始化模型 ---------- */
  (async () => {
    try {
      Message = await dbManager.getModel('Message');
      TelegramMessage = await dbManager.getModel('TelegramMessage');
      modelsInitialized = true;
      console.log('✅ [chatServer] 模型预加载完成');
    } catch (err) {
      console.error('❌ [chatServer] 模型预加载失败:', err);
    }
  })();

  /* ---------- Express 路由设置 ---------- */
  const router = express.Router();

  /* ---------- 测试路由 ---------- */
  router.get('/test', (req, res) => {
    res.send('Chat server running!');
  });

  /* ---------- 分页加载聊天消息 API ---------- */
  router.get('/api/messages', async (req, res) => {

    if (!Message) return res.status(503).json({ message: '数据库未就绪' });

    const limit = 35; // 每页数量
    const beforeSortKey = req.query.beforeSortKey ? Number(req.query.beforeSortKey) : null;
    const beforeId = req.query.beforeId || null;

    // ✅ 基础查询条件
    const query = {};

    // ✅ 分页条件（核心逻辑）
    if (beforeSortKey && beforeId) {
      query.$or = [
        { historySortKey: { $lt: beforeSortKey } },
        { historySortKey: beforeSortKey, _id: { $lt: beforeId } }
      ];
    }

    try {
      // ✅ 查询消息（按最新→最旧排序）
      const messages = await Message.find(query)
        .sort({ historySortKey: -1, _id: -1 }) // ✅ 利用复合索引（高效分页）
        .limit(limit)
        .lean();

      // ✅ 数据封装（兼容 text / media_group）
      const enrichedMessages = messages.map(msg => {
        let medias = msg.medias || [];

        if (medias.length === 0 && (msg.text || msg.title)) {
          medias = [
            {
              type: 'text',
              url: null,
              caption: msg.text || msg.title,
              thumbnail: null
            }
          ];
        }

        return {
          _id: msg._id,
          username: msg.username,
          fromId: msg.fromId,
          text: msg.text || '',
          title: msg.title || '',
          medias,
          thumbnail: msg.thumbnail || (msg.medias?.[0]?.thumbnail || null),
          media_group_id: msg.media_group_id || null,
          groupId: msg.groupId || null,
          historySortKey: msg.historySortKey,
          createdAt: msg.createdAt
        };
      });

      // ✅ 判断是否还有更多历史记录（基于索引字段）
      let hasMore = false;
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        hasMore = await Message.exists({
          $or: [
            { historySortKey: { $lt: lastMsg.historySortKey } },
            { historySortKey: lastMsg.historySortKey, _id: { $lt: lastMsg._id } }
          ]
        }).hint({ historySortKey: -1, _id: -1 }); // ✅ 强制走复合索引
      }

      // ✅ 返回结果
      res.json({
        messages: enrichedMessages,
        hasMore
      });

    } catch (err) {
      console.error('❌ 加载聊天消息失败:', err);
      res.status(500).json({ message: '服务器错误' });
    }
  });

  /* ---------- 关键修复：直接挂载到根路径 ---------- */
  app.use(router);  // 移除 '/chat' 前缀，让路由直接生效

  console.log('✅ [chatServer] 路由已注册: /api/messages');

  /* ---------- socket.io 聊天逻辑（✅ 防重复注册保护） ---------- */
  if (!socketInitialized) {
    io.on('connection', async (socket) => {
      console.log('🟢 有用户连接到聊天室');

      socket.on('chatmessage', async (msg) => {
        if (!Message) {
          console.log('❌ 数据库未就绪，无法处理消息');
          return;
        }

        msg.timestamp = new Date();

        /* ---------- 构造用户媒体数据 ---------- */
        const userMedias = [{
          type: 'text',
          caption: msg.text || '(空消息)',
          url: null,
          thumbnail: null
        }];

        /* ---------- 发送到前端 ---------- */
        io.emit('chat message', {
          sender: msg.sender,
          medias: userMedias,
          text: msg.text,
          createdAt: msg.timestamp
        });

        /* ---------- 保存到数据库 ---------- */
        const message = new Message({
          username: msg.sender,
          text: msg.text,
          medias: userMedias,
          timestamp: msg.timestamp,
          // ✅ historySortKey
          historySortKey: msg.timestamp.getTime()
        });
        await message.save();
      });

      socket.on('join', (username) => {
        socket.broadcast.emit('chat message', {
          sender: '系统提示',
          text: `${username} 加入了聊天室`,
          timestamp: new Date()
        });
      });
    });

    socketInitialized = true;
    console.log('✅ [chatServer] Socket.IO 连接监听器已注册');
  }

  /* ---------- 定时推送 Telegram 消息（✅ 防重入保护） ---------- */
  let telegramInterval;

  // 延迟启动，确保其他服务先初始化
  setTimeout(async () => {
    try {
      // ✅ 确保模型已初始化
      if (!modelsInitialized) {
        Message = await dbManager.getModel('Message');
        TelegramMessage = await dbManager.getModel('TelegramMessage');
        modelsInitialized = true;
        console.log('✅ [chatServer] 定时任务模型初始化完成');
      }

      telegramInterval = setInterval(async () => {
        /* ---------- 防重入保护 ---------- */
        if (telegramPushing) {
          console.log('⏳ [chatServer] Telegram 消息推送正在进行中，跳过本次执行');
          return;
        }

        if (!TelegramMessage || !Message) {
          console.log('❌ [chatServer] 数据库模型未就绪，跳过 Telegram 消息推送');
          return;
        }

        telegramPushing = true;

        try {
          const now = Date.now();

          /* ---------- 1. 找出未发布的消息组 ---------- */
          const groups = await TelegramMessage.aggregate([
            {
              $match: {
                published: false,
                $or: [
                  /* ---------- 单条消息（没有媒体组 ID） ---------- */
                  {
                    $and: [
                      {
                        $or: [
                          { media_group_id: null },
                          { media_group_id: { $exists: false } }
                        ]
                      },
                      {
                        $or: [
                          { 'photo.media_group_id': null },
                          { 'photo.media_group_id': { $exists: false } }
                        ]
                      },
                      {
                        $or: [
                          { 'video.media_group_id': null },
                          { 'video.media_group_id': { $exists: false } }
                        ]
                      },
                      {
                        $or: [
                          { 'document.media_group_id': null },
                          { 'document.media_group_id': { $exists: false } }
                        ]
                      }
                    ]
                  },
                  /* ---------- 多媒体组（延迟 60 秒推送） ---------- */
                  {
                    $and: [
                      {
                        $or: [
                          { media_group_id: { $ne: null } },
                          { 'photo.media_group_id': { $ne: null } },
                          { 'video.media_group_id': { $ne: null } },
                          { 'document.media_group_id': { $ne: null } }
                        ]
                      },
                      { group_received_at: { $lt: new Date(now - 60 * 1000) } }
                    ]
                  }
                ]
              }
            },
            {
              $addFields: {
                group_id: {
                  $ifNull: [
                    '$media_group_id',
                    {
                      $ifNull: [
                        '$photo.media_group_id',
                        {
                          $ifNull: [
                            '$video.media_group_id',
                            {
                              $ifNull: [
                                '$document.media_group_id',
                                { $concat: ['single_', { $toString: '$_id' }] }
                              ]
                            }
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
                _id: '$group_id',
                earliest: { $min: '$timestamp' }
              }
            },
            { $sort: { earliest: 1 } },
            { $limit: 1 }
          ]);

          const groupIds = groups.map(g => g._id).filter(Boolean);
          if (groupIds.length === 0) return;

          console.log('🧩 [chatServer] 匹配到的 groups:', groupIds);

          /* ---------- 2. 查出该组的所有消息 ---------- */
          const mongoIds = groupIds
            .filter(id => id.startsWith('single_'))
            .map(id => id.replace('single_', ''));

          const groupDocs = await TelegramMessage.find({
            published: false,
            $or: [
              { media_group_id: { $in: groupIds } },
              { 'photo.media_group_id': { $in: groupIds } },
              { 'video.media_group_id': { $in: groupIds } },
              { 'document.media_group_id': { $in: groupIds } },
              { _id: { $in: mongoIds } }
            ]
          })
            .sort({ timestamp: 1 })
            .lean();

          if (groupDocs.length === 0) return;

          /* ---------- 3. 组装消息组 ---------- */
          const grouped = {};
          for (const msg of groupDocs) {
            const gid =
              msg.media_group_id ||
              msg.photo?.media_group_id ||
              msg.video?.media_group_id ||
              msg.document?.media_group_id ||
              `single_${msg._id}`;

            if (!grouped[gid]) {
              grouped[gid] = {
                groupId: gid,
                from: { username: msg.from?.username || 'Telegram 用户', avatarColor: '#888' },
                caption: '',
                text: '',
                timestamp: msg.timestamp,
                medias: [],
                originalIds: []
              };
            }

            /* ---------- 处理纯文本消息 ---------- */
            if (msg.text) {
              if (!grouped[gid].text) grouped[gid].text = msg.text;
              if (!grouped[gid].caption) grouped[gid].caption = msg.text;
            } else {
              /* ---------- 处理照片消息 ---------- */
              if (msg.photo?.file_id) {
                const url = `/file/${msg.photo.file_id}`;
                grouped[gid].medias.push({ type: 'photo', url, caption: msg.photo?.caption || msg.caption || '' });
                if (!grouped[gid].caption) grouped[gid].caption = msg.photo?.caption || msg.caption || '';
              }
              /* ---------- 处理视频消息 ---------- */
              else if (msg.video?.file_id || msg.video?.file_path) {
                let url = null;
                if (msg.video.file_id) {
                  url = `/file/${msg.video.file_id}`;
                } else if (msg.video.file_path) {
                  url = `/proxy-file?path=${encodeURIComponent(msg.video.file_path)}`;
                }
                grouped[gid].medias.push({
                  type: 'video',
                  url: `/file/${msg.video.file_id}`,
                  caption: msg.video?.caption || msg.caption || '',
                  thumbnail: msg.video?.thumb_file_id ? `/file/${msg.video.thumb_file_id}` : null
                });
                if (!grouped[gid].caption) grouped[gid].caption = msg.video?.caption || msg.caption || '';
              }
              /* ---------- 处理文档消息 ---------- */
              else if (msg.document?.file_id || msg.document?.file_path) {
                let url = null;
                if (msg.document.file_id) {
                  url = `/file/${msg.document.file_id}`;
                } else if (msg.document.file_path) {
                  url = `/proxy-file?path=${encodeURIComponent(msg.document.file_path)}`;
                }
                grouped[gid].medias.push({
                  type: 'document',
                  url,
                  caption: msg.document?.caption || msg.caption || msg.document?.file_name || ''
                });
                if (!grouped[gid].caption) grouped[gid].caption = msg.document?.caption || msg.caption || '';
              }
            }

            grouped[gid].originalIds.push(msg._id);
          }

          /* ---------- 4. 生成推送列表 ---------- */
          const groupsToSend = Object.values(grouped).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

          /* ---------- 5. 推送并保存消息 ---------- */
          for (const group of groupsToSend) {
            console.log(`🚀 [chatServer] 推送 group: ${group.groupId} (${group.medias.length} 条, text:${!!group.text})`);

            // 推送到前端
            io.emit('telegramGroup', group);

            // 去重判断
            const exists = await Message.findOne({ groupId: group.groupId });
            if (exists) {
              await TelegramMessage.updateMany(
                { _id: { $in: group.originalIds }, published: false },
                { $set: { published: true } }
              );
              continue;
            }

            /* ---------- 构造保存所需媒体数据 ---------- */
            let medias = group.medias.map(m => ({
              type: m.type,
              url: m.url,
              caption: m.caption || '',
              thumbnail: m.thumbnail || null
            }));

            /* ---------- 处理纯文本组 ---------- */
            if (medias.length === 0 && (group.text || group.caption)) {
              medias.push({
                type: 'text',
                caption: group.text || group.caption,
                url: null,
                thumbnail: null
              });
            }

            /* ---------- 保存到数据库 ---------- */
            const messageToSave = new Message({
              username: group.from.username || 'Telegram 用户',
              fromId: null,
              text: group.text || group.caption || '',
              title: group.caption || '',
              medias,
              thumbnail: medias.find(m => m.type === 'photo' || m.type === 'video')?.thumbnail || null,
              chatId: groupDocs[0]?.chat?.id?.toString() || '',
              media_group_id: group.groupId.startsWith('single_') ? null : group.groupId,
              groupId: group.groupId,
              telegramMessageIds: group.originalIds,
              timestamp: group.timestamp,
              // ✅ historySortKey：使用组的最早时间
              historySortKey: group.timestamp.getTime()
            });

            await messageToSave.save();

            await TelegramMessage.updateMany(
              { _id: { $in: group.originalIds } },
              { $set: { published: true } }
            );

            console.log(`✅ [chatServer] 已保存历史记录: ${group.groupId}`);
          }

          if (groupsToSend.length > 0) {
            console.log(`✅ [chatServer] 推送完成：${groupsToSend.length} 组 Telegram 消息`);
          }

        } catch (err) {
          console.error('❌ [chatServer] 推送 Telegram 消息失败:', err);
        } finally {
          /* ---------- 确保防重入标志重置 ---------- */
          telegramPushing = false;
        }
      }, 60 * 1000);

      console.log('✅ [chatServer] Telegram 消息推送服务已启动');

    } catch (error) {
      console.error('❌ [chatServer] 启动 Telegram 消息推送服务失败:', error);
    }
  }, 1000);
};