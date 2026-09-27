const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const db = require("../config/db");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

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

const tsForFile = () => new Date().toISOString().replace(/[:.]/g, "-");

// ═══════════════════════════════════════════════════════════
// BACKUP FOLDER SETUP
// ═══════════════════════════════════════════════════════════

const BACKUP_DIR = path.join(__dirname, "..", "backups");
try {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log("✅ Backups folder created:", BACKUP_DIR);
  } else {
    console.log("✅ Backups folder exists:", BACKUP_DIR);
  }
} catch (dirErr) {
  console.warn("⚠️ Could not create backups folder:", dirErr.message);
}

// ═══════════════════════════════════════════════════════════
// CLOUDINARY STORAGE
// ═══════════════════════════════════════════════════════════

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

// Multer for JSON backup uploads
const jsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) cb(null, true);
    else cb(new Error("Only JSON files allowed!"), false);
  },
});

// ═══════════════════════════════════════════════════════════
// CLOUDINARY DELETE
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// 🔍 DEBUG ROUTE — Route check karne ke liye (KOI AUTH NAHI)
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup/test", (req, res) => {
  res.json({
    success: true,
    message: "🎉 Backup route is ALIVE!",
    timestamp: new Date().toISOString(),
    backupDir: BACKUP_DIR,
    backupDirExists: fs.existsSync(BACKUP_DIR),
  });
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DOWNLOAD JSON
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup", (req, res) => {
  console.log("📦 Backup request received");

  db.query("SELECT * FROM notifications ORDER BY id ASC", (err, rows) => {
    if (err) {
      console.error("❌ Backup DB Error:", err);
      return res.status(500).json({
        success: false,
        message: "Backup failed — database error",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }

    console.log(`✅ Fetched ${rows.length} notifications for backup`);

    const backupData = {
      meta: {
        system: "Notification System",
        version: "1.0",
        generatedAt: new Date().toISOString(),
        generatedBy: "admin",
        totalRecords: rows.length,
      },
      notifications: rows,
    };

    const fileName = `notifications-backup-${tsForFile()}.json`;

    try {
      const filePath = path.join(BACKUP_DIR, fileName);
      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), "utf8");
      console.log(`✅ Backup saved on server: ${filePath}`);
    } catch (writeErr) {
      console.warn("⚠️ Could not save backup on server:", writeErr.message);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backupData, null, 2));
  });
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — LIST SAVED
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup/list", (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("notifications-backup-") && f.endsWith(".json"))
      .map(f => {
        try {
          const stat = fs.statSync(path.join(BACKUP_DIR, f));
          return {
            fileName: f,
            size: stat.size,
            sizeKB: (stat.size / 1024).toFixed(2),
            createdAt: stat.birthtime || stat.mtime,
          };
        } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: files.length, data: files });
  } catch (err) {
    console.error("❌ Backup list error:", err);
    res.status(500).json({ success: false, message: "Failed to list backups", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DOWNLOAD SAVED FILE
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup/download/:fileName", (req, res) => {
  const { fileName } = req.params;

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

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DELETE SAVED FILE
// ═══════════════════════════════════════════════════════════

router.delete("/admin/backup/:fileName", (req, res) => {
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

// ═══════════════════════════════════════════════════════════
// 📥 RESTORE
// ═══════════════════════════════════════════════════════════

router.post("/admin/restore", jsonUpload.single("backup"), async (req, res) => {
  try {
    console.log("📥 Restore request received");
    let backupData;

    if (req.file) {
      const content = req.file.buffer.toString("utf8");
      backupData = JSON.parse(content);
      console.log(`✅ Parsed backup: ${req.file.originalname}`);
    } else if (req.body?.backup) {
      backupData = typeof req.body.backup === "string" ? JSON.parse(req.body.backup) : req.body.backup;
    } else {
      return res.status(400).json({ success: false, message: "No backup data provided" });
    }

    const notifications = backupData.notifications || backupData.data || backupData;
    if (!Array.isArray(notifications) || !notifications.length) {
      return res.status(400).json({ success: false, message: "Invalid backup format" });
    }

    const mode = req.body?.mode || "merge";
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
          file: n.file || n.file_url || null,
          created_at: n.created_at ? new Date(n.created_at) : new Date(),
        };

        const doCheck = row.id
          ? new Promise((resolve, reject) => {
              db.query("SELECT id FROM notifications WHERE id = ?", [row.id], (e, r) => {
                if (e) reject(e); else resolve(r);
              });
            })
          : Promise.resolve([]);

        doCheck.then((existing) => {
          const exists = existing?.length > 0;

          if (exists && mode === "merge") {
            db.query(
              "UPDATE notifications SET title=?, message=?, file=? WHERE id=?",
              [row.title, row.message, row.file, row.id],
              (uErr) => {
                if (uErr) { results.errors.push({ id: row.id, error: uErr.message }); results.skipped++; }
                else results.updated++;
                resolve();
              }
            );
          } else if (exists && mode === "replace") {
            db.query("DELETE FROM notifications WHERE id = ?", [row.id], (dErr) => {
              if (dErr) { results.errors.push({ id: row.id, error: dErr.message }); results.skipped++; return resolve(); }
              const insQ = "INSERT INTO notifications (id, title, message, file, created_at) VALUES (?, ?, ?, ?, ?)";
              db.query(insQ, [row.id, row.title, row.message, row.file, row.created_at], (iErr) => {
                if (iErr) { results.errors.push({ id: row.id, error: iErr.message }); results.skipped++; }
                else results.updated++;
                resolve();
              });
            });
          } else {
            const insQ = row.id
              ? "INSERT INTO notifications (id, title, message, file, created_at) VALUES (?, ?, ?, ?, ?)"
              : "INSERT INTO notifications (title, message, file, created_at) VALUES (?, ?, ?, ?)";
            const params = row.id
              ? [row.id, row.title, row.message, row.file, row.created_at]
              : [row.title, row.message, row.file, row.created_at];

            db.query(insQ, params, (iErr) => {
              if (iErr) { results.errors.push({ id: row.id, error: iErr.message }); results.skipped++; }
              else { if (row.id) results.updated++; else results.inserted++; }
              resolve();
            });
          }
        }).catch(err => {
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

// ═══════════════════════════════════════════════════════════
// 📊 REPORT — CSV / JSON
// ═══════════════════════════════════════════════════════════

router.get("/admin/report", (req, res) => {
  const { from, to, type } = req.query;
  const whereClauses = [];
  const params = [];

  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  if (type) { whereClauses.push("type = ?"); params.push(type); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "Report failed", error: err.message });

    if (req.query.format === "csv") {
      const headers = ["ID", "Title", "Message", "Created At"];
      const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csvLines = [headers.join(",")];
      rows.forEach(r => {
        csvLines.push([
          r.id, r.title, r.message,
          r.created_at ? new Date(r.created_at).toISOString() : "",
        ].map(escape).join(","));
      });
      const csv = "\uFEFF" + csvLines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="report-${Date.now()}.csv"`);
      return res.send(csv);
    }

    res.json({ success: true, data: { total: rows.length, notifications: rows } });
  });
});

// ═══════════════════════════════════════════════════════════
// 📊 REPORT — HTML (print)
// ═══════════════════════════════════════════════════════════

router.get("/admin/report/html", (req, res) => {
  const { from, to, type } = req.query;
  const whereClauses = [];
  const params = [];
  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).send(`<h1>Error</h1><pre>${err.message}</pre>`);

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (d) => d ? new Date(d).toLocaleString("en-IN") : "—";

    const rowsHTML = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>#${r.id}</td>
        <td><b>${esc(r.title)}</b><br><small>${esc((r.message || "").slice(0, 150))}</small></td>
        <td>${fmt(r.created_at)}</td>
      </tr>
    `).join("");

    res.send(`<!DOCTYPE html><html><head><title>Notification Report</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        h1 { color: #c9972b; border-bottom: 3px solid #c9972b; padding-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #1e3a8a; color: #fff; padding: 10px; text-align: left; }
        td { padding: 8px; border-bottom: 1px solid #ddd; }
        tr:nth-child(even) { background: #f9f9f9; }
        @media print { button { display: none; } }
      </style></head><body>
      <button onclick="window.print()" style="padding:10px 20px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-bottom:10px;">🖨 Print</button>
      <h1>📢 Notification Report</h1>
      <p>Generated: ${fmt(new Date())} | Total: ${rows.length}</p>
      <table>
        <thead><tr><th>#</th><th>ID</th><th>Title & Message</th><th>Created</th></tr></thead>
        <tbody>${rowsHTML || '<tr><td colspan="4" style="text-align:center;padding:30px;">No data</td></tr>'}</tbody>
      </table>
    </body></html>`);
  });
});

// ═══════════════════════════════════════════════════════════
// 🔔 ADMIN — GET ALL
// ═══════════════════════════════════════════════════════════

router.get("/admin/all", (req, res) => {
  let { limit = 200, offset = 0, type, search } = req.query;
  limit = Math.min(Math.max(parseInt(limit) || 200, 1), 500);
  offset = Math.max(parseInt(offset) || 0, 0);

  const whereClauses = [];
  const params = [];
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (search) { whereClauses.push("(title LIKE ? OR message LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(
    `SELECT * FROM notifications ${whereSQL} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// ═══════════════════════════════════════════════════════════
// 🔔 ADMIN — ADD
// ═══════════════════════════════════════════════════════════

router.post("/admin/add", upload.single("file"), (req, res) => {
  const { title, message, description, type, attendance } = req.body;

  const finalTitle = title;
  const finalMessage = message || description || "";
  const finalType = type || attendance || "general";

  if (!finalTitle || finalTitle.trim().length < 3) {
    if (req.file?.filename) deleteFromCloudinary(req.file.filename, req.file.mimetype);
    return res.status(400).json({ success: false, message: "Title must be at least 3 characters" });
  }
  if (!finalMessage || finalMessage.trim().length < 5) {
    if (req.file?.filename) deleteFromCloudinary(req.file.filename, req.file.mimetype);
    return res.status(400).json({ success: false, message: "Message must be at least 5 characters" });
  }

  const fileUrl = req.file ? req.file.path : null;
  const filePublicId = req.file ? req.file.filename : null;
  const now = new Date();

  // Try full schema, fallback to minimal
  const insertFull = `INSERT INTO notifications 
     (title, message, file, file_public_id, type, created_at) 
     VALUES (?, ?, ?, ?, ?, ?)`;

  db.query(
    insertFull,
    [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, filePublicId, finalType, now],
    (err, result) => {
      if (err) {
        // Fallback: minimal schema
        const insertMin = `INSERT INTO notifications (title, message, file, created_at) VALUES (?, ?, ?, ?)`;
        db.query(insertMin, [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, now], (err2, result2) => {
          if (err2) {
            if (filePublicId) deleteFromCloudinary(filePublicId, req.file?.mimetype);
            return res.status(500).json({ success: false, message: "Failed to add", error: err2.message });
          }
          db.query("SELECT * FROM notifications WHERE id = ?", [result2.insertId], (fErr, fRes) => {
            res.status(201).json({ success: true, message: "Added ✅", data: fRes?.[0] });
          });
        });
        return;
      }

      db.query("SELECT * FROM notifications WHERE id = ?", [result.insertId], (fErr, fRes) => {
        res.status(201).json({ success: true, message: "Added ✅", data: fRes?.[0] });
      });
    }
  );
});

// ═══════════════════════════════════════════════════════════
// 🔔 ADMIN — UPDATE
// ═══════════════════════════════════════════════════════════

router.put("/admin/update/:id", upload.single("file"), (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    if (req.file?.filename) deleteFromCloudinary(req.file.filename, req.file.mimetype);
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  const { title, message, description, type, attendance } = req.body;

  db.query("SELECT * FROM notifications WHERE id = ?", [id], async (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult.length) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const existing = fetchResult[0];
    let fileUrl = existing.file;
    let filePublicId = existing.file_public_id;

    if (req.file) {
      if (filePublicId) await deleteFromCloudinary(filePublicId, fileUrl || "");
      fileUrl = req.file.path;
      filePublicId = req.file.filename;
    }

    const finalTitle = title !== undefined ? title : existing.title;
    const finalMessage = message !== undefined ? message : (description !== undefined ? description : existing.message);
    const finalType = type || attendance || existing.type || "general";

    db.query(
      `UPDATE notifications SET title=?, message=?, file=?, file_public_id=?, type=? WHERE id=?`,
      [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, filePublicId, finalType, id],
      (updateErr) => {
        if (updateErr) {
          // Fallback minimal
          db.query(
            `UPDATE notifications SET title=?, message=?, file=? WHERE id=?`,
            [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, id],
            (uErr2) => {
              if (uErr2) return res.status(500).json({ success: false, message: "Failed", error: uErr2.message });
              db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
                res.json({ success: true, message: "Updated ✅", data: fRes?.[0] });
              });
            }
          );
          return;
        }
        db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
          res.json({ success: true, message: "Updated ✅", data: fRes?.[0] });
        });
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════
// 🔔 ADMIN — DELETE
// ═══════════════════════════════════════════════════════════

router.delete("/admin/delete/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

  db.query("SELECT * FROM notifications WHERE id = ?", [id], async (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult.length) return res.status(404).json({ success: false, message: "Not found" });

    const notification = fetchResult[0];
    if (notification.file_public_id) {
      await deleteFromCloudinary(notification.file_public_id, notification.file || "");
    }

    db.query("DELETE FROM notifications WHERE id = ?", [id], (delErr) => {
      if (delErr) return res.status(500).json({ success: false, message: "Failed", error: delErr.message });
      res.json({ success: true, message: "Deleted ✅" });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 🔔 ADMIN — BULK DELETE
// ═══════════════════════════════════════════════════════════

router.delete("/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: "ids array required" });
  }
  const validIds = ids.filter(i => !isNaN(i)).map(Number);
  if (!validIds.length) return res.status(400).json({ success: false, message: "No valid IDs" });

  db.query("SELECT id, file_public_id, file FROM notifications WHERE id IN (?)", [validIds], async (fErr, rows) => {
    if (fErr) return res.status(500).json({ success: false, message: "Failed", error: fErr.message });

    if (rows.length) {
      await Promise.all(rows.map(r => r.file_public_id ? deleteFromCloudinary(r.file_public_id, r.file || "") : Promise.resolve()));
    }

    db.query("DELETE FROM notifications WHERE id IN (?)", [validIds], (dErr, result) => {
      if (dErr) return res.status(500).json({ success: false, message: "Failed", error: dErr.message });
      res.json({ success: true, message: `${result.affectedRows} deleted ✅` });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 🌐 PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

router.get("/", (req, res) => {
  let { limit = 50, offset = 0, search } = req.query;
  limit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
  offset = Math.max(parseInt(offset) || 0, 0);

  const whereClauses = [];
  const params = [];
  if (search) { whereClauses.push("(title LIKE ? OR message LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(
    `SELECT * FROM notifications ${whereSQL} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

router.get("/recent", (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
  db.query("SELECT * FROM notifications ORDER BY id DESC LIMIT ?", [limit], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
    res.json({ success: true, count: result.length, data: result });
  });
});

router.get("/search/:query", (req, res) => {
  const searchQuery = req.params.query?.trim();
  if (!searchQuery || searchQuery.length < 2) {
    return res.status(400).json({ success: false, message: "Min 2 characters" });
  }
  db.query(
    `SELECT * FROM notifications WHERE title LIKE ? OR message LIKE ? ORDER BY id DESC LIMIT 20`,
    [`%${searchQuery}%`, `%${searchQuery}%`],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// ⚠️ IMPORTANT: Yeh /:id route SABSE LAST hona chahiye
router.get("/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

  db.query("SELECT * FROM notifications WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
    if (!result.length) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result[0] });
  });
});

module.exports = router;
