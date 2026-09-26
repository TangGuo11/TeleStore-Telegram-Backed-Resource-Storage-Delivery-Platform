// yx/game-api/models/GameViewModel.js

/**
 * 清理游戏标题 - 移除多余前缀
 */
function cleanGameTitle(title) {
  if (!title || typeof title !== 'string') return '';
  
  let cleaned = title.trim();
  
  // 常见标题前缀
  const titlePrefixes = [
    '标题：', '游戏标题：', 'Title：', '游戏：', '游戏名称：',
    '名称：', '标题:', '游戏标题:', 'Title:', '游戏名称:'
  ];
  
  // 移除前缀
  titlePrefixes.forEach(prefix => {
    if (cleaned.includes(prefix)) {
      const parts = cleaned.split(prefix);
      if (parts.length > 1) {
        cleaned = parts[1].trim();
      }
    }
  });
  
  // 如果包含"游戏价格："，移除该部分
  if (cleaned.includes('游戏价格：')) {
    const parts = cleaned.split('游戏价格：');
    cleaned = parts[0].trim();
  }
  
  // 移除开头的换行符和空格
  cleaned = cleaned.replace(/^[\n\s]+/, '');
  
  // 如果有多行，只取第一行
  if (cleaned.includes('\n')) {
    cleaned = cleaned.split('\n')[0].trim();
  }
  
  return cleaned;
}

/**
 * 从 caption 中提取标题
 */
function extractTitleFromCaption(caption) {
  if (!caption || typeof caption !== 'string') return '';
  
  const lines = caption.split('\n');
  
  // 查找包含"标题："的行
  for (let line of lines) {
    if (line.includes('标题：')) {
      const parts = line.split('标题：');
      if (parts.length > 1) {
        const title = parts[1].trim();
        return cleanGameTitle(title);
      }
    }
  }
  
  return '';
}

/**
 * 提取并清理描述文本
 */
function extractCleanDescription(text, isForCard = true) {
  if (!text || typeof text !== 'string') return '';
  
  let cleaned = text.trim();
  
  // 如果有"简介："开头，移除它但保留内容
  if (cleaned.startsWith('简介：') || cleaned.startsWith('介绍：')) {
    cleaned = cleaned.substring(3).trim();
  }
  
  // 处理多行文本
  const lines = cleaned.split('\n');
  
  // 移除标题行和价格行
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return false; // 移除空行
    
    const lowerLine = trimmedLine.toLowerCase();
    // 移除标题相关的行
    if (lowerLine.includes('标题：') || 
        lowerLine.includes('游戏价格：') ||
        lowerLine.includes('price：') ||
        lowerLine.startsWith('价格：')) {
      return false;
    }
    
    // 保留其他行
    return true;
  });
  
  // 重新组合
  cleaned = filteredLines.join('\n').trim();
  
  // 对于卡片显示，限制长度
  if (isForCard && cleaned.length > 150) {
    cleaned = cleaned.substring(0, 150) + '...';
  }
  
  return cleaned;
}

/**
 * 智能获取游戏描述
 */
function getGameDescription(gameDoc, isForCard = true) {
  // 优先从第一个图片的caption获取
  if (gameDoc.medias && gameDoc.medias.length > 0) {
    const firstMedia = gameDoc.medias[0];
    if (firstMedia.caption && firstMedia.caption.trim()) {
      return extractCleanDescription(firstMedia.caption, isForCard);
    }
  }
  
  // 其次从标题中提取
  if (gameDoc.title) {
    const descriptionFromTitle = extractCleanDescription(gameDoc.title, isForCard);
    if (descriptionFromTitle) return descriptionFromTitle;
  }
  
  return isForCard ? '暂无游戏介绍' : '';
}

/**
 * 智能获取游戏标题
 */
function getGameTitle(gameDoc) {
  // 1. 先清理原始标题
  if (gameDoc.title) {
    const cleanedTitle = cleanGameTitle(gameDoc.title);
    if (cleanedTitle && cleanedTitle !== '') {
      return cleanedTitle;
    }
  }
  
  // 2. 从第一个图片的caption中提取标题
  if (gameDoc.medias && gameDoc.medias.length > 0) {
    const firstMedia = gameDoc.medias[0];
    if (firstMedia.caption) {
      const titleFromCaption = extractTitleFromCaption(firstMedia.caption);
      if (titleFromCaption) return titleFromCaption;
    }
  }
  
  // 3. 从描述中提取第一行作为标题
  const description = getGameDescription(gameDoc, false);
  if (description && description.includes('\n')) {
    const firstLine = description.split('\n')[0].trim();
    if (firstLine.length < 50) { // 避免过长的标题
      return firstLine;
    }
  }
  
  // 4. 默认标题
  return '未命名游戏';
}

/**
 * 获取游戏价格
 */
function getGamePrice(gameDoc) {
  if (gameDoc.price && gameDoc.price > 0) {
    return gameDoc.price;
  }
  
  // 从标题中查找价格信息
  if (gameDoc.title && gameDoc.title.includes('游戏价格：')) {
    const parts = gameDoc.title.split('游戏价格：');
    if (parts.length > 1) {
      const pricePart = parts[1].split('\n')[0].trim();
      const priceMatch = pricePart.match(/(\d+(\.\d+)?)/);
      if (priceMatch) {
        return parseFloat(priceMatch[1]);
      }
    }
  }
  
  return 0; // 免费
}

/* ==================== 主构建函数 ==================== */
function buildGameViewModel(gameDoc) {
  // 获取清理后的数据
  const title = getGameTitle(gameDoc);
  const cardDescription = getGameDescription(gameDoc, true); // 卡片用简短描述
  const fullDescription = getGameDescription(gameDoc, false); // 详情页用完整描述
  const price = getGamePrice(gameDoc);
  
  return {
    // 基本信息
    gameId: gameDoc.gameId || '',
    title: title,
    description: cardDescription,
    fullDescription: fullDescription,
    platform: gameDoc.platform || "unknown",
    price: price,
    
    // 媒体资源
    images: gameDoc.medias
      .filter(m => m.type === "photo")
      .map(m => ({
        url: `/game-api/file/${m.file_id}`,
        fileId: m.file_id,
        width: m.width,
        height: m.height
      })),
      
    videos: gameDoc.medias
      .filter(m => m.type === "video")
      .map(m => ({
        url: `/game-api/file/${m.file_id}`,
        fileId: m.file_id,
        size: m.file_size,
        duration: m.duration || 0,
        thumb: m.thumb_file_id ? `/game-api/file/${m.thumb_file_id}` : null
      })),
      
    installers: gameDoc.medias
      .filter(m => m.type === "document")
      .map(m => ({
        name: m.file_name || "download",
        size: m.file_size || 0,
        url: `/game-api/file/${m.file_id}`,
        fileId: m.file_id,
        mimeType: m.mime_type
      })),
      
    // 统计信息
    stats: {
      totalSize: gameDoc.medias.reduce((sum, media) => sum + (media.file_size || 0), 0),
      imageCount: gameDoc.medias.filter(m => m.type === 'photo').length,
      videoCount: gameDoc.medias.filter(m => m.type === 'video').length,
      installerCount: gameDoc.medias.filter(m => m.type === 'document').length
    },
    
    // 时间信息
    createdAt: gameDoc.createdAt || gameDoc.timestamp || Date.now(),
    updatedAt: gameDoc.updatedAt || Date.now(),
    
    // 元数据（用于调试）
    _meta: {
      originalTitle: gameDoc.title || '',
      hasPriceInfo: price > 0,
      mediaCount: gameDoc.medias ? gameDoc.medias.length : 0
    }
  };
}

module.exports = {
  buildGameViewModel,
  cleanGameTitle,
  extractTitleFromCaption,
  extractCleanDescription,
  getGameTitle,
  getGameDescription,
  getGamePrice
};