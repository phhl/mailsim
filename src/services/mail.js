const { z } = require('zod');
const { sanitizeBody, htmlToText } = require('../lib/sanitize');

const ComposeSchema = z.object({
  to: z.array(z.number().int()).default([]),
  cc: z.array(z.number().int()).default([]),
  bcc: z.array(z.number().int()).default([]),
  subject: z.string().trim().min(1).max(200),
  body_html: z.string().default(''),
  action: z.enum(['send','draft']).default('send'),
  parent_message_id: z.number().int().nullable().optional(),
  thread_id: z.number().int().nullable().optional()
});

function createThread(db) {
  const res = db.prepare('INSERT INTO threads DEFAULT VALUES').run();
  return res.lastInsertRowid;
}

function createMessage(db, senderId, data) {
  const body_html = sanitizeBody(data.body_html);
  const body_text = htmlToText(body_html);

  const isDraft = data.action === 'draft' ? 1 : 0;

  let threadId = data.thread_id;
  if (!threadId) threadId = createThread(db);

  const res = db.prepare(`
    INSERT INTO messages(sender_id, subject, body_html, body_text, thread_id, parent_message_id, is_draft)
    VALUES (?,?,?,?,?,?,?)
  `).run(senderId, data.subject, body_html, body_text, threadId, data.parent_message_id || null, isDraft);

  return { messageId: res.lastInsertRowid, threadId, isDraft };
}

function addRecipients(db, messageId, ids, type) {
  const ins = db.prepare('INSERT INTO recipients(message_id, user_id, type) VALUES (?,?,?)');
  for (const uid of ids) ins.run(messageId, uid, type);
}

function addDelivery(db, messageId, ownerUserId, folder, isRead=0) {
  db.prepare('INSERT INTO deliveries(message_id, owner_user_id, folder, is_read) VALUES (?,?,?,?)')
    .run(messageId, ownerUserId, folder, isRead ? 1 : 0);
}

function applyDeliveriesAndLogs(db, { messageId, senderId, to, cc, bcc, isDraft }) {
  if (isDraft) {
    addDelivery(db, messageId, senderId, 'DRAFTS', 1);
    return;
  }

  addDelivery(db, messageId, senderId, 'SENT', 1);
  for (const uid of [...to, ...cc, ...bcc]) addDelivery(db, messageId, uid, 'INBOX', 0);

  const logRes = db.prepare('INSERT INTO mail_logs(message_id, sender_id) VALUES (?,?)').run(messageId, senderId);
  const logId = logRes.lastInsertRowid;
  const insLogRec = db.prepare('INSERT INTO mail_log_recipients(log_id, user_id, type) VALUES (?,?,?)');
  for (const uid of to) insLogRec.run(logId, uid, 'TO');
  for (const uid of cc) insLogRec.run(logId, uid, 'CC');
  for (const uid of bcc) insLogRec.run(logId, uid, 'BCC');
}

function normalizeRecipients(senderId, data) {
  const seen = new Set();
  const norm = (arr) => arr.filter(id => {
    if (id === senderId) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return {
    to: norm(data.to),
    cc: norm(data.cc),
    bcc: norm(data.bcc)
  };
}

function sendOrDraft(db, sender, payload) {
  const senderId = sender.id;

  const data = ComposeSchema.parse(payload);

  // De-dup recipients across TO/CC/BCC, keeping first occurrence order
  const { to, cc, bcc } = normalizeRecipients(senderId, data);

  // BCC ist erlaubt (auch für Schüler:innen). In der Schüleransicht wird die BCC-Liste später ausgeblendet.

  if (data.action === 'send' && (to.length + cc.length + bcc.length) === 0) {
    throw new Error('Mindestens ein Empfänger (To/CC/BCC) ist erforderlich.');
  }

  const tx = db.transaction(() => {
    const { messageId, threadId, isDraft } = createMessage(db, senderId, data);

    // store recipients even for drafts (optional). Here we do store.
    addRecipients(db, messageId, to, 'TO');
    addRecipients(db, messageId, cc, 'CC');
    addRecipients(db, messageId, bcc, 'BCC');

    applyDeliveriesAndLogs(db, { messageId, senderId, to, cc, bcc, isDraft: !!isDraft });
    return { messageId, threadId, isDraft };
  });

  return tx();
}

function updateDraftOrSend(db, sender, payload, draftId) {
  const senderId = sender.id;
  const data = ComposeSchema.parse(payload);

  const draft = db.prepare(
    'SELECT id, thread_id, parent_message_id FROM messages WHERE id=? AND sender_id=? AND is_draft=1',
  ).get(draftId, senderId);
  if (!draft) throw new Error('Entwurf nicht gefunden.');

  const { to, cc, bcc } = normalizeRecipients(senderId, data);
  if (data.action === 'send' && (to.length + cc.length + bcc.length) === 0) {
    throw new Error('Mindestens ein Empfaenger (To/CC/BCC) ist erforderlich.');
  }

  const tx = db.transaction(() => {
    const body_html = sanitizeBody(data.body_html);
    const body_text = htmlToText(body_html);
    const isDraft = data.action === 'draft' ? 1 : 0;

    db.prepare(
      'UPDATE messages SET subject=?, body_html=?, body_text=?, is_draft=? WHERE id=? AND sender_id=?',
    ).run(data.subject, body_html, body_text, isDraft, draftId, senderId);

    db.prepare('DELETE FROM recipients WHERE message_id=?').run(draftId);
    addRecipients(db, draftId, to, 'TO');
    addRecipients(db, draftId, cc, 'CC');
    addRecipients(db, draftId, bcc, 'BCC');

    db.prepare('DELETE FROM deliveries WHERE message_id=?').run(draftId);

    applyDeliveriesAndLogs(db, { messageId: draftId, senderId, to, cc, bcc, isDraft: !!isDraft });

    return { messageId: draftId, threadId: draft.thread_id, isDraft: !!isDraft };
  });

  return tx();
}

module.exports = { sendOrDraft, updateDraftOrSend, ComposeSchema };
