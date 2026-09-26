//file/FileType.js - 文件类型分析

const path = require('path');
class FileType {
  analyzeFile(fileDoc, fileId) {
    // 处理缩略图 thumb_file_id
    if (fileDoc.video?.thumb_file_id === fileId) {
      fileDoc.photo = {
        file_id: fileDoc.video.thumb_file_id,
        file_unique_id: (fileDoc.video.file_unique_id || 'cached') + '_thumb',
      };
    }

    // 智能文件提取
    const mainFile = fileDoc.video || fileDoc.document;
    const thumbnail = fileDoc.video?.thumbnail || 
      (fileDoc.video?.thumb_file_id && {
        file_id: fileDoc.video.thumb_file_id,
        file_unique_id: fileDoc.video.file_unique_id + '_thumb'
      });

    const isPhoto = !!fileDoc.photo;
    const isThumbnail = !isPhoto && thumbnail && (fileId === thumbnail.file_id);
    const isVideo = !isPhoto && !isThumbnail && !!fileDoc.video;
    const isDocument = !isPhoto && !isThumbnail && !!fileDoc.document;

    const file = isPhoto ? fileDoc.photo : 
                isThumbnail ? thumbnail : 
                mainFile;

    const fileType = isPhoto ? 'photo' : 
                    isThumbnail ? 'thumbnail' : 
                    isVideo ? 'video' : 'document';

    const uniqueId = file.file_unique_id || 'cached';

    return { file, fileType, uniqueId, isPhoto, isThumbnail, isVideo, isDocument };
  }

  classifyFile(file, fileType) {
    const fileSize = file.file_size;
    const isPhoto = fileType === 'photo';
    const isThumbnail = fileType === 'thumbnail';
    const isSmallFile = fileSize && fileSize < 20 * 1024 * 1024;

    return { isPhoto, isThumbnail, isSmallFile, fileSize };
  }
  
  getFileExtension(filePath) {
    return path.extname(filePath) || '';
  }
}

module.exports = FileType;
