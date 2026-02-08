function listMessageIdsByUserIds(db, userIds) {
  const ids = (userIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const senderIds = db.prepare(
    `SELECT id FROM messages WHERE sender_id IN (${placeholders})`
  ).all(...ids).map(r => r.id);
  const recipientIds = db.prepare(
    `SELECT DISTINCT message_id AS id FROM recipients WHERE user_id IN (${placeholders})`
  ).all(...ids).map(r => r.id);
  return Array.from(new Set([...senderIds, ...recipientIds]));
}

function listAttachmentNamesByMessageIds(db, messageIds) {
  const ids = (messageIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(
    `SELECT storage_name FROM attachments WHERE message_id IN (${placeholders})`
  ).all(...ids).map(r => r.storage_name);
}

function cleanupSchool(db, schoolId) {
  if (!Number.isFinite(schoolId)) return { messageIds: [], attachmentNames: [], userIds: [] };
  const tx = db.transaction(() => {
    const courseIds = db.prepare('SELECT id FROM courses WHERE school_id=?').all(schoolId).map(r => r.id);
    const userIds = new Set();

    db.prepare('SELECT id FROM users WHERE school_id=?').all(schoolId).forEach(r => userIds.add(r.id));

    if (courseIds.length) {
      const placeholders = courseIds.map(() => '?').join(',');
      db.prepare(`SELECT id FROM users WHERE course_id IN (${placeholders})`).all(...courseIds)
        .forEach(r => userIds.add(r.id));
      db.prepare(`
        SELECT DISTINCT u.id
        FROM users u
        JOIN teacher_courses tc ON tc.user_id=u.id
        WHERE tc.course_id IN (${placeholders})
      `).all(...courseIds).forEach(r => userIds.add(r.id));
    }

    const ids = Array.from(userIds);
    const messageIds = listMessageIdsByUserIds(db, ids);
    const attachmentNames = listAttachmentNamesByMessageIds(db, messageIds);

    if (messageIds.length) {
      const placeholders = messageIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...messageIds);
    }

    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
    }

    if (courseIds.length) {
      const placeholders = courseIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM courses WHERE id IN (${placeholders})`).run(...courseIds);
    }

    db.prepare('DELETE FROM schools WHERE id=?').run(schoolId);

    return { messageIds, attachmentNames, userIds: ids };
  });

  return tx();
}

function cleanupCourse(db, courseId) {
  if (!Number.isFinite(courseId)) return { messageIds: [], attachmentNames: [], userIds: [] };
  const tx = db.transaction(() => {
    const userIds = new Set();

    db.prepare('SELECT id FROM users WHERE role=? AND course_id=?')
      .all('student', courseId)
      .forEach(r => userIds.add(r.id));

    const teachersToDelete = db.prepare(`
      SELECT u.id
      FROM users u
      JOIN teacher_courses tc ON tc.user_id=u.id
      WHERE tc.course_id=?
        AND u.role='teacher'
        AND NOT EXISTS (
          SELECT 1 FROM teacher_courses tc2
          WHERE tc2.user_id=u.id AND tc2.course_id!=?
        )
    `).all(courseId, courseId).map(r => r.id);
    teachersToDelete.forEach(id => userIds.add(id));

    const ids = Array.from(userIds);
    const messageIds = listMessageIdsByUserIds(db, ids);
    const attachmentNames = listAttachmentNamesByMessageIds(db, messageIds);

    if (messageIds.length) {
      const placeholders = messageIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...messageIds);
    }

    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
    }

    db.prepare('DELETE FROM teacher_courses WHERE course_id=?').run(courseId);
    db.prepare('DELETE FROM courses WHERE id=?').run(courseId);

    return { messageIds, attachmentNames, userIds: ids };
  });

  return tx();
}

module.exports = { cleanupSchool, cleanupCourse };
