const express = require("express");
const bcrypt = require("bcryptjs");
const { parse } = require("csv-parse/sync");

const { requireRole } = require("../middleware/auth");
const { formatLogin } = require("../lib/address");
const { toBerlinLocal } = require("../utils/time");
const { csvFieldNoQuotes } = require("../utils/csv");
const { parseOptionalId } = require("../utils/parse");
const { getTeacherCourseIds } = require("../services/teacherCourses");
const {
  getNameBatch,
  buildUserSeeds,
  buildUsername,
  generateNameEntries,
  getRegionDefaults,
  getRegionKeys,
  getFirstNamesByRegion,
  getLastNamesByRegion,
  getAllFirstNamesForRegion,
  validateNameEntry,
} = require("../utils/nameGenerator");
const {
  isSendWindowOpen,
  isAttachmentsEnabled,
  setSendWindow,
  closeSendWindow,
} = require("../services/sendWindow");
const {
  collectStorageNamesByUserIds,
  deleteAttachmentFiles,
} = require("../services/attachments");

module.exports = function createTeacherRouter({ db }) {
  const router = express.Router();
  const renderForbidden = (req, res) => {
    return res.status(403).render("error", {
      title: req.t("errors.title"),
      message: req.t("errors.not_allowed"),
      backUrl: req.get("referer") || "/teacher",
    });
  };

  function canManageCourse(role, meId, courseId) {
    if (!Number.isFinite(courseId)) return false;
    if (role === "admin") return true;
    if (role === "schooladmin") {
      const meSchool = db
        .prepare("SELECT school_id FROM users WHERE id=?")
        .get(meId)?.school_id;
      const courseSchool = db
        .prepare("SELECT school_id FROM courses WHERE id=?")
        .get(courseId)?.school_id;
      return !!meSchool && meSchool === courseSchool;
    }
    if (role === "teacher") {
      const ids = getTeacherCourseIds(db, meId);
      return ids.includes(courseId);
    }
    return false;
  }

  function getCoursesByIds(ids) {
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(",");
    return db
      .prepare(
        `SELECT id, name FROM courses WHERE id IN (${placeholders}) ORDER BY name`,
      )
      .all(...ids);
  }

  function canCreateAccounts(role) {
    return (
      role === "admin" ||
      role === "schooladmin" ||
      (process.env.TEACHER_CAN_CREATE || "0") === "1"
    );
  }

  function buildTeacherRedirect(req, courseId) {
    const params = new URLSearchParams();
    if (Number.isFinite(courseId) && courseId > 0)
      params.set("course_id", String(courseId));
    const schoolId = Number(req.body.school_id || 0);
    if (Number.isFinite(schoolId) && schoolId > 0)
      params.set("school_id", String(schoolId));
    const teacherId = Number(req.body.teacher_id || 0);
    if (Number.isFinite(teacherId) && teacherId > 0)
      params.set("teacher_id", String(teacherId));
    const qs = params.toString();
    return "/teacher" + (qs ? `?${qs}` : "");
  }

  function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeWeights(weights, keys, options = {}) {
    const normalized = {};
    const normalizeToHundred = options.normalize !== false;
    const totalRaw = keys.reduce(
      (sum, key) => sum + Math.max(0, toNumber(weights[key], 0)),
      0,
    );
    if (!totalRaw) {
      const equal = keys.length ? 100 / keys.length : 0;
      keys.forEach((key) => {
        normalized[key] = equal;
      });
      return { normalized, total: 0, warning: true };
    }
    keys.forEach((key) => {
      const value = Math.max(0, toNumber(weights[key], 0));
      normalized[key] = normalizeToHundred ? (value / totalRaw) * 100 : value;
    });
    return {
      normalized,
      total: totalRaw,
      warning: Math.round(totalRaw) !== 100,
    };
  }

  function parseGeneratorConfig(body, maxCount) {
    const mode = (body.mode || "simple").toString().trim().toLowerCase();
    const comboMode = (body.combo_mode || "typical")
      .toString()
      .trim()
      .toLowerCase();
    const prefix = (body.prefix || "").toString().trim();
    const expiresAt = (body.expires_at || "").toString().trim() || null;
    const passwordGlobal = (body.password_global || "").toString().trim();
    const regionKeys = getRegionKeys();

    const reduceCounts = (counts, maxTotal) => {
      let total = Object.values(counts).reduce((sum, v) => sum + v, 0);
      let overflow = total - maxTotal;
      const order = ["neutral", "male", "female"];
      while (overflow > 0) {
        let reduced = false;
        for (const key of order) {
          if (counts[key] > 0) {
            counts[key] -= 1;
            overflow -= 1;
            reduced = true;
            break;
          }
        }
        if (!reduced) break;
      }
      total = Object.values(counts).reduce((sum, v) => sum + v, 0);
      return { counts, total };
    };

    if (mode === "advanced") {
      const regionGenderCounts = {};
      const summaryRegions = {};
      let total = 0;
      regionKeys.forEach((key) => {
        const counts = {
          female: toNumber(body[`region_count_${key}_female`], 0),
          male: toNumber(body[`region_count_${key}_male`], 0),
          neutral: toNumber(body[`region_count_${key}_neutral`], 0),
        };
        const regionTotal = Object.values(counts).reduce(
          (sum, v) => sum + v,
          0,
        );
        if (regionTotal > 0) {
          regionGenderCounts[key] = counts;
          summaryRegions[key] = regionTotal;
          total += regionTotal;
        }
      });

      const totalRaw = total;
      if (total > maxCount) {
        const keys = Object.keys(regionGenderCounts);
        let overflow = total - maxCount;
        const order = ["neutral", "male", "female"];
        for (const gender of order) {
          for (const key of keys) {
            while (overflow > 0 && regionGenderCounts[key][gender] > 0) {
              regionGenderCounts[key][gender] -= 1;
              summaryRegions[key] -= 1;
              overflow -= 1;
              if (summaryRegions[key] === 0) delete summaryRegions[key];
            }
            if (overflow <= 0) break;
          }
          if (overflow <= 0) break;
        }
        total = Object.values(regionGenderCounts).reduce(
          (sum, counts) => sum + counts.female + counts.male + counts.neutral,
          0,
        );
      }

      const gendersSummary = {
        female: 0,
        male: 0,
        neutral: 0,
      };
      Object.values(regionGenderCounts).forEach((counts) => {
        gendersSummary.female += counts.female;
        gendersSummary.male += counts.male;
        gendersSummary.neutral += counts.neutral;
      });

      const regions = Object.keys(regionGenderCounts);
      const regionWeights = {};
      regions.forEach((key) => {
        regionWeights[key] = summaryRegions[key] || 0;
      });

      const normalizedCounts = {};
      regions.forEach((key) => {
        normalizedCounts[key] = {
          female: regionGenderCounts[key].female,
          male: regionGenderCounts[key].male,
          diverse: regionGenderCounts[key].neutral,
        };
      });

      return {
        count: Math.min(total, maxCount),
        mode,
        regions,
        regionWeights,
        regionGenderCounts: normalizedCounts,
        genderCounts: null,
        genderWeights: {},
        regionWarning: regions.length === 0,
        genderWarning: totalRaw > maxCount || totalRaw === 0,
        uniqueNames: true,
        comboMode,
        prefix,
        expiresAt,
        passwordGlobal,
        summaryGenders: gendersSummary,
        summaryRegions,
      };
    }

    const simpleCounts = {
      female: toNumber(body.gender_count_female, 0),
      male: toNumber(body.gender_count_male, 0),
      neutral: toNumber(body.gender_count_neutral, 0),
    };
    const totalRawSimple = Object.values(simpleCounts).reduce(
      (sum, v) => sum + v,
      0,
    );
    const reduced = reduceCounts(simpleCounts, maxCount);
    const total = reduced.total;
    const genderCounts = {
      female: reduced.counts.female,
      male: reduced.counts.male,
      diverse: reduced.counts.neutral,
    };
    const regionDefaults = getRegionDefaults();
    const regionWeights = {};
    regionKeys.forEach((key) => {
      regionWeights[key] = regionDefaults[key] || 0;
    });

    return {
      count: total,
      mode,
      regions: regionKeys,
      regionWeights,
      regionGenderCounts: null,
      genderCounts,
      genderWeights: {},
      regionWarning: false,
      genderWarning: totalRawSimple > maxCount || totalRawSimple === 0,
      uniqueNames: true,
      comboMode,
      prefix,
      expiresAt,
      passwordGlobal,
      summaryGenders: {
        female: reduced.counts.female,
        male: reduced.counts.male,
        neutral: reduced.counts.neutral,
      },
      summaryRegions: {},
    };
  }

  function getCourseContext(courseId) {
    return db
      .prepare(
        `
      SELECT c.id, c.name AS course_name, s.domain AS school_domain
      FROM courses c
      JOIN schools s ON s.id=c.school_id
      WHERE c.id=?
    `,
      )
      .get(courseId);
  }

  function buildExistingUsernameSet(courseId) {
    return new Set(
      db
        .prepare("SELECT username FROM users WHERE course_id=?")
        .all(courseId)
        .map((row) => row.username),
    );
  }

  function filterCreatedByExistingUsers(created) {
    if (!created.length) return [];
    const grouped = new Map();
    created.forEach((row) => {
      if (!row || !row.username || !row.course_id) return;
      const list = grouped.get(row.course_id) || [];
      list.push(row.username);
      grouped.set(row.course_id, list);
    });
    const existing = new Set();
    grouped.forEach((usernames, courseId) => {
      const unique = Array.from(new Set(usernames));
      const placeholders = unique.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT username FROM users WHERE course_id=? AND username IN (${placeholders})`,
        )
        .all(courseId, ...unique);
      rows.forEach((row) => existing.add(`${courseId}|${row.username}`));
    });
    return created.filter((row) =>
      existing.has(`${row.course_id}|${row.username}`),
    );
  }

  function makeNameKey(firstName, lastName) {
    return `${String(firstName || "")
      .trim()
      .toLowerCase()}|${String(lastName || "")
      .trim()
      .toLowerCase()}`;
  }

  function buildNameKeySet(entries, skipIndex) {
    const set = new Set();
    entries.forEach((row, idx) => {
      if (idx === skipIndex) return;
      set.add(makeNameKey(row.firstName, row.lastName));
    });
    return set;
  }

  function buildCreatedExportRows(createdRaw) {
    const created = filterCreatedByExistingUsers(createdRaw);
    let courseName = "";
    let schoolDomain = "";
    if (created[0]?.course_id) {
      const row = db
        .prepare(
          `
        SELECT c.name AS course_name, s.domain AS school_domain
        FROM courses c
        JOIN schools s ON s.id=c.school_id
        WHERE c.id=?
      `,
        )
        .get(created[0].course_id);
      courseName = row?.course_name || "";
      schoolDomain = row?.school_domain || "";
    }

    const rows = created.map((row) => ({
      login: formatLogin(
        {
          username: row.username,
          courseName: courseName || row.course || "",
          domain: schoolDomain,
          role: "student",
        },
        process.env,
      ),
      display_name: row.display_name,
      course: courseName || row.course || "",
      expires_at: row.expires_at || "",
      password: row.password || "",
      note: "",
    }));

    const lastNameOf = (name) => {
      const parts = String(name || "")
        .trim()
        .split(/\s+/);
      return parts.length ? parts[parts.length - 1].toLowerCase() : "";
    };
    rows.sort((a, b) => {
      const la = lastNameOf(a.display_name);
      const lb = lastNameOf(b.display_name);
      if (la !== lb) return la.localeCompare(lb, "de");
      return String(a.display_name || "").localeCompare(
        String(b.display_name || ""),
        "de",
      );
    });

    return { rows, courseName, schoolDomain };
  }

  function generateEntryForConstraints(
    { gender, regionFirst, regionLast },
    config,
    existingNames,
    existingUsernames,
  ) {
    const attemptsPerEntry = 40;
    let firstName = "";
    let lastName = "";
    for (let attempt = 0; attempt < attemptsPerEntry; attempt += 1) {
      if (gender === "female") {
        const list = getFirstNamesByRegion("female", regionFirst);
        firstName = list.length
          ? list[Math.floor(Math.random() * list.length)]
          : getAllFirstNamesForRegion(regionFirst)[0];
      } else if (gender === "male") {
        const list = getFirstNamesByRegion("male", regionFirst);
        firstName = list.length
          ? list[Math.floor(Math.random() * list.length)]
          : getAllFirstNamesForRegion(regionFirst)[0];
      } else if (gender === "diverse") {
        const list = getFirstNamesByRegion("diverse", regionFirst);
        if (list.length) {
          firstName = list[Math.floor(Math.random() * list.length)];
        } else {
          const pool = getAllFirstNamesForRegion(regionFirst);
          firstName = pool.length
            ? pool[Math.floor(Math.random() * pool.length)]
            : "Student";
        }
      } else {
        const pool = getAllFirstNamesForRegion(regionFirst);
        firstName = pool.length
          ? pool[Math.floor(Math.random() * pool.length)]
          : "Student";
      }

      const lastList = getLastNamesByRegion(regionLast);
      lastName = lastList.length
        ? lastList[Math.floor(Math.random() * lastList.length)]
        : "Meyer";

      const key = makeNameKey(firstName, lastName);
      if (!config.uniqueNames || !existingNames.has(key)) {
        existingNames.add(key);
        break;
      }
    }

    const displayName = `${firstName}${lastName ? " " + lastName : ""}`.trim();
    const username = buildUsername(
      { firstName, lastName, prefix: config.prefix },
      existingUsernames,
    );
    const region = regionFirst === regionLast ? regionFirst : "mixed";
    return {
      firstName,
      lastName,
      gender,
      regionFirst,
      regionLast,
      region,
      displayName,
      username,
      password: Math.random().toString(36).slice(2, 10) + "!",
    };
  }

  // ---------- Teacher ----------
  router.get(
    "/teacher",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      req.session.mailViewContext = "teacher";
      const meId = req.session.userId;
      const role = req.session.role;

      const me = db
        .prepare(
          `
      SELECT u.id, u.course_id, u.school_id, c.name AS course_name, s.name AS school_name, s.domain AS school_domain
      FROM users u
      LEFT JOIN courses c ON c.id=u.course_id
      LEFT JOIN schools s ON s.id=u.school_id
      WHERE u.id=?
    `,
        )
        .get(meId);

      const schools =
        role === "admin"
          ? db
              .prepare("SELECT id, name, domain FROM schools ORDER BY name")
              .all()
          : [];

      const hasSchoolQuery = Object.prototype.hasOwnProperty.call(
        req.query,
        "school_id",
      );
      const hasCourseQuery = Object.prototype.hasOwnProperty.call(
        req.query,
        "course_id",
      );
      const hasTeacherQuery = Object.prototype.hasOwnProperty.call(
        req.query,
        "teacher_id",
      );
      const lastFilters = req.session.teacherFilters || {};

      let selectedSchoolId =
        role === "admin"
          ? hasSchoolQuery
            ? parseOptionalId(req.query.school_id)
            : (lastFilters.schoolId ?? null)
          : role === "schooladmin"
            ? me?.school_id
            : null;

      const teachers =
        role === "schooladmin"
          ? db
              .prepare(
                `
          SELECT DISTINCT u.id, u.display_name, u.username
          FROM users u
          JOIN teacher_courses tc ON tc.user_id=u.id
          JOIN courses c ON c.id=tc.course_id
          WHERE u.role='teacher' AND c.school_id=?
          ORDER BY u.display_name
        `,
              )
              .all(me?.school_id ?? -1)
          : [];

      const selectedTeacherId =
        role === "schooladmin"
          ? hasTeacherQuery
            ? parseOptionalId(req.query.teacher_id) || teachers[0]?.id || null
            : (lastFilters.teacherId ?? teachers[0]?.id ?? null)
          : null;

      let courseOptions = [];
      if (role === "admin") {
        if (!Number.isFinite(selectedSchoolId) && !hasSchoolQuery) {
          const requestedCourseId = hasCourseQuery
            ? parseOptionalId(req.query.course_id)
            : (lastFilters.courseId ?? null);
          if (Number.isFinite(requestedCourseId)) {
            const inferredSchool = db
              .prepare("SELECT school_id FROM courses WHERE id=?")
              .get(requestedCourseId)?.school_id;
            if (Number.isFinite(inferredSchool))
              selectedSchoolId = inferredSchool;
          }
        }
        courseOptions = Number.isFinite(selectedSchoolId)
          ? db
              .prepare(
                "SELECT id, name FROM courses WHERE school_id=? ORDER BY name",
              )
              .all(selectedSchoolId)
          : [];
      } else if (role === "schooladmin") {
        if (Number.isFinite(selectedTeacherId)) {
          const ids = db
            .prepare("SELECT course_id FROM teacher_courses WHERE user_id=?")
            .all(selectedTeacherId)
            .map((r) => r.course_id);
          courseOptions = getCoursesByIds(ids);
        } else if (Number.isFinite(me?.school_id)) {
          courseOptions = db
            .prepare(
              "SELECT id, name FROM courses WHERE school_id=? ORDER BY name",
            )
            .all(me.school_id);
        }
      } else {
        courseOptions = getCoursesByIds(getTeacherCourseIds(db, meId));
      }

      const requestedCourseId =
        hasSchoolQuery && !Number.isFinite(selectedSchoolId)
          ? null
          : hasCourseQuery
            ? parseOptionalId(req.query.course_id)
            : hasSchoolQuery
              ? null
              : (lastFilters.courseId ?? null);
      const selectedCourseId = courseOptions.some(
        (c) => c.id === requestedCourseId,
      )
        ? requestedCourseId
        : role === "admin"
          ? null
          : (courseOptions[0]?.id ?? null);

      req.session.teacherFilters = {
        schoolId: selectedSchoolId ?? null,
        courseId: selectedCourseId ?? null,
        teacherId: selectedTeacherId ?? null,
      };

      const course = Number.isFinite(selectedCourseId)
        ? db
            .prepare("SELECT id, name FROM courses WHERE id=?")
            .get(selectedCourseId)
        : null;

      const canCreate =
        role === "admin" ||
        role === "schooladmin" ||
        (process.env.TEACHER_CAN_CREATE || "0") === "1";
      const windowOpen = Number.isFinite(selectedCourseId)
        ? isSendWindowOpen(db, selectedCourseId)
        : false;
      const row = Number.isFinite(selectedCourseId)
        ? db
            .prepare(
              "SELECT open_until, attachments_enabled FROM course_send_windows WHERE course_id=?",
            )
            .get(selectedCourseId)
        : null;

      const usersRaw = Number.isFinite(selectedCourseId)
        ? db
            .prepare(
              `
          SELECT u.id, u.username, u.display_name, u.role, u.expires_at,
                 c.name AS course_name, s.domain AS school_domain
          FROM users u
          LEFT JOIN courses c ON c.id=u.course_id
          LEFT JOIN schools s ON s.id=c.school_id
          WHERE u.course_id=? AND u.role='student'
          ORDER BY u.display_name
        `,
            )
            .all(selectedCourseId)
        : [];
      const users = usersRaw.map((u) => ({
        ...u,
        login: formatLogin(
          {
            username: u.username,
            courseName: u.course_name,
            domain: u.school_domain,
            role: "student",
          },
          process.env,
        ),
      }));

      // Post/Redirect/Get: show one-time import result after CSV upload
      const importResult = req.session.teacherImportResult || null;
      if (req.session.teacherImportResult)
        delete req.session.teacherImportResult;
      const userResult = req.session.teacherUserResult || null;
      if (req.session.teacherUserResult) delete req.session.teacherUserResult;

      // Course-wide sent overview (selected course)
      let sentOverview = [];
      const sentPageRaw = Number(req.query.sent_page || 1);
      const sentSizeRaw = Number(
        req.query.sent_page_size || req.session.sentPageSize || 20,
      );
      const sentPageSizes = [10, 20, 50, 100];
      const sentPageSize = sentPageSizes.includes(sentSizeRaw)
        ? sentSizeRaw
        : 20;
      req.session.sentPageSize = sentPageSize;
      let sentPage =
        Number.isFinite(sentPageRaw) && sentPageRaw > 0
          ? Math.floor(sentPageRaw)
          : 1;
      let sentTotal = 0;
      try {
        if (!Number.isFinite(selectedCourseId)) {
          sentOverview = [];
        } else {
          sentTotal =
            db
              .prepare(
                `
          SELECT COUNT(*) AS count
          FROM messages m
          JOIN deliveries d ON d.message_id = m.id AND d.folder IN ('SENT','TRASH') AND d.owner_user_id = m.sender_id
          JOIN users s ON s.id = m.sender_id
          WHERE m.is_draft = 0
            AND s.role = 'student'
            AND s.course_id = ?
        `,
              )
              .get(selectedCourseId)?.count || 0;
          const sentTotalPages = Math.max(
            1,
            Math.ceil(sentTotal / sentPageSize),
          );
          if (sentPage > sentTotalPages) sentPage = sentTotalPages;
          const sentOffset = (sentPage - 1) * sentPageSize;
          const params = [selectedCourseId, sentPageSize, sentOffset];
          const base = db
            .prepare(
              `
          SELECT
            m.id AS message_id,
            m.created_at,
            m.subject,
            m.body_html,
            m.body_text,
            s.display_name AS sender_name,
            s.username AS sender_username,
            c.name AS course_name,
            sc.domain AS course_domain,
            d.folder AS delivery_folder,
            d.deleted_at AS delivery_deleted_at
          FROM messages m
          JOIN deliveries d ON d.message_id = m.id AND d.folder IN ('SENT','TRASH') AND d.owner_user_id = m.sender_id
          JOIN users s ON s.id = m.sender_id
          LEFT JOIN courses c ON c.id = s.course_id
          LEFT JOIN schools sc ON sc.id=c.school_id
          WHERE m.is_draft = 0
            AND s.role = 'student'
            AND s.course_id = ?
          ORDER BY m.created_at DESC
          LIMIT ? OFFSET ?
        `,
            )
            .all(...params);

          const recStmt = db.prepare(`
        SELECT r.type, u.display_name, u.username, u.role AS user_role,
               c2.name AS course_name, s2.domain AS school_domain, us.domain AS user_domain
        FROM recipients r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN courses c2 ON c2.id = u.course_id
        LEFT JOIN schools s2 ON s2.id=c2.school_id
        LEFT JOIN schools us ON us.id=u.school_id
        WHERE r.message_id = ?
        ORDER BY CASE r.type WHEN 'TO' THEN 1 WHEN 'CC' THEN 2 ELSE 3 END, u.display_name
      `);

          sentOverview = base.map((m) => {
            const recRows = recStmt.all(m.message_id);
            const buckets = { TO: [], CC: [], BCC: [] };
            for (const r of recRows) {
              const email = formatLogin(
                {
                  username: r.username,
                  courseName: r.course_name,
                  domain: r.school_domain || r.user_domain,
                  role: r.user_role,
                },
                process.env,
              );
              buckets[r.type] = buckets[r.type] || [];
              buckets[r.type].push(`${r.display_name} <${email}>`);
            }

            const previewSource =
              m.body_text || (m.body_html || "").replace(/<[^>]*>/g, "");
            const preview = String(previewSource)
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);

            return {
              ...m,
              created_at_local: toBerlinLocal(m.created_at),
              sender_email: formatLogin(
                {
                  username: m.sender_username,
                  courseName: m.course_name,
                  domain: m.course_domain,
                  role: "student",
                },
                process.env,
              ),
              to_recipients: buckets.TO.join(", "),
              cc_recipients: buckets.CC.join(", "),
              bcc_recipients: buckets.BCC.join(", "),
              preview,
            };
          });
        }
      } catch (e) {
        // non-fatal; keep page usable
        sentOverview = [];
      }

      const openUntil = row?.open_until || null;
      const attachmentsEnabled =
        windowOpen && Number.isFinite(selectedCourseId)
          ? isAttachmentsEnabled(db, selectedCourseId)
          : false;
      const sendWindow = {
        is_open: windowOpen,
        open_until: openUntil,
        open_until_local: openUntil ? toBerlinLocal(openUntil) : null,
      };
      const courseDomain = Number.isFinite(selectedCourseId)
        ? db
            .prepare(
              `
          SELECT s.domain
          FROM courses c
          JOIN schools s ON s.id=c.school_id
          WHERE c.id=?
        `,
            )
            .get(selectedCourseId)?.domain
        : null;
      const createdAccounts = (importResult?.created || []).map((row) => ({
        ...row,
        login: formatLogin(
          {
            username: row.username,
            courseName: course?.name,
            domain: courseDomain,
            role: "student",
          },
          process.env,
        ),
      }));
      const sentTotalPages = Number.isFinite(selectedCourseId)
        ? Math.max(1, Math.ceil(sentTotal / sentPageSize))
        : 1;
      const defaultSendWindowMinutesRaw = Number(
        process.env.SEND_WINDOW_MINUTES || 45,
      );
      const sendWindowDefault = Number.isFinite(defaultSendWindowMinutesRaw)
        ? Math.max(1, Math.min(defaultSendWindowMinutesRaw, 240))
        : 45;
      const maxCountRaw = Number(process.env.TEACHER_AUTO_CREATE_MAX || 60);
      const maxCount = Number.isFinite(maxCountRaw) ? maxCountRaw : 60;

      const nameApiConfigured = !!(process.env.TEACHER_NAME_API_URL || "")
        .toString()
        .trim();

      const regionDefaults = getRegionDefaults();
      const regionOptions = getRegionKeys().map((key) => ({
        key,
        label: req.t(`teacher.region_${key}`) || key,
        weight: Math.round((regionDefaults[key] || 0) * 100),
      }));

      if (req.query.sent_only === "1") {
        const sentQuery = {};
        if (selectedSchoolId) sentQuery.school_id = selectedSchoolId;
        if (selectedTeacherId) sentQuery.teacher_id = selectedTeacherId;
        if (selectedCourseId) sentQuery.course_id = selectedCourseId;
        return res.render("partials/teacher_sent_table", {
          sentOverview,
          sentPagination: {
            page: sentPage,
            totalPages: sentTotalPages,
            totalRows: sentTotal,
            pageSize: sentPageSize,
            pageSizes: sentPageSizes,
          },
          sentQuery,
          basePath: "/teacher",
        });
      }

      return res.render("teacher", {
        me: res.locals.me,
        course,
        schools,
        selectedSchoolId,
        teachers,
        selectedTeacherId,
        courses: courseOptions,
        selectedCourseId,
        users,
        nameApiConfigured,
        regionOptions,
        maxAutoCreate: maxCount,
        canCreate,
        windowOpen,
        openUntil,
        sendWindow,
        createdAccounts,
        importResult,
        userResult,
        sentOverview,
        sendWindowDefault,
        attachmentsEnabled,
        sentPagination: {
          page: sentPage,
          totalPages: sentTotalPages,
          totalRows: sentTotal,
          pageSize: sentPageSize,
          pageSizes: sentPageSizes,
        },
      });
    },
  );

  router.post(
    "/teacher/send-window/open",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const meId = req.session.userId;
      const role = req.session.role;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const minutes = Number(
        req.body.minutes || process.env.SEND_WINDOW_MINUTES || 20,
      );
      const attachmentsEnabled = req.body.attachments_enabled === "1";
      setSendWindow(
        db,
        courseId,
        Math.max(1, Math.min(minutes, 240)),
        attachmentsEnabled,
      );
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.post(
    "/teacher/send-window/close",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const meId = req.session.userId;
      const role = req.session.role;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      closeSendWindow(db, courseId);
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.post(
    "/teacher/import-csv",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      const canCreate =
        role === "admin" ||
        role === "schooladmin" ||
        (process.env.TEACHER_CAN_CREATE || "0") === "1";
      if (!canCreate) return renderForbidden(req, res);

      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const csvText = (req.body.csv || "").toString();
      if (!csvText.trim()) {
        return res.redirect(buildTeacherRedirect(req, courseId));
      }

      let records;
      try {
        const firstLine =
          csvText.split(/\r?\n/).find((l) => l.trim().length) || "";
        const delimiter = firstLine.includes(";")
          ? ";"
          : firstLine.includes("\t")
            ? "\t"
            : ",";
        records = parse(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          delimiter,
          relax_quotes: true,
          relax_column_count: true,
        });
      } catch (e) {
        return res.status(400).send(req.t("teacher.csv_read_error"));
      }

      const insUser = db.prepare(
        "INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)",
      );
      const updUser = db.prepare(
        "UPDATE users SET display_name=?, expires_at=? WHERE username=? AND course_id=?",
      );

      const created = [];
      const updated = [];
      const errors = [];

      const tx = db.transaction(() => {
        for (const r of records) {
          const username = (r.username || "").trim();
          const display = (r.display_name || username).trim() || username;
          const expires_at = (r.expires_at || "").trim() || null;
          const password = (r.password || "").trim();

          if (!username) {
            errors.push({ row: r, error: req.t("teacher.username_missing") });
            continue;
          }

          const existing = db
            .prepare("SELECT id FROM users WHERE username=? AND course_id=?")
            .get(username, courseId);
          if (existing) {
            updUser.run(display, expires_at, username, courseId);
            updated.push(username);
          } else {
            const pw =
              password || Math.random().toString(36).slice(2, 10) + "!";
            const hash = bcrypt.hashSync(pw, 12);
            insUser.run(
              username,
              display,
              "student",
              courseId,
              hash,
              expires_at,
            );
            created.push({
              username,
              display_name: display,
              expires_at,
              course_id: courseId,
              password: pw,
            });
          }
        }
      });
      tx();

      req.session.lastTeacherImportCreated = created;

      // Post/Redirect/Get: keep URL stable and avoid resubmission on refresh.
      req.session.teacherImportResult = { created, updated, errors };
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.post(
    "/teacher/create-users",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      const canCreate =
        role === "admin" ||
        role === "schooladmin" ||
        (process.env.TEACHER_CAN_CREATE || "0") === "1";
      if (!canCreate) return renderForbidden(req, res);

      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const usernames = [].concat(req.body.username || []);
      const displayNames = [].concat(req.body.display_name || []);
      const expires = [].concat(req.body.expires_at || []);
      const passwords = [].concat(req.body.password || []);

      const created = [];
      const updated = [];
      const errors = [];

      const tx = db.transaction(() => {
        for (let i = 0; i < usernames.length; i++) {
          const username = (usernames[i] || "").toString().trim();
          if (!username) continue;
          const display =
            (displayNames[i] || username).toString().trim() || username;
          const expires_at = (expires[i] || "").toString().trim() || null;
          const pwIn = (passwords[i] || "").toString().trim();

          const existing = db
            .prepare("SELECT id FROM users WHERE username=? AND course_id=?")
            .get(username, courseId);
          if (existing) {
            db.prepare(
              "UPDATE users SET display_name=?, expires_at=? WHERE id=?",
            ).run(display, expires_at, existing.id);
            updated.push(username);
          } else {
            const pw = pwIn || Math.random().toString(36).slice(2, 10) + "!";
            const hash = bcrypt.hashSync(pw, 12);
            db.prepare(
              "INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)",
            ).run(username, display, "student", courseId, hash, expires_at);
            created.push({
              username,
              display_name: display,
              expires_at,
              course_id: courseId,
              password: pw,
            });
          }
        }
      });
      tx();

      req.session.lastTeacherImportCreated = created;
      req.session.teacherImportResult = {
        createdCount: created.length,
        updatedCount: updated.length,
        created,
        updated,
        errors,
      };
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.post(
    "/teacher/update-user",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const userId = Number(req.body.user_id || 0);
      const displayName = (req.body.display_name || "").toString().trim();
      const expiresAt = (req.body.expires_at || "").toString().trim() || null;
      const newPassword = (req.body.password || "").toString().trim();

      const user = db
        .prepare(
          "SELECT id, username, display_name, expires_at FROM users WHERE id=? AND course_id=? AND role='student'",
        )
        .get(userId, courseId);
      if (!user) {
        req.session.teacherUserResult = {
          ok: false,
          error: req.t("teacher.user_not_found"),
        };
        return res.redirect(buildTeacherRedirect(req, courseId));
      }

      const hasUsername = Object.prototype.hasOwnProperty.call(
        req.body,
        "username",
      );
      const hasDisplayName = Object.prototype.hasOwnProperty.call(
        req.body,
        "display_name",
      );
      const hasExpiresAt = Object.prototype.hasOwnProperty.call(
        req.body,
        "expires_at",
      );

      const nextUsername = hasUsername
        ? (req.body.username || "").toString().trim()
        : user.username;
      const nextDisplayName = hasDisplayName ? displayName : user.display_name;
      const nextExpiresAt = hasExpiresAt ? expiresAt : user.expires_at;

      if (!nextDisplayName) {
        req.session.teacherUserResult = {
          ok: false,
          error: req.t("teacher.display_name_missing"),
        };
        return res.redirect(buildTeacherRedirect(req, courseId));
      }

      if (hasUsername) {
        if (!nextUsername) {
          req.session.teacherUserResult = {
            ok: false,
            error: req.t("teacher.username_missing"),
          };
          return res.redirect(buildTeacherRedirect(req, courseId));
        }
        if (nextUsername !== user.username) {
          const existing = db
            .prepare(
              "SELECT id FROM users WHERE username=? AND course_id=? AND role='student' AND id<>?",
            )
            .get(nextUsername, courseId, userId);
          if (existing) {
            req.session.teacherUserResult = {
              ok: false,
              error: req.t("teacher.username_taken"),
            };
            return res.redirect(buildTeacherRedirect(req, courseId));
          }
        }
      }

      if (newPassword) {
        const hash = bcrypt.hashSync(newPassword, 12);
        db.prepare(
          "UPDATE users SET username=?, display_name=?, expires_at=?, pw_hash=? WHERE id=?",
        ).run(nextUsername, nextDisplayName, nextExpiresAt, hash, userId);
      } else {
        db.prepare(
          "UPDATE users SET username=?, display_name=?, expires_at=? WHERE id=?",
        ).run(nextUsername, nextDisplayName, nextExpiresAt, userId);
      }

      req.session.teacherUserResult = { ok: true };
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.post(
    "/teacher/generator/preview",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      if (!canCreateAccounts(role))
        return res.status(403).json({ error: req.t("errors.not_allowed") });
      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return res.status(403).json({ error: req.t("errors.not_allowed") });

      const maxCountRaw = Number(process.env.TEACHER_AUTO_CREATE_MAX || 60);
      const maxCount = Number.isFinite(maxCountRaw) ? maxCountRaw : 60;
      const config = parseGeneratorConfig(req.body, maxCount);
      if (!config.count) {
        return res.status(400).json({ error: req.t("teacher.count_missing") });
      }
      if (!config.regions.length) {
        return res.status(400).json({ error: "region_required" });
      }
      const previewCount = Math.min(config.count, 5);

      const entries = generateNameEntries(
        {
          ...config,
          count: previewCount,
          includePasswords: false,
        },
        { existingUsernames: new Set() },
      );

      return res.json({
        summary: {
          count: config.count,
          genders: config.summaryGenders,
          regions: config.summaryRegions,
        },
        warnings: {
          gender: config.genderWarning,
          regions: config.regionWarning,
        },
        sample: entries.map((row) => ({
          firstName: row.firstName,
          lastName: row.lastName,
          gender: row.gender,
          region: row.region,
        })),
      });
    },
  );

  router.post(
    "/teacher/generator/build",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      if (!canCreateAccounts(role))
        return res.status(403).json({ error: req.t("errors.not_allowed") });
      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return res.status(403).json({ error: req.t("errors.not_allowed") });

      const maxCountRaw = Number(process.env.TEACHER_AUTO_CREATE_MAX || 60);
      const maxCount = Number.isFinite(maxCountRaw) ? maxCountRaw : 60;
      const config = parseGeneratorConfig(req.body, maxCount);
      if (!config.count) {
        return res.status(400).json({ error: req.t("teacher.count_missing") });
      }
      if (!config.regions.length) {
        return res.status(400).json({ error: "region_required" });
      }
      const courseContext = getCourseContext(courseId);

      const entries = generateNameEntries(
        {
          ...config,
          includePasswords: true,
        },
        { existingUsernames: buildExistingUsernameSet(courseId) },
      ).map((row, idx) => ({
        ...row,
        index: idx + 1,
        expires_at: config.expiresAt,
        saved: false,
        password: config.passwordGlobal || row.password,
        login: formatLogin(
          {
            username: row.username,
            courseName: courseContext?.course_name,
            domain: courseContext?.school_domain,
            role: "student",
          },
          process.env,
        ),
      }));

      req.session.teacherGeneratorDraft = {
        courseId,
        config,
        entries,
      };
      req.session.teacherGeneratorCreated = [];

      return res.json({
        summary: {
          count: config.count,
          genders: config.summaryGenders,
          regions: config.summaryRegions,
        },
        warnings: {
          gender: config.genderWarning,
          regions: config.regionWarning,
        },
        entries,
      });
    },
  );

  router.post(
    "/teacher/generator/regenerate",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      if (!canCreateAccounts(role))
        return res.status(403).json({ error: req.t("errors.not_allowed") });
      const draft = req.session.teacherGeneratorDraft;
      if (!draft || !draft.entries)
        return res.status(400).json({ error: "no_draft" });
      const index = Number(req.body.index || 0);
      const entry = draft.entries[index - 1];
      if (!entry) return res.status(404).json({ error: "not_found" });
      if (entry.saved) return res.status(409).json({ error: "saved" });

      const existingNames = buildNameKeySet(draft.entries, index - 1);
      const existingUsernames = new Set(
        draft.entries
          .filter((_, idx) => idx !== index - 1)
          .map((row) => row.username),
      );
      const replacement = generateEntryForConstraints(
        {
          gender: entry.gender,
          regionFirst: entry.regionFirst,
          regionLast: entry.regionLast,
        },
        draft.config,
        existingNames,
        existingUsernames,
      );

      const courseContext = getCourseContext(draft.courseId);
      draft.entries[index - 1] = {
        ...entry,
        ...replacement,
        login: formatLogin(
          {
            username: replacement.username,
            courseName: courseContext?.course_name,
            domain: courseContext?.school_domain,
            role: "student",
          },
          process.env,
        ),
        saved: false,
      };

      return res.json({ entry: draft.entries[index - 1] });
    },
  );

  router.post(
    "/teacher/generator/confirm-one",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      if (!canCreateAccounts(role))
        return res.status(403).json({ error: req.t("errors.not_allowed") });
      const meId = req.session.userId;
      const draft = req.session.teacherGeneratorDraft;
      if (!draft || !draft.entries)
        return res.status(400).json({ error: "no_draft" });
      const courseId = Number(draft.courseId || 0);
      if (!canManageCourse(role, meId, courseId))
        return res.status(403).json({ error: req.t("errors.not_allowed") });

      const index = Number(req.body.index || 0);
      const entry = draft.entries[index - 1];
      if (!entry) return res.status(404).json({ error: "not_found" });
      if (entry.saved) return res.json({ entry });

      const username = (entry.username || "").trim();
      const display = (entry.displayName || username).trim() || username;
      const expires_at = draft.config.expiresAt || null;
      const password =
        (draft.config?.passwordGlobal || entry.password || "").trim() ||
        Math.random().toString(36).slice(2, 10) + "!";

      if (!username)
        return res
          .status(400)
          .json({ error: req.t("teacher.username_missing") });

      const existing = db
        .prepare("SELECT id FROM users WHERE username=? AND course_id=?")
        .get(username, courseId);
      let created = null;
      if (existing) {
        db.prepare(
          "UPDATE users SET display_name=?, expires_at=? WHERE id=?",
        ).run(display, expires_at, existing.id);
      } else {
        const hash = bcrypt.hashSync(password, 12);
        db.prepare(
          "INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)",
        ).run(username, display, "student", courseId, hash, expires_at);
        created = {
          username,
          display_name: display,
          expires_at,
          course_id: courseId,
          password,
        };
      }

      entry.saved = true;
      entry.password = password;
      const userRow = db
        .prepare(
          "SELECT id, username, display_name, expires_at FROM users WHERE username=? AND course_id=?",
        )
        .get(username, courseId);
      const courseContext = getCourseContext(courseId);
      const login = formatLogin(
        {
          username: userRow?.username,
          courseName: courseContext?.course_name,
          domain: courseContext?.school_domain,
          role: "student",
        },
        process.env,
      );
      const prevCreated = req.session.teacherGeneratorCreated || [];
      if (created) {
        req.session.teacherGeneratorCreated = prevCreated.concat(created);
      } else {
        req.session.teacherGeneratorCreated = prevCreated;
      }

      return res.json({ entry, user: { ...userRow, login } });
    },
  );

  router.post(
    "/teacher/generator/update",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      if (!canCreateAccounts(role))
        return res.status(403).json({ error: req.t("errors.not_allowed") });
      const draft = req.session.teacherGeneratorDraft;
      if (!draft || !draft.entries)
        return res.status(400).json({ error: "no_draft" });
      const index = Number(req.body.index || 0);
      const entry = draft.entries[index - 1];
      if (!entry) return res.status(404).json({ error: "not_found" });

      const firstName = (req.body.first_name || "").toString().trim();
      const lastName = (req.body.last_name || "").toString().trim();
      const validation = validateNameEntry({
        firstName,
        lastName,
        regions: draft.config.regions,
        comboMode: draft.config.comboMode,
      });
      if (!validation.ok)
        return res.status(400).json({ error: validation.error });

      const nameKey = makeNameKey(firstName, lastName);
      if (draft.config.uniqueNames) {
        for (let i = 0; i < draft.entries.length; i += 1) {
          if (i === index - 1) continue;
          if (
            makeNameKey(
              draft.entries[i].firstName,
              draft.entries[i].lastName,
            ) === nameKey
          ) {
            return res.status(409).json({ error: "duplicate" });
          }
        }
      }

      const existingUsernames = new Set(
        draft.entries
          .filter((_, i) => i !== index - 1)
          .map((row) => row.username),
      );
      const username = buildUsername(
        { firstName, lastName, prefix: draft.config.prefix },
        existingUsernames,
      );
      const displayName =
        `${firstName}${lastName ? " " + lastName : ""}`.trim();
      const courseContext = getCourseContext(draft.courseId);

      draft.entries[index - 1] = {
        ...entry,
        firstName,
        lastName,
        gender: validation.gender,
        region: validation.region,
        regionFirst: validation.regionFirst,
        regionLast: validation.regionLast,
        displayName,
        username,
        login: formatLogin(
          {
            username,
            courseName: courseContext?.course_name,
            domain: courseContext?.school_domain,
            role: "student",
          },
          process.env,
        ),
      };

      return res.json({ entry: draft.entries[index - 1] });
    },
  );

  router.post(
    "/teacher/generator/confirm",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      if (!canCreateAccounts(role))
        return res.status(403).json({ error: req.t("errors.not_allowed") });
      const meId = req.session.userId;
      const draft = req.session.teacherGeneratorDraft;
      if (!draft || !draft.entries)
        return res.status(400).json({ error: "no_draft" });
      const courseId = Number(draft.courseId || 0);
      if (!canManageCourse(role, meId, courseId))
        return res.status(403).json({ error: req.t("errors.not_allowed") });

      const created = [];
      const updated = [];
      const errors = [];
      const pendingEntries = draft.entries.filter((row) => !row.saved);
      if (!pendingEntries.length) {
        req.session.teacherGeneratorDraft = null;
        return res.json({
          ok: true,
          createdCount: 0,
          updatedCount: 0,
          users: [],
        });
      }

      const tx = db.transaction(() => {
        for (const row of pendingEntries) {
          const username = (row.username || "").trim();
          const display = (row.displayName || username).trim() || username;
          const expires_at = draft.config.expiresAt || null;
          const password = (
            draft.config?.passwordGlobal ||
            row.password ||
            ""
          ).trim();

          if (!username) {
            errors.push({ row, error: req.t("teacher.username_missing") });
            continue;
          }

          const existing = db
            .prepare("SELECT id FROM users WHERE username=? AND course_id=?")
            .get(username, courseId);
          if (existing) {
            db.prepare(
              "UPDATE users SET display_name=?, expires_at=? WHERE id=?",
            ).run(display, expires_at, existing.id);
            updated.push(username);
          } else {
            const pw =
              password || Math.random().toString(36).slice(2, 10) + "!";
            const hash = bcrypt.hashSync(pw, 12);
            db.prepare(
              "INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)",
            ).run(username, display, "student", courseId, hash, expires_at);
            created.push({
              username,
              display_name: display,
              expires_at,
              course_id: courseId,
              password: pw,
            });
          }
        }
      });
      tx();

      const prevCreated = req.session.teacherGeneratorCreated || [];
      req.session.teacherGeneratorCreated = prevCreated.concat(created);
      req.session.teacherGeneratorDraft = null;

      const courseContext = getCourseContext(courseId);
      const createdUsers = created
        .map((row) => {
          const userRow = db
            .prepare(
              "SELECT id, username, display_name, expires_at FROM users WHERE username=? AND course_id=?",
            )
            .get(row.username, courseId);
          const login = formatLogin(
            {
              username: userRow?.username,
              courseName: courseContext?.course_name,
              domain: courseContext?.school_domain,
              role: "student",
            },
            process.env,
          );
          return { ...userRow, login };
        })
        .filter(Boolean);

      return res.json({
        ok: true,
        createdCount: created.length,
        updatedCount: updated.length,
        users: createdUsers,
      });
    },
  );

  router.post(
    "/teacher/generate-users",
    requireRole("teacher", "schooladmin", "admin"),
    async (req, res) => {
      const role = req.session.role;
      const canCreate =
        role === "admin" ||
        role === "schooladmin" ||
        (process.env.TEACHER_CAN_CREATE || "0") === "1";
      if (!canCreate) return renderForbidden(req, res);

      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const maxCountRaw = Number(process.env.TEACHER_AUTO_CREATE_MAX || 60);
      const maxCount = Number.isFinite(maxCountRaw) ? maxCountRaw : 60;
      const rawCount = Number(req.body.count || 0);
      const count = Math.max(
        1,
        Math.min(Number.isFinite(rawCount) ? rawCount : 0, maxCount),
      );
      const expires_at = (req.body.expires_at || "").toString().trim() || null;
      const prefix = (req.body.prefix || "").toString().trim();
      const apiUrl = (process.env.TEACHER_NAME_API_URL || "").toString().trim();
      const apiConfigured = !!apiUrl;
      const nameSource = (req.body.name_source || "")
        .toString()
        .trim()
        .toLowerCase();
      const useApi = apiConfigured && nameSource === "api";
      const maleCountRaw = Number(req.body.male_count || 0);
      const femaleCountRaw = Number(req.body.female_count || 0);
      const unisexCountRaw = Number(req.body.unisex_count || 0);
      const maleCount = Number.isFinite(maleCountRaw)
        ? Math.max(0, Math.min(maleCountRaw, count))
        : 0;
      const femaleCount = Number.isFinite(femaleCountRaw)
        ? Math.max(0, Math.min(femaleCountRaw, count))
        : 0;
      const unisexCount = Number.isFinite(unisexCountRaw)
        ? Math.max(0, Math.min(unisexCountRaw, count))
        : 0;
      const overflow = maleCount + femaleCount + unisexCount - count;
      const safeUnisexCount =
        overflow > 0 ? Math.max(0, unisexCount - overflow) : unisexCount;
      const genderMix =
        maleCount || femaleCount || safeUnisexCount
          ? { maleCount, femaleCount, unisexCount: safeUnisexCount }
          : null;

      const weightFemaleRaw = Number(req.body.female_weight || 0);
      const weightMaleRaw = Number(req.body.male_weight || 0);
      const weightUnisexRaw = Number(req.body.unisex_weight || 0);
      const genderWeights =
        Number.isFinite(weightFemaleRaw) ||
        Number.isFinite(weightMaleRaw) ||
        Number.isFinite(weightUnisexRaw)
          ? {
              female: Number.isFinite(weightFemaleRaw)
                ? Math.max(0, weightFemaleRaw)
                : 0,
              male: Number.isFinite(weightMaleRaw)
                ? Math.max(0, weightMaleRaw)
                : 0,
              unisex: Number.isFinite(weightUnisexRaw)
                ? Math.max(0, weightUnisexRaw)
                : 0,
            }
          : null;

      if (!count) return res.status(400).send(req.t("teacher.count_missing"));

      const existing = new Set(
        db
          .prepare("SELECT username FROM users WHERE course_id=?")
          .all(courseId)
          .map((row) => row.username),
      );

      const names = await getNameBatch(count, {
        useApi,
        apiUrl: apiUrl || undefined,
        apiNat: process.env.TEACHER_NAME_API_NAT || "",
        timeoutMs: Number(process.env.TEACHER_NAME_API_TIMEOUT_MS || 3500),
        genderMix,
        genderWeights,
      });

      const seeds = buildUserSeeds(names.slice(0, count), {
        prefix,
        existingUsernames: existing,
      });

      const created = [];
      const updated = [];
      const errors = [];

      const tx = db.transaction(() => {
        for (const seed of seeds) {
          const username = seed.username;
          if (!username) {
            errors.push({
              row: seed,
              error: req.t("teacher.username_missing"),
            });
            continue;
          }
          const display = seed.displayName || username;
          const existingUser = db
            .prepare("SELECT id FROM users WHERE username=? AND course_id=?")
            .get(username, courseId);
          if (existingUser) {
            db.prepare(
              "UPDATE users SET display_name=?, expires_at=? WHERE id=?",
            ).run(display, expires_at, existingUser.id);
            updated.push(username);
          } else {
            const pw = Math.random().toString(36).slice(2, 10) + "!";
            const hash = bcrypt.hashSync(pw, 12);
            db.prepare(
              "INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)",
            ).run(username, display, "student", courseId, hash, expires_at);
            created.push({
              username,
              display_name: display,
              expires_at,
              course_id: courseId,
              password: pw,
            });
          }
        }
      });
      tx();

      req.session.lastTeacherImportCreated = created;
      req.session.teacherImportResult = {
        createdCount: created.length,
        updatedCount: updated.length,
        created,
        updated,
        errors,
      };
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.get(
    "/teacher/download-created.csv",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const createdRaw =
        req.session.teacherGeneratorCreated &&
        req.session.teacherGeneratorCreated.length
          ? req.session.teacherGeneratorCreated
          : req.session.lastTeacherImportCreated || [];
      const exportData = buildCreatedExportRows(createdRaw);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="created-users.csv"',
      );

      // Unified CSV format (no quotes), compatible with both teacher and admin imports.
      // Fields: display_name,login,course,expires_at,password
      res.write("display_name,login,course,expires_at,password\n");
      for (const row of exportData.rows) {
        const d = csvFieldNoQuotes(row.display_name);
        const login = csvFieldNoQuotes(row.login);
        const c = csvFieldNoQuotes(row.course || "");
        const e = csvFieldNoQuotes(row.expires_at);
        const p = csvFieldNoQuotes(row.password);
        res.write(`${d},${login},${c},${e},${p}\n`);
      }
      return res.end();
    },
  );

  router.get(
    "/teacher/download-created.xlsx",
    requireRole("teacher", "schooladmin", "admin"),
    async (req, res) => {
      const createdRaw =
        req.session.teacherGeneratorCreated &&
        req.session.teacherGeneratorCreated.length
          ? req.session.teacherGeneratorCreated
          : req.session.lastTeacherImportCreated || [];
      const exportData = buildCreatedExportRows(createdRaw);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename=\"created-users.xlsx\"',
      );

      let ExcelJS;
      try {
        ExcelJS = require("exceljs");
      } catch (e) {
        return res
          .status(500)
          .send(
            "Excel export is unavailable. Install exceljs and restart the server.",
          );
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("created-users");
      sheet.columns = [
        { header: "Name", key: "display_name", width: 28 },
        { header: "Login", key: "login", width: 36 },
        { header: "Kurs", key: "course", width: 12 },
        { header: "Ablauf", key: "expires_at", width: 14 },
        { header: "Passwort", key: "password", width: 18 },
      ];

      for (const row of exportData.rows) {
        sheet.addRow({
          display_name: row.display_name || "",
          login: row.login || "",
          course: row.course || "",
          expires_at: row.expires_at || "",
          password: row.password || "",
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return res.end(Buffer.from(buffer));
    },
  );

  router.get(
    "/teacher/download-created.pdf",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const createdRaw =
        req.session.teacherGeneratorCreated &&
        req.session.teacherGeneratorCreated.length
          ? req.session.teacherGeneratorCreated
          : req.session.lastTeacherImportCreated || [];
      const exportData = buildCreatedExportRows(createdRaw);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="created-users.pdf"',
      );

      let PDFDocument;
      try {
        PDFDocument = require("pdfkit");
      } catch (e) {
        return res
          .status(500)
          .send(
            "PDF export is unavailable. Install pdfkit and restart the server.",
          );
      }

      const courseName = exportData.courseName || "";
      const rows = exportData.rows;

      const doc = new PDFDocument({
        margin: 36,
        size: "A4",
        layout: "landscape",
      });
      doc.pipe(res);
      doc.fontSize(16).text("Created Users", { align: "left" });
      if (courseName) {
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Course: ${courseName}`, { align: "left" });
      }
      doc.moveDown(0.5);

      const columns = [
        { key: "display_name", label: "Name", width: 140 },
        { key: "login", label: "Login", width: 170 },
        { key: "course", label: "Kurs", width: 80 },
        { key: "expires_at", label: "Ablauf", width: 90 },
        { key: "password", label: "Passwort", width: 100 },
        { key: "note", label: "Notizen", width: 200 },
      ];
      const rowHeight = 18;
      const startX = doc.page.margins.left;
      const maxY = doc.page.height - doc.page.margins.bottom;

      const drawRow = (values, y, isHeader = false) => {
        let x = startX;
        doc
          .fontSize(isHeader ? 9 : 8)
          .font(isHeader ? "Helvetica-Bold" : "Helvetica");
        values.forEach((val, idx) => {
          const width = columns[idx].width;
          doc.text(String(val || ""), x + 2, y + 4, {
            width: width - 4,
            height: rowHeight,
          });
          doc.rect(x, y, width, rowHeight).stroke();
          x += width;
        });
      };

      let y = doc.y + 4;
      drawRow(
        columns.map((col) => col.label),
        y,
        true,
      );
      y += rowHeight;

      rows.forEach((row) => {
        const values = [
          row.display_name || "",
          row.login || "",
          row.course || "",
          row.expires_at || "",
          row.password || "",
          row.note || "",
        ];
        if (y + rowHeight > maxY) {
          doc.addPage();
          y = doc.page.margins.top;
          drawRow(
            columns.map((col) => col.label),
            y,
            true,
          );
          y += rowHeight;
        }
        drawRow(values, y, false);
        y += rowHeight;
      });

      doc.end();
    },
  );

  router.post(
    "/teacher/delete-users",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      const ids = (req.body.user_ids || "")
        .toString()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);
      if (!ids.length) return res.redirect(buildTeacherRedirect(req, courseId));
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const targetIds = ids.filter((id) => id !== meId);
      const attachmentNames = collectStorageNamesByUserIds(db, targetIds);
      const tx = db.transaction(() => {
        for (const id of targetIds) {
          db.prepare(
            "DELETE FROM users WHERE id=? AND course_id=? AND role='student'",
          ).run(id, courseId);
        }
      });
      tx();
      deleteAttachmentFiles(attachmentNames);
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  router.post(
    "/teacher/bulk-update",
    requireRole("teacher", "schooladmin", "admin"),
    (req, res) => {
      const role = req.session.role;
      const meId = req.session.userId;
      const courseId = Number(req.body.course_id || 0);
      if (!canManageCourse(role, meId, courseId))
        return renderForbidden(req, res);

      const ids = (req.body.user_ids || "")
        .toString()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);
      if (!ids.length) return res.redirect(buildTeacherRedirect(req, courseId));

      const expiresAt = (req.body.expires_at || "").toString().trim();
      const newPassword = (req.body.password || "").toString().trim();
      if (!expiresAt && !newPassword)
        return res.redirect(buildTeacherRedirect(req, courseId));

      const filteredIds = ids.filter((id) => id !== meId);
      if (!filteredIds.length)
        return res.redirect(buildTeacherRedirect(req, courseId));

      const placeholders = filteredIds.map(() => "?").join(",");
      const params = [...filteredIds, courseId];

      if (expiresAt && newPassword) {
        const hash = bcrypt.hashSync(newPassword, 12);
        db.prepare(
          `UPDATE users SET expires_at=?, pw_hash=? WHERE id IN (${placeholders}) AND course_id=? AND role='student'`,
        ).run(expiresAt, hash, ...params);
      } else if (expiresAt) {
        db.prepare(
          `UPDATE users SET expires_at=? WHERE id IN (${placeholders}) AND course_id=? AND role='student'`,
        ).run(expiresAt, ...params);
      } else if (newPassword) {
        const hash = bcrypt.hashSync(newPassword, 12);
        db.prepare(
          `UPDATE users SET pw_hash=? WHERE id IN (${placeholders}) AND course_id=? AND role='student'`,
        ).run(hash, ...params);
      }

      req.session.teacherUserResult = { ok: true };
      return res.redirect(buildTeacherRedirect(req, courseId));
    },
  );

  return router;
};
