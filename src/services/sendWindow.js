function isSendWindowOpen(db, courseId) {
  if (!courseId) return false;
  const row = db.prepare('SELECT open_until FROM course_send_windows WHERE course_id=?').get(courseId);
  if (!row || !row.open_until) return false;
  const now = new Date();
  const until = new Date(row.open_until);
  return now <= until;
}

function isAttachmentsEnabled(db, courseId) {
  if (!courseId) return false;
  const row = db.prepare('SELECT attachments_enabled FROM course_send_windows WHERE course_id=?').get(courseId);
  return !!row?.attachments_enabled;
}

function setSendWindow(db, courseId, minutes, attachmentsEnabled = false) {
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO course_send_windows(course_id, open_until, attachments_enabled, updated_at)
    VALUES (?,?,?, datetime('now'))
    ON CONFLICT(course_id) DO UPDATE SET open_until=excluded.open_until, attachments_enabled=excluded.attachments_enabled, updated_at=datetime('now')
  `).run(courseId, until, attachmentsEnabled ? 1 : 0);
  return until;
}

function closeSendWindow(db, courseId) {
  db.prepare(`
    INSERT INTO course_send_windows(course_id, open_until, attachments_enabled, updated_at)
    VALUES (?,?,?, datetime('now'))
    ON CONFLICT(course_id) DO UPDATE SET open_until=NULL, attachments_enabled=0, updated_at=datetime('now')
  `).run(courseId, null, 0);
}

module.exports = { isSendWindowOpen, isAttachmentsEnabled, setSendWindow, closeSendWindow };
