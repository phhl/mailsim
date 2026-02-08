require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { openDb } = require('../db');

const DB_PATH = process.env.DB_PATH || './data/app.db';
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR
  ? path.resolve(process.env.ATTACHMENTS_DIR)
  : path.join(__dirname, '..', '..', 'data', 'attachments');

const PASSWORD = 'test123!';
const PW_HASH = bcrypt.hashSync(PASSWORD, 12);

const db = openDb(DB_PATH);

const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0;
if (existingUsers > 0 && process.env.SEED_FORCE !== '1') {
  const nonAdminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role!='admin'").get()?.count || 0;
  if (nonAdminCount > 0) {
    console.log('Seed aborted: database already has users. Set SEED_FORCE=1 to proceed.');
    process.exit(1);
  }
  console.log('Only admin users found. Proceeding with seed.');
}

if (process.env.SEED_FORCE === '1') {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM attachments;
    DELETE FROM mail_log_recipients;
    DELETE FROM mail_logs;
    DELETE FROM deliveries;
    DELETE FROM recipients;
    DELETE FROM messages;
    DELETE FROM threads;
    DELETE FROM teacher_courses;
    DELETE FROM users;
    DELETE FROM courses;
    DELETE FROM schools;
    DELETE FROM course_send_windows;
    PRAGMA foreign_keys = ON;
  `);
  console.log('SEED_FORCE=1: cleared existing data.');
}

if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

const insertSchool = db.prepare('INSERT INTO schools(name, domain) VALUES (?, ?)');
const insertCourse = db.prepare('INSERT INTO courses(name, school_id) VALUES (?, ?)');
const insertUser = db.prepare(
  'INSERT INTO users(username, display_name, role, course_id, school_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?,?)'
);
const insertTeacherCourse = db.prepare('INSERT INTO teacher_courses(user_id, course_id) VALUES (?, ?)');

const insertThread = db.prepare('INSERT INTO threads DEFAULT VALUES');
const insertMessage = db.prepare(`
  INSERT INTO messages(sender_id, subject, body_html, body_text, thread_id, parent_message_id, is_draft)
  VALUES (?,?,?,?,?,?,?)
`);
const insertRecipient = db.prepare('INSERT INTO recipients(message_id, user_id, type) VALUES (?,?,?)');
const insertDelivery = db.prepare('INSERT INTO deliveries(message_id, owner_user_id, folder, is_read) VALUES (?,?,?,?)');
const insertLog = db.prepare('INSERT INTO mail_logs(message_id, sender_id) VALUES (?,?)');
const insertLogRec = db.prepare('INSERT INTO mail_log_recipients(log_id, user_id, type) VALUES (?,?,?)');
const insertAttachment = db.prepare(`
  INSERT INTO attachments(message_id, original_name, storage_name, mime_type, size_bytes)
  VALUES (?,?,?,?,?)
`);
const getFirstStudent = db.prepare(
  "SELECT id FROM users WHERE role='student' AND course_id=? ORDER BY id LIMIT 1"
);
const getFirstTeacher = db.prepare(`
  SELECT u.id
  FROM users u
  JOIN teacher_courses tc ON tc.user_id=u.id
  WHERE u.role='teacher' AND tc.course_id=?
  ORDER BY u.id
  LIMIT 1
`);

function createMessage({
  senderId,
  to = [],
  cc = [],
  bcc = [],
  subject,
  bodyText,
  isDraft = false,
  threadId = null,
  parentMessageId = null
}) {
  const html = `<p>${bodyText}</p>`;
  const thread = threadId || insertThread.run().lastInsertRowid;
  const msgId = insertMessage.run(senderId, subject, html, bodyText, thread, parentMessageId, isDraft ? 1 : 0)
    .lastInsertRowid;

  for (const uid of to) insertRecipient.run(msgId, uid, 'TO');
  for (const uid of cc) insertRecipient.run(msgId, uid, 'CC');
  for (const uid of bcc) insertRecipient.run(msgId, uid, 'BCC');

  if (isDraft) {
    insertDelivery.run(msgId, senderId, 'DRAFTS', 1);
    return { messageId: msgId, threadId: thread };
  }

  insertDelivery.run(msgId, senderId, 'SENT', 1);
  for (const uid of [...to, ...cc, ...bcc]) insertDelivery.run(msgId, uid, 'INBOX', 0);

  const logId = insertLog.run(msgId, senderId).lastInsertRowid;
  for (const uid of to) insertLogRec.run(logId, uid, 'TO');
  for (const uid of cc) insertLogRec.run(logId, uid, 'CC');
  for (const uid of bcc) insertLogRec.run(logId, uid, 'BCC');

  return { messageId: msgId, threadId: thread };
}

function attachTextFile(messageId, label) {
  const storageName = crypto.randomBytes(8).toString('hex') + '.txt';
  const filePath = path.join(ATTACHMENTS_DIR, storageName);
  const content = `Attachment for ${label}`;
  fs.writeFileSync(filePath, content, 'utf-8');
  insertAttachment.run(
    messageId,
    `${label}.txt`,
    storageName,
    'text/plain',
    Buffer.byteLength(content)
  );
}

const tx = db.transaction(() => {
  const schoolAId = insertSchool.run('Alpha School', 'alpha.edu').lastInsertRowid;
  const schoolBId = insertSchool.run('Beta School', 'beta.edu').lastInsertRowid;

  const courseA1Id = insertCourse.run('A1', schoolAId).lastInsertRowid;
  const courseA2Id = insertCourse.run('A2', schoolAId).lastInsertRowid;
  const courseB1Id = insertCourse.run('B1', schoolBId).lastInsertRowid;

  let adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id || null;
  if (!adminId) {
    adminId = insertUser.run('admin', 'Admin', 'admin', null, null, PW_HASH, null).lastInsertRowid;
  }
  const schoolAdminAId = insertUser.run('sa_alpha', 'Schuladmin Alpha', 'schooladmin', null, schoolAId, PW_HASH, null).lastInsertRowid;
  const schoolAdminBId = insertUser.run('sa_beta', 'Schuladmin Beta', 'schooladmin', null, schoolBId, PW_HASH, null).lastInsertRowid;

  const teacherA1Id = insertUser.run('t_a1', 'Lehrkraft A1', 'teacher', null, schoolAId, PW_HASH, null).lastInsertRowid;
  const teacherA2Id = insertUser.run('t_a2', 'Lehrkraft A2', 'teacher', null, schoolAId, PW_HASH, null).lastInsertRowid;
  const teacherASharedId = insertUser.run('t_a_shared', 'Lehrkraft A Shared', 'teacher', null, schoolAId, PW_HASH, null).lastInsertRowid;
  const teacherB1Id = insertUser.run('t_b1', 'Lehrkraft B1', 'teacher', null, schoolBId, PW_HASH, null).lastInsertRowid;

  insertTeacherCourse.run(teacherA1Id, courseA1Id);
  insertTeacherCourse.run(teacherA2Id, courseA2Id);
  insertTeacherCourse.run(teacherASharedId, courseA1Id);
  insertTeacherCourse.run(teacherASharedId, courseA2Id);
  insertTeacherCourse.run(teacherB1Id, courseB1Id);

  const studentA1_1 = insertUser.run('s_a1_1', 'Schueler A1-1', 'student', courseA1Id, null, PW_HASH, null).lastInsertRowid;
  const studentA1_2 = insertUser.run('s_a1_2', 'Schueler A1-2', 'student', courseA1Id, null, PW_HASH, null).lastInsertRowid;
  const studentA2_1 = insertUser.run('s_a2_1', 'Schueler A2-1', 'student', courseA2Id, null, PW_HASH, null).lastInsertRowid;
  const studentA2_2 = insertUser.run('s_a2_2', 'Schueler A2-2', 'student', courseA2Id, null, PW_HASH, null).lastInsertRowid;
  const studentB1_1 = insertUser.run('s_b1_1', 'Schueler B1-1', 'student', courseB1Id, null, PW_HASH, null).lastInsertRowid;

  // Send windows (A1 open, attachments allowed)
  db.prepare(`
    INSERT INTO course_send_windows(course_id, open_until, attachments_enabled, updated_at)
    VALUES (?,?,?, datetime('now'))
    ON CONFLICT(course_id) DO UPDATE SET open_until=excluded.open_until, attachments_enabled=excluded.attachments_enabled, updated_at=datetime('now')
  `).run(courseA1Id, new Date(Date.now() + 60 * 60 * 1000).toISOString(), 1);

  // Threaded conversation with CC/BCC and attachment
  const first = createMessage({
    senderId: studentA1_1,
    to: [teacherA1Id],
    cc: [teacherASharedId],
    bcc: [schoolAdminAId],
    subject: 'Willkommen im Kurs A1',
    bodyText: 'Hallo, ich habe eine Frage zum Kurs.'
  });
  attachTextFile(first.messageId, 'frage-a1');

  createMessage({
    senderId: teacherA1Id,
    to: [studentA1_1],
    subject: 'Re: Willkommen im Kurs A1',
    bodyText: 'Gerne, worum geht es genau?',
    threadId: first.threadId,
    parentMessageId: first.messageId
  });

  // Cross-course teacher message
  createMessage({
    senderId: teacherASharedId,
    to: [studentA2_1],
    subject: 'Hinweis A2',
    bodyText: 'Bitte denkt an die Abgabe am Freitag.'
  });

  // Student to student within course
  createMessage({
    senderId: studentA2_1,
    to: [studentA2_2],
    subject: 'Gruppenarbeit',
    bodyText: 'Wollen wir heute lernen?'
  });

  // Schooladmin to teacher
  createMessage({
    senderId: schoolAdminAId,
    to: [teacherA2Id],
    subject: 'Kursplanung',
    bodyText: 'Bitte melde die geplanten Termine.'
  });

  // Admin to schooladmin
  createMessage({
    senderId: adminId,
    to: [schoolAdminBId],
    subject: 'Bericht',
    bodyText: 'Bitte den Monatsbericht einreichen.'
  });

  // Draft message
  createMessage({
    senderId: teacherB1Id,
    to: [studentB1_1],
    subject: 'Entwurf: Einladung',
    bodyText: 'Das ist ein Entwurf.',
    isDraft: true
  });

  // Trash example: teacher B1 sends then moves to trash (simulate by updating delivery)
  const trashMsg = createMessage({
    senderId: teacherB1Id,
    to: [studentB1_1],
    subject: 'Wird geloescht',
    bodyText: 'Diese Mail landet im Papierkorb.'
  });
  db.prepare(
    "UPDATE deliveries SET folder='TRASH' WHERE message_id=? AND owner_user_id=?"
  ).run(trashMsg.messageId, teacherB1Id);

  // Mark a delivery read
  db.prepare(
    "UPDATE deliveries SET is_read=1 WHERE message_id=? AND owner_user_id=?"
  ).run(first.messageId, teacherA1Id);

  // Bulk mails per course for pagination
  const bulkPerCourse = 40;
  const bulkCourses = [
    { id: courseA1Id, label: 'A1' },
    { id: courseA2Id, label: 'A2' },
    { id: courseB1Id, label: 'B1' }
  ];
  for (const course of bulkCourses) {
    const studentRow = getFirstStudent.get(course.id);
    const teacherRow = getFirstTeacher.get(course.id);
    if (!studentRow || !teacherRow) continue;
    for (let i = 1; i <= bulkPerCourse; i += 1) {
      createMessage({
        senderId: studentRow.id,
        to: [teacherRow.id],
        subject: `Bulk S->T ${course.label} #${i}`,
        bodyText: `Bulk message ${i} from student to teacher in ${course.label}.`
      });
      createMessage({
        senderId: teacherRow.id,
        to: [studentRow.id],
        subject: `Bulk T->S ${course.label} #${i}`,
        bodyText: `Bulk message ${i} from teacher to student in ${course.label}.`
      });
    }
  }
});

tx();
console.log('Seed complete.');
console.log('Password for all users:', PASSWORD);
