const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_MB = 10;
const DEFAULT_MAX_FILES = 10;

class AttachmentError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function getAttachmentConfig() {
  const maxMbRaw = Number(process.env.ATTACHMENTS_MAX_MB || DEFAULT_MAX_MB);
  const maxMb = Number.isFinite(maxMbRaw) ? Math.max(1, maxMbRaw) : DEFAULT_MAX_MB;
  const maxFilesRaw = Number(process.env.ATTACHMENTS_MAX_FILES || DEFAULT_MAX_FILES);
  const maxFiles = Number.isFinite(maxFilesRaw) ? Math.max(1, maxFilesRaw) : DEFAULT_MAX_FILES;
  return {
    maxBytes: maxMb * 1024 * 1024,
    maxFiles
  };
}

function getAttachmentsDir() {
  const base = process.env.ATTACHMENTS_DIR || path.join(__dirname, '..', '..', 'data', 'attachments');
  return path.resolve(base);
}

function ensureAttachmentsDir() {
  const dir = getAttachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeOriginalName(name) {
  const raw = (name || 'attachment').toString();
  const base = path.basename(raw);
  return base.replace(/[\r\n\0]/g, ' ').trim() || 'attachment';
}

function sniffFileType(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // PDF: %PDF-
  if (buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-') {
    return { mime: 'application/pdf', ext: '.pdf' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: '.png' };
  }

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' };
  }

  // GIF: GIF87a / GIF89a
  if (buffer.length >= 6) {
    const header = buffer.slice(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return { mime: 'image/gif', ext: '.gif' };
    }
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: '.webp' };
  }

  // HEIC/HEIF: ISO BMFF with ftyp box
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii');
    const heicBrands = new Set(['heic', 'heif', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
    if (heicBrands.has(brand)) {
      return { mime: 'image/heic', ext: '.heic' };
    }
  }

  return null;
}

function writeAttachmentFile(buffer, ext) {
  const dir = ensureAttachmentsDir();
  const filename = crypto.randomBytes(16).toString('hex') + ext;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer, { flag: 'wx' });
  return { filename, fullPath };
}

function saveAttachments(db, messageId, files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return [];

  const { maxBytes } = getAttachmentConfig();
  const storedPaths = [];
  const results = [];

  const tx = db.transaction(() => {
    for (const file of list) {
      if (!file || !file.buffer) continue;
      if (file.size > maxBytes) throw new AttachmentError('size');

      const typeInfo = sniffFileType(file.buffer);
      if (!typeInfo) throw new AttachmentError('type');

      const { filename, fullPath } = writeAttachmentFile(file.buffer, typeInfo.ext);
      storedPaths.push(fullPath);

      const originalName = sanitizeOriginalName(file.originalname);
      const res = db.prepare(`
        INSERT INTO attachments(message_id, original_name, storage_name, mime_type, size_bytes)
        VALUES (?,?,?,?,?)
      `).run(messageId, originalName, filename, typeInfo.mime, file.size);

      results.push({
        id: res.lastInsertRowid,
        message_id: messageId,
        original_name: originalName,
        storage_name: filename,
        mime_type: typeInfo.mime,
        size_bytes: file.size
      });
    }
  });

  try {
    tx();
  } catch (err) {
    for (const p of storedPaths) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
    throw err;
  }

  return results;
}

function listAttachmentsForMessage(db, messageId) {
  return db.prepare(`
    SELECT id, message_id, original_name, storage_name, mime_type, size_bytes, created_at
    FROM attachments
    WHERE message_id=?
    ORDER BY id
  `).all(messageId);
}

function getAttachmentById(db, attachmentId) {
  return db.prepare(`
    SELECT id, message_id, original_name, storage_name, mime_type, size_bytes, created_at
    FROM attachments
    WHERE id=?
  `).get(attachmentId);
}

function collectStorageNamesByUserIds(db, userIds) {
  const ids = (userIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT a.storage_name
    FROM attachments a
    JOIN messages m ON m.id=a.message_id
    WHERE m.sender_id IN (${placeholders})
  `).all(...ids).map(r => r.storage_name);
}

function collectStorageNamesByCourseId(db, courseId) {
  if (!Number.isFinite(courseId)) return [];
  return db.prepare(`
    SELECT a.storage_name
    FROM attachments a
    JOIN messages m ON m.id=a.message_id
    JOIN users u ON u.id=m.sender_id
    WHERE u.course_id=?
  `).all(courseId).map(r => r.storage_name);
}

function collectStorageNamesBySchoolId(db, schoolId) {
  if (!Number.isFinite(schoolId)) return [];
  return db.prepare(`
    SELECT a.storage_name
    FROM attachments a
    JOIN messages m ON m.id=a.message_id
    JOIN users u ON u.id=m.sender_id
    LEFT JOIN courses c ON c.id=u.course_id
    WHERE c.school_id=? OR u.school_id=?
  `).all(schoolId, schoolId).map(r => r.storage_name);
}

function deleteAttachmentFiles(storageNames) {
  const names = Array.isArray(storageNames) ? storageNames : [];
  if (!names.length) return;
  const dir = getAttachmentsDir();
  for (const name of names) {
    const fullPath = path.join(dir, name);
    try { fs.unlinkSync(fullPath); } catch (_) {}
  }
}

function getAttachmentPath(storageName) {
  return path.join(getAttachmentsDir(), storageName);
}

module.exports = {
  AttachmentError,
  getAttachmentConfig,
  getAttachmentsDir,
  sanitizeOriginalName,
  sniffFileType,
  saveAttachments,
  listAttachmentsForMessage,
  getAttachmentById,
  collectStorageNamesByUserIds,
  collectStorageNamesByCourseId,
  collectStorageNamesBySchoolId,
  deleteAttachmentFiles,
  getAttachmentPath
};
