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

function sendOrDraft(db, sender, payload) {
  const senderId = sender.id;
  const senderRole = sender.role;

  const data = ComposeSchema.parse(payload);

  // De-dup recipients across TO/CC/BCC, keeping first occurrence order
  const seen = new Set();
  const norm = (arr) => arr.filter(id => {
    if (id === senderId) return false; // don't allow self as recipient
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const to = norm(data.to);
  const cc = norm(data.cc);
  let bcc = norm(data.bcc);

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

    if (isDraft) {
      addDelivery(db, messageId, senderId, 'DRAFTS', 1);
    } else {
      // sender copy
      addDelivery(db, messageId, senderId, 'SENT', 1);
// recipients inbox
for (const uid of [...to, ...cc, ...bcc]) addDelivery(db, messageId, uid, 'INBOX', 0);

// Protokoll (ohne Inhalte)
const logRes = db.prepare('INSERT INTO mail_logs(message_id, sender_id) VALUES (?,?)').run(messageId, senderId);
const logId = logRes.lastInsertRowid;
const insLogRec = db.prepare('INSERT INTO mail_log_recipients(log_id, user_id, type) VALUES (?,?,?)');
for (const uid of to) insLogRec.run(logId, uid, 'TO');
for (const uid of cc) insLogRec.run(logId, uid, 'CC');
for (const uid of bcc) insLogRec.run(logId, uid, 'BCC');
    }
    return { messageId, threadId, isDraft };
  });

  return tx();
}

module.exports = { sendOrDraft, ComposeSchema };
