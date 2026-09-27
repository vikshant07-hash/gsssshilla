const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const db = require("../config/db");
const fs = require("fs");
const path = require("path");

// ==================== HELPERS ====================

const sanitizeString = (str) => {
  if (!str) return str;
  return String(str)
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]*>/g, "");
};

const parseBoolean = (val, defaultVal = 0) => {
  if (val === undefined || val === null || val === "") return defaultVal;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (val === "true" || val === "1" || val === 1) return 1;
  if (val === "false" || val === "0" || val === 0) return 0;
  return defaultVal;
};

const validateNotification = ({ title, message }, isUpdate = false) => {
  const errors = [];
  if (!isUpdate || title !== undefined) {
    if (!title || title.trim().length < 3) errors.push("Title must be at least 3 characters");
    else if (title.length > 255) errors.push("Title cannot exceed 255 characters");
  }
  if (!isUpdate || message !== undefined) {
    if (!message || message.trim().length < 5) errors.push("Message must be at least 5 characters");
    else if (message.length > 5000) errors.push("Message cannot exceed 5000 characters");
  }
  return errors;
};

// Ensure backups folder exists
const BACKUP_DIR = path.join(__dirname, "..", "backups");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Format date for filenames
const tsForFile = () => new Date().toISOString().replace(/[:.]/g, "-");

// ==================== CLOUDINARY STORAGE ====================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const originalName = file.originalname
      .split(".")[0]
      .replace(/[^a-zA-Z0-9]/g, "-")
      .toLowerCase()
      .slice(0, 50);

    const isDoc = file.mimetype === "application/pdf" || file.mimetype.includes("word");

    return {
      folder: "school/notifications",
      resource_type: isDoc ? "raw" : "image",
      allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx"],
      transformation: isDoc ? undefined : [{ quality: "auto" }, { fetch_format: "auto" }],
      public_id: `notification-${originalName}-${uniqueSuffix}`,
    };
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images, PDFs and Word documents are allowed!"), false);
  },
});

// Multer for backup/restore JSON uploads (memory storage)
const jsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for large backups
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) cb(null, true);
    else cb(new Error("Only JSON backup files are allowed!"), false);
  },
});

// ==================== CLOUDINARY DELETE ====================

const deleteFromCloudinary = async (publicId, hint = "") => {
  if (!publicId) return;
  let resourceType = "image";
  const lower = (publicId + " " + hint).toLowerCase();
  if (lower.includes("pdf") || lower.includes("doc") || lower.includes("word")) {
    resourceType = "raw";
  }
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
    console.log(`✅ Cloudinary delete [${resourceType}]:`, publicId, "→", result.result);
    return result;
  } catch (err) {
    console.error("❌ Cloudinary Delete Error:", err.message);
    try {
      const altType = resourceType === "image" ? "raw" : "image";
      await cloudinary.uploader.destroy(publicId, { resource_type: altType, invalidate: true });
    } catch (e2) {
      console.error("❌ Fallback failed:", e2.message);
    }
  }
};

// ==================== ADD NOTIFICATION ====================

router.post("/add", upload.single("file"), async (req, res) => {
  try {
    const { title, message, type, isImportant, link } = req.body;
    const errors = validateNotification({ title, message });
    if (errors.length) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(400).json({ success: false, message: errors.join(", "), errors });
    }

    const fileUrl = req.file ? req.file.path : null;
    const filePublicId = req.file ? req.file.filename : null;
    const now = new Date();

    db.query(
      `INSERT INTO notifications 
       (title, message, file, file_public_id, type, isImportant, link, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitizeString(title), sanitizeString(message), fileUrl, filePublicId,
        type || "general", parseBoolean(isImportant, 0), link || null, now,
      ],
      (err, result) => {
        if (err) {
          console.error("❌ Database Error:", err);
          if (filePublicId) deleteFromCloudinary(filePublicId, req.file?.mimetype);
          return res.status(500).json({
            success: false, message: "Failed to add notification",
            error: process.env.NODE_ENV === "development" ? err.message : "DB error",
          });
        }

        db.query("SELECT * FROM notifications WHERE id = ?", [result.insertId], (fErr, fRes) => {
          if (fErr) console.error("❌ Fetch Error:", fErr);
          res.status(201).json({
            success: true, message: "Notification added successfully ✅",
            data: fRes?.[0] || { id: result.insertId },
            file: fileUrl, filePublicId: filePublicId,
          });
        });
      }
    );
  } catch (err) {
    console.error("❌ Add Error:", err);
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== GET ALL NOTIFICATIONS ====================

router.get("/", (req, res) => {
  let { limit = 50, offset = 0, type, isImportant, search } = req.query;
  limit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
  offset = Math.max(parseInt(offset) || 0, 0);

  const whereClauses = [];
  const params = [];
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (isImportant !== undefined) { whereClauses.push("isImportant = ?"); params.push(parseBoolean(isImportant)); }
  if (search) { whereClauses.push("(title LIKE ? OR message LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(
    `SELECT * FROM notifications ${whereSQL} ORDER BY isImportant DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed to fetch", error: err.message });
      db.query(`SELECT COUNT(*) as total FROM notifications ${whereSQL}`, params, (cErr, cRes) => {
        const total = cRes?.[0]?.total || result.length;
        res.json({
          success: true, count: result.length, data: result,
          pagination: { total, limit, offset, hasMore: offset + limit < total },
        });
      });
    }
  );
});

// ==================== GET IMPORTANT ====================

router.get("/important", (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
  db.query(
    "SELECT * FROM notifications WHERE isImportant = 1 ORDER BY id DESC LIMIT ?",
    [limit],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// ==================== GET RECENT ====================

router.get("/recent", (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
  db.query("SELECT * FROM notifications ORDER BY id DESC LIMIT ?", [limit], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
    res.json({ success: true, count: result.length, data: result });
  });
});

// ==================== GET STATS ====================

router.get("/stats", (req, res) => {
  db.query(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN isImportant = 1 THEN 1 ELSE 0 END) as importantCount,
       SUM(CASE WHEN file IS NOT NULL THEN 1 ELSE 0 END) as withFileCount,
       SUM(CASE WHEN type = 'general' THEN 1 ELSE 0 END) as generalCount,
       SUM(CASE WHEN type = 'exam' THEN 1 ELSE 0 END) as examCount,
       SUM(CASE WHEN type = 'holiday' THEN 1 ELSE 0 END) as holidayCount,
       SUM(CASE WHEN type = 'event' THEN 1 ELSE 0 END) as eventCount,
       MIN(created_at) as oldestDate,
       MAX(created_at) as latestDate
     FROM notifications`,
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, data: result[0] });
    }
  );
});

// ==================== 📦 BACKUP — DOWNLOAD JSON ====================
// GET /notifications/backup
// Saves a copy on server (backups/ folder) AND sends download to client

router.get("/backup", (req, res) => {
  db.query("SELECT * FROM notifications ORDER BY id ASC", (err, rows) => {
    if (err) {
      console.error("❌ Backup Error:", err);
      return res.status(500).json({ success: false, message: "Backup failed", error: err.message });
    }

    const backupData = {
      meta: {
        system: "Notification System",
        version: "1.0",
        generatedAt: new Date().toISOString(),
        generatedBy: req.user?.name || req.user?.email || "admin",
        totalRecords: rows.length,
        schema: ["id", "title", "message", "file", "file_public_id", "type", "isImportant", "link", "created_at", "updated_at"],
      },
      notifications: rows,
    };

    const fileName = `notifications-backup-${tsForFile()}.json`;
    const filePath = path.join(BACKUP_DIR, fileName);

    try {
      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), "utf8");
      console.log(`✅ Backup saved: ${filePath}`);
    } catch (writeErr) {
      console.error("⚠️ Could not save backup file:", writeErr.message);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backupData, null, 2));
  });
});

// ==================== 📦 BACKUP — LIST SAVED BACKUPS ====================
// GET /notifications/backup/list

router.get("/backup/list", (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("notifications-backup-") && f.endsWith(".json"))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          fileName: f,
          size: stat.size,
          sizeKB: (stat.size / 1024).toFixed(2),
          createdAt: stat.birthtime || stat.mtime,
          downloadUrl: `/notifications/backup/download/${f}`,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: files.length, data: files });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to list backups", error: err.message });
  }
});

// ==================== 📦 BACKUP — DOWNLOAD SAVED ====================
// GET /notifications/backup/download/:fileName

router.get("/backup/download/:fileName", (req, res) => {
  const { fileName } = req.params;

  // Security: prevent path traversal
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return res.status(400).json({ success: false, message: "Invalid filename" });
  }

  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Backup file not found" });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ==================== 📦 BACKUP — DELETE SAVED ====================
// DELETE /notifications/backup/:fileName

router.delete("/backup/:fileName", (req, res) => {
  const { fileName } = req.params;
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return res.status(400).json({ success: false, message: "Invalid filename" });
  }

  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Backup file not found" });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: "Backup deleted ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete backup", error: err.message });
  }
});

// ==================== 📥 RESTORE ====================
// POST /notifications/restore
// Body: multipart form-data with "backup" file (.json)
//   OR  JSON body { backup: {...}, mode: "merge" | "replace" }

router.post("/restore", jsonUpload.single("backup"), async (req, res) => {
  try {
    let backupData;

    if (req.file) {
      // Uploaded file
      const content = req.file.buffer.toString("utf8");
      backupData = JSON.parse(content);
    } else if (req.body?.backup) {
      backupData = typeof req.body.backup === "string" ? JSON.parse(req.body.backup) : req.body.backup;
    } else {
      return res.status(400).json({ success: false, message: "No backup data provided" });
    }

    const notifications = backupData.notifications || backupData.data || backupData;
    if (!Array.isArray(notifications) || !notifications.length) {
      return res.status(400).json({ success: false, message: "Invalid backup format — notifications array missing" });
    }

    const mode = req.body?.mode || "merge"; // "merge" | "replace"
    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    const processRecord = (n) => {
      return new Promise((resolve) => {
        if (!n.title || !n.message) {
          results.skipped++;
          return resolve();
        }

        const row = {
          id: n.id || null,
          title: sanitizeString(n.title),
          message: sanitizeString(n.message),
          file: n.file || null,
          file_public_id: n.file_public_id || null,
          type: n.type || "general",
          isImportant: parseBoolean(n.isImportant, 0),
          link: n.link || null,
          created_at: n.created_at ? new Date(n.created_at) : new Date(),
        };

        const doCheck = row.id
          ? new Promise((resolve, reject) => {
              db.query("SELECT id FROM notifications WHERE id = ?", [row.id], (e, r) => {
                if (e) reject(e);
                else resolve(r);
              });
            })
          : Promise.resolve([]);

        const insertWithId = (r) => {
          const insertQuery = r.id
            ? `INSERT INTO notifications (id, title, message, file, file_public_id, type, isImportant, link, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            : `INSERT INTO notifications (title, message, file, file_public_id, type, isImportant, link, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
          const params = r.id
            ? [r.id, r.title, r.message, r.file, r.file_public_id, r.type, r.isImportant, r.link, r.created_at]
            : [r.title, r.message, r.file, r.file_public_id, r.type, r.isImportant, r.link, r.created_at];

          db.query(insertQuery, params, (iErr) => {
            if (iErr) {
              results.errors.push({ id: r.id, error: iErr.message });
              results.skipped++;
            } else {
              if (r.id) results.updated++; else results.inserted++;
            }
            resolve();
          });
        };

        doCheck
          .then((existing) => {
            const exists = existing?.length > 0;

            if (exists && mode === "merge") {
              db.query(
                `UPDATE notifications 
                 SET title=?, message=?, file=?, file_public_id=?, type=?, isImportant=?, link=?, 
                     created_at=?, updated_at=NOW()
                 WHERE id=?`,
                [row.title, row.message, row.file, row.file_public_id, row.type,
                 row.isImportant, row.link, row.created_at, row.id],
                (uErr) => {
                  if (uErr) {
                    results.errors.push({ id: row.id, error: uErr.message });
                    results.skipped++;
                  } else {
                    results.updated++;
                  }
                  resolve();
                }
              );
            } else if (exists && mode === "replace") {
              db.query("DELETE FROM notifications WHERE id = ?", [row.id], (dErr) => {
                if (dErr) {
                  results.errors.push({ id: row.id, error: dErr.message });
                  results.skipped++;
                  return resolve();
                }
                insertWithId(row);
              });
            } else {
              insertWithId(row);
            }
          })
          .catch((err) => {
            results.errors.push({ id: row.id, error: err.message });
            results.skipped++;
            resolve();
          });
      });
    };

    for (const n of notifications) {
      await processRecord(n);
    }

    res.json({
      success: true,
      message: `Restore complete ✅ (${results.inserted} inserted, ${results.updated} updated, ${results.skipped} skipped)`,
      mode,
      results,
    });
  } catch (err) {
    console.error("❌ Restore Error:", err);
    res.status(500).json({ success: false, message: "Restore failed", error: err.message });
  }
});

// ==================== 📊 REPORT — JSON or CSV ====================
// GET /notifications/report?format=csv&from=...&to=...&type=...&isImportant=...

router.get("/report", (req, res) => {
  const { from, to, type, isImportant } = req.query;

  const whereClauses = [];
  const params = [];

  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (isImportant !== undefined) { whereClauses.push("isImportant = ?"); params.push(parseBoolean(isImportant)); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "Report failed", error: err.message });

    const summary = {
      total: rows.length,
      important: rows.filter(r => r.isImportant).length,
      withFile: rows.filter(r => r.file).length,
      byType: {},
      byDate: {},
      firstNotification: rows[rows.length - 1]?.created_at || null,
      lastNotification: rows[0]?.created_at || null,
    };

    rows.forEach(r => {
      summary.byType[r.type || "general"] = (summary.byType[r.type || "general"] || 0) + 1;
      const d = r.created_at ? new Date(r.created_at).toISOString().split("T")[0] : "unknown";
      summary.byDate[d] = (summary.byDate[d] || 0) + 1;
    });

    // CSV export
    if (req.query.format === "csv") {
      const headers = ["ID", "Title", "Message", "Type", "Important", "Link", "File", "Created At"];
      const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csvLines = [headers.join(",")];
      rows.forEach(r => {
        csvLines.push([
          r.id, r.title, r.message, r.type,
          r.isImportant ? "Yes" : "No",
          r.link || "", r.file || "",
          r.created_at ? new Date(r.created_at).toISOString() : "",
        ].map(escape).join(","));
      });

      const csv = "\uFEFF" + csvLines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="notification-report-${tsForFile()}.csv"`);
      return res.send(csv);
    }

    // JSON export
    res.json({
      success: true,
      data: {
        meta: {
          title: "Notification Report",
          generatedAt: new Date().toISOString(),
          generatedBy: req.user?.name || "Administrator",
          filters: { from, to, type, isImportant },
          period: from || to ? `${from || "start"} to ${to || "now"}` : "All time",
        },
        summary,
        notifications: rows,
      },
    });
  });
});

// ==================== 📊 REPORT — HTML (Print / PDF ready) ====================
// GET /notifications/report/html

router.get("/report/html", (req, res) => {
  const { from, to, type, isImportant } = req.query;

  const whereClauses = [];
  const params = [];
  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (isImportant !== undefined) { whereClauses.push("isImportant = ?"); params.push(parseBoolean(isImportant)); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).send(`<h1>Report Error</h1><pre>${err.message}</pre>`);

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

    const fmtDate = (d) => d
      ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "—";

    const total = rows.length;
    const important = rows.filter(r => r.isImportant).length;
    const withFile = rows.filter(r => r.file).length;

    const byType = {};
    rows.forEach(r => { byType[r.type || "general"] = (byType[r.type || "general"] || 0) + 1; });

    const typeBadge = (t) => {
      const colors = {
        general: "#6b7280", exam: "#dc2626", holiday: "#16a34a",
        event: "#9333ea", urgent: "#ea580c", result: "#2563eb",
        fee: "#ca8a04", admission: "#0891b2",
      };
      const c = colors[t] || "#6b7280";
      return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${c};color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">${esc(t)}</span>`;
    };

    const rowsHTML = rows.map(r => `
      <tr>
        <td style="text-align:center;color:#6b7280;font-weight:600;">#${r.id}</td>
        <td>
          <div style="font-weight:600;color:#111827;margin-bottom:2px;">${esc(r.title)}</div>
          <div style="color:#4b5563;font-size:13px;line-height:1.4;">${esc(r.message).slice(0, 180)}${r.message?.length > 180 ? "…" : ""}</div>
          ${r.link ? `<div style="margin-top:4px;font-size:12px;"><a href="${esc(r.link)}" style="color:#2563eb;text-decoration:none;">🔗 ${esc(r.link)}</a></div>` : ""}
        </td>
        <td style="text-align:center;">${typeBadge(r.type || "general")}</td>
        <td style="text-align:center;">${r.isImportant ? '<span style="color:#dc2626;font-weight:700;">★ Yes</span>' : '<span style="color:#9ca3af;">No</span>'}</td>
        <td style="text-align:center;">${r.file ? `<a href="${esc(r.file)}" target="_blank" style="color:#2563eb;">📎 View</a>` : '<span style="color:#9ca3af;">—</span>'}</td>
        <td style="text-align:right;color:#6b7280;font-size:12px;white-space:nowrap;">${fmtDate(r.created_at)}</td>
      </tr>
    `).join("");

    const typeSummaryHTML = Object.entries(byType).map(([t, c]) => `
      <div class="stat-card">
        <div class="stat-label">${esc(t)}</div>
        <div class="stat-value">${c}</div>
      </div>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Notification Report — ${new Date().toLocaleDateString("en-IN")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Roboto, -apple-system, Arial, sans-serif; background: #f4f6f9; color: #1f2937; padding: 20px; }
  .container { max-width: 1150px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden; }

  .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: #fff; padding: 28px 32px; }
  .header h1 { font-size: 26px; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.3px; }
  .header .sub { opacity: 0.9; font-size: 14px; }
  .header .meta-row { margin-top: 14px; display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; opacity: 0.95; }
  .header .meta-row span strong { font-weight: 600; }

  .body { padding: 28px 32px; }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 26px; }
  .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-card.total { background: #eff6ff; border-color: #bfdbfe; }
  .stat-card.imp { background: #fef2f2; border-color: #fecaca; }
  .stat-card.file { background: #f0fdf4; border-color: #bbf7d0; }
  .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 6px; }
  .stat-value { font-size: 24px; font-weight: 700; color: #111827; }

  h2.section-title { font-size: 16px; font-weight: 700; color: #111827; margin: 26px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; text-transform: uppercase; letter-spacing: 0.6px; }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  thead { background: #1e3a8a; color: #fff; }
  th { padding: 12px 10px; text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 12px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) { background: #f9fafb; }
  tr:hover { background: #eff6ff; }

  .footer { text-align: center; padding: 18px; background: #f9fafb; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }

  .toolbar { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 32px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
  .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-outline { background: #fff; color: #374151; border: 1px solid #d1d5db; }
  .btn-outline:hover { background: #f3f4f6; }

  @media print {
    body { background: #fff; padding: 0; }
    .container { box-shadow: none; border-radius: 0; }
    .toolbar { display: none; }
    tr:hover { background: transparent; }
    thead { background: #1e3a8a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="container">

  <div class="toolbar">
    <a href="?${new URLSearchParams({ ...req.query, format: "csv" }).toString()}" class="btn btn-outline">⬇ Download CSV</a>
    <button onclick="window.print()" class="btn btn-primary">🖨 Print / Save PDF</button>
  </div>

  <div class="header">
    <h1>📢 Notification Report</h1>
    <div class="sub">School Notification Management System</div>
    <div class="meta-row">
      <span><strong>Generated:</strong> ${fmtDate(new Date())}</span>
      <span><strong>Period:</strong> ${from || to ? `${from || "start"} → ${to || "now"}` : "All time"}</span>
      ${type ? `<span><strong>Type:</strong> ${esc(type)}</span>` : ""}
      ${isImportant !== undefined ? `<span><strong>Important:</strong> ${isImportant === "true" || isImportant === "1" ? "Only" : "No"}</span>` : ""}
    </div>
  </div>

  <div class="body">

    <h2 class="section-title">Summary</h2>
    <div class="stats-grid">
      <div class="stat-card total">
        <div class="stat-label">Total</div>
        <div class="stat-value">${total}</div>
      </div>
      <div class="stat-card imp">
        <div class="stat-label">Important ★</div>
        <div class="stat-value">${important}</div>
      </div>
      <div class="stat-card file">
        <div class="stat-label">With File</div>
        <div class="stat-value">${withFile}</div>
      </div>
      ${typeSummaryHTML}
    </div>

    <h2 class="section-title">Notifications (${total})</h2>
    <table>
      <thead>
        <tr>
          <th style="width:60px;text-align:center;">ID</th>
          <th>Title & Message</th>
          <th style="width:110px;text-align:center;">Type</th>
          <th style="width:80px;text-align:center;">Important</th>
          <th style="width:80px;text-align:center;">File</th>
          <th style="width:150px;text-align:right;">Created</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML || `<tr><td colspan="6" style="text-align:center;padding:40px;color:#9ca3af;">No notifications found</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Report generated by Notification Management System • ${new Date().toLocaleString("en-IN")}
  </div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
});

// ==================== SEARCH ====================
// MUST be before "/:id"

router.get("/search/:query", (req, res) => {
  const searchQuery = req.params.query?.trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

  if (!searchQuery || searchQuery.length < 2) {
    return res.status(400).json({ success: false, message: "Search query must be at least 2 characters" });
  }

  db.query(
    `SELECT * FROM notifications 
     WHERE title LIKE ? OR message LIKE ? 
     ORDER BY id DESC LIMIT ?`,
    [`%${searchQuery}%`, `%${searchQuery}%`, limit],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed to search", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// ==================== GET SINGLE ====================
// MUST be after all specific routes

router.get("/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid notification ID" });
  }

  db.query("SELECT * FROM notifications WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
    if (!result.length) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, data: result[0] });
  });
});

// ==================== UPDATE ====================

router.put("/:id", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
    return res.status(400).json({ success: false, message: "Invalid notification ID" });
  }

  const { title, message, type, isImportant, link, removeFile } = req.body;

  const errors = validateNotification({ title, message }, true);
  if (errors.length) {
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
    return res.status(400).json({ success: false, message: errors.join(", "), errors });
  }

  db.query("SELECT * FROM notifications WHERE id = ?", [id], async (fetchErr, fetchResult) => {
    if (fetchErr) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(500).json({ success: false, message: "Failed", error: fetchErr.message });
    }
    if (!fetchResult.length) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const existing = fetchResult[0];
    let fileUrl = existing.file;
    let filePublicId = existing.file_public_id;

    const shouldRemoveFile = removeFile === "true" || removeFile === true;
    if (shouldRemoveFile && existing.file_public_id) {
      await deleteFromCloudinary(existing.file_public_id, existing.file || "");
      fileUrl = null;
      filePublicId = null;
    }

    if (req.file) {
      if (existing.file_public_id) {
        await deleteFromCloudinary(existing.file_public_id, existing.file || "");
      }
      fileUrl = req.file.path;
      filePublicId = req.file.filename;
    }

    db.query(
      `UPDATE notifications 
       SET title = ?, message = ?, type = ?, isImportant = ?, 
           file = ?, file_public_id = ?, link = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        title !== undefined ? sanitizeString(title) : existing.title,
        message !== undefined ? sanitizeString(message) : existing.message,
        type || existing.type,
        isImportant !== undefined ? parseBoolean(isImportant) : existing.isImportant,
        fileUrl,
        filePublicId,
        link !== undefined ? (link || null) : existing.link,
        id,
      ],
      (updateErr) => {
        if (updateErr) {
          console.error("❌ Update Error:", updateErr);
          if (req.file?.filename) deleteFromCloudinary(req.file.filename, req.file.mimetype);
          return res.status(500).json({ success: false, message: "Failed to update", error: updateErr.message });
        }

        db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
          if (fErr) console.error("❌ Fetch Error:", fErr);
          res.json({
            success: true,
            message: "Notification updated successfully ✅",
            data: fRes?.[0] || null,
          });
        });
      }
    );
  });
});

// ==================== DELETE ====================

router.delete("/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid notification ID" });

  db.query("SELECT * FROM notifications WHERE id = ?", [id], async (fetchErr, fetchResult) => {
    if (fetchErr) return res.status(500).json({ success: false, message: "Failed", error: fetchErr.message });
    if (!fetchResult.length) return res.status(404).json({ success: false, message: "Notification not found" });

    const notification = fetchResult[0];
    if (notification.file_public_id) {
      await deleteFromCloudinary(notification.file_public_id, notification.file || "");
    }

    db.query("DELETE FROM notifications WHERE id = ?", [id], (delErr) => {
      if (delErr) return res.status(500).json({ success: false, message: "Failed to delete", error: delErr.message });
      res.json({ success: true, message: "Notification deleted successfully ✅" });
    });
  });
});

// ==================== TOGGLE IMPORTANT ====================

router.patch("/:id/toggle-important", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid notification ID" });

  db.query(
    "UPDATE notifications SET isImportant = NOT isImportant, updated_at = NOW() WHERE id = ?",
    [id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Notification not found" });

      db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
        if (fErr) console.error("❌ Fetch Error:", fErr);
        res.json({ success: true, message: "Toggled ✅", data: fRes?.[0] || null });
      });
    }
  );
});

// ==================== BULK DELETE ====================

router.post("/bulk-delete", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: "ids array is required" });
  }
  const validIds = ids.filter(i => !isNaN(i)).map(Number);
  if (!validIds.length) return res.status(400).json({ success: false, message: "No valid IDs" });

  db.query("SELECT id, file_public_id, file FROM notifications WHERE id IN (?)", [validIds], async (fErr, rows) => {
    if (fErr) return res.status(500).json({ success: false, message: "Failed", error: fErr.message });

    if (rows.length) {
      await Promise.all(rows.map(r => r.file_public_id ? deleteFromCloudinary(r.file_public_id, r.file || "") : Promise.resolve()));
    }

    db.query("DELETE FROM notifications WHERE id IN (?)", [validIds], (dErr, result) => {
      if (dErr) return res.status(500).json({ success: false, message: "Failed to delete", error: dErr.message });
      res.json({
        success: true,
        message: `${result.affectedRows} notification(s) deleted ✅`,
        deletedCount: result.affectedRows,
      });
    });
  });
});

// ==================== BULK MARK IMPORTANT ====================

router.post("/bulk-important", (req, res) => {
  const { ids, isImportant } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: "ids array is required" });
  }
  const validIds = ids.filter(i => !isNaN(i)).map(Number);
  if (!validIds.length) return res.status(400).json({ success: false, message: "No valid IDs" });

  const val = parseBoolean(isImportant);

  db.query(
    "UPDATE notifications SET isImportant = ?, updated_at = NOW() WHERE id IN (?)",
    [val, validIds],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({
        success: true,
        message: `${result.affectedRows} notification(s) updated ✅`,
        affected: result.affectedRows,
      });
    }
  );
});

module.exports = router;
