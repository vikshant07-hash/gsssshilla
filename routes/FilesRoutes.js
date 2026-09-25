/* =========================================================
   FilesRoutes.js — CloudVault File Manager
   Aapke existing server setup ke saath fully compatible
   ========================================================= */

const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const archiver = require("archiver");
const { cloudinary } = require("../config/cloudinary");
const { db } = require("../config/db");

const router = express.Router();

/* =========================================================
   CONFIG
   ========================================================= */
const MAX_FILE_SIZE = 100 * 1024 * 1024;      // 100 MB per file
const MAX_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per user
const TRASH_RETENTION_DAYS = 30;

/* =========================================================
   HELPERS
   ========================================================= */

// 🔐 Session check (aapke server.js ke checkSession jaisa)
const requireSession = (req, res, next) => {
  if (!req.session || !req.session.admin_id) {
    return res.status(401).json({
      success: false,
      message: "Session expired. Please login again.",
      code: "SESSION_EXPIRED"
    });
  }
  next();
};

// Format bytes for response
function fmtSize(b) {
  if (!b) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + " " + s[i];
}

// Get total storage used by a user
function getUserStorage(userId) {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT COALESCE(SUM(file_size),0) AS used 
       FROM file_manager 
       WHERE owner_id = ? AND is_folder = 0 AND trashed = 0`,
      [userId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(Number(rows[0]?.used || 0));
      }
    );
  });
}

// Log activity
function logActivity(userId, action, target, ip) {
  db.query(
    `INSERT INTO file_activity (user_id, action, target, ip, created_at) 
     VALUES (?, ?, ?, ?, NOW())`,
    [userId, action, target || "", ip || ""],
    (err) => { if (err) console.warn("Activity log err:", err.message); }
  );
}

// Detect file type category
function getCategory(ext) {
  const map = {
    img: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"],
    vid: ["mp4", "mkv", "mov", "avi", "webm", "flv", "m4v"],
    aud: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
    doc: ["pdf", "doc", "docx", "txt", "xls", "xlsx", "ppt", "pptx", "csv", "rtf"],
    arc: ["zip", "rar", "7z", "tar", "gz", "bz2"]
  };
  ext = (ext || "").toLowerCase();
  for (const [k, list] of Object.entries(map)) {
    if (list.includes(ext)) return k;
  }
  return "other";
}

// Cloudinary upload buffer helper
function uploadToCloudinary(fileBuffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || "cloudvault/files",
        resource_type: options.resource_type || "auto",
        public_id: options.public_id,
        overwrite: false
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
}

/* =========================================================
   ✅ ENSURE TABLE EXISTS (Auto-create on first load)
   ========================================================= */
function ensureTables() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS file_manager (
      id INT PRIMARY KEY AUTO_INCREMENT,
      owner_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      original_name VARCHAR(255),
      file_size BIGINT DEFAULT 0,
      mime_type VARCHAR(120) DEFAULT 'application/octet-stream',
      extension VARCHAR(20) DEFAULT '',
      category VARCHAR(20) DEFAULT 'other',
      cloud_url VARCHAR(600),
      public_id VARCHAR(300),
      resource_type VARCHAR(30) DEFAULT 'raw',
      is_folder TINYINT DEFAULT 0,
      parent_id INT DEFAULT NULL,
      starred TINYINT DEFAULT 0,
      trashed TINYINT DEFAULT 0,
      trashed_at TIMESTAMP NULL DEFAULT NULL,
      download_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_owner (owner_id),
      INDEX idx_parent (parent_id),
      INDEX idx_trashed (trashed),
      INDEX idx_category (category),
      INDEX idx_starred (starred)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS file_activity (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      action VARCHAR(50),
      target VARCHAR(255),
      ip VARCHAR(45),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_created (created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS file_versions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      file_id INT NOT NULL,
      version_no INT NOT NULL,
      cloud_url VARCHAR(600),
      public_id VARCHAR(300),
      file_size BIGINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_file (file_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  queries.forEach(q => {
    db.query(q, (err) => {
      if (err) console.warn("⚠️ Table create:", err.message);
    });
  });
  console.log("✅ FileManager tables ensured");
}

// Run once at startup
setTimeout(ensureTables, 1500);

/* =========================================================
   ⚠️ IMPORTANT: File upload middleware (express-fileupload)
   Yeh aapke server.js me globally hai, lekin per-route
   override kar sakte hain
   ========================================================= */
const uploadConfig = {
  limits: { fileSize: MAX_FILE_SIZE },
  abortOnLimit: true,
  safeFileNames: true,
  preserveExtension: true
};

/* =========================================================
   1) LIST FILES  →  GET /api/files
   Query: ?view=all|recent|starred|trash|images|docs|videos|audio|archives
          &parent_id=&search=&sort=name|date|size|type&order=asc|desc
          &page=1&limit=100
   ========================================================= */
router.get("/", requireSession, async (req, res) => {
  try {
    const uid = req.session.admin_id;
    const {
      view = "all",
      parent_id = null,
      search = "",
      sort = "date",
      order = "desc",
      page = 1,
      limit = 100
    } = req.query;

    let where = ["owner_id = ?"];
    let params = [uid];

    // Trash vs normal
    if (view !== "trash") {
      where.push("trashed = 0");
      if (parent_id !== null && parent_id !== "" && parent_id !== "null" && parent_id !== "undefined") {
        where.push("parent_id = ?");
        params.push(Number(parent_id));
      } else {
        where.push("parent_id IS NULL");
      }
    } else {
      where.push("trashed = 1");
    }

    // View filters
    if (view === "starred") where.push("starred = 1");

    if (["images", "docs", "videos", "audio", "archives"].includes(view)) {
      const map = {
        images: "img",
        docs: "doc",
        videos: "vid",
        audio: "aud",
        archives: "arc"
      };
      where.push("category = ?");
      params.push(map[view]);
    }

    // Search
    if (search) {
      where.push("(name LIKE ? OR original_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    // Sort
    const sortMap = { name: "name", date: "created_at", size: "file_size", type: "extension" };
    const sortCol = sortMap[sort] || "created_at";
    const sortOrder = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    const offset = (Number(page) - 1) * Number(limit);

    const sql = `
      SELECT id, name, original_name, file_size, mime_type, extension, category,
             cloud_url, public_id, resource_type, is_folder, parent_id,
             starred, trashed, trashed_at, download_count, created_at, updated_at
      FROM file_manager
      WHERE ${where.join(" AND ")}
      ORDER BY is_folder DESC, ${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?
    `;
    params.push(Number(limit), offset);

    db.query(sql, params, async (err, rows) => {
      if (err) {
        console.error("❌ List files:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      // Count total
      const countSql = `SELECT COUNT(*) as total FROM file_manager WHERE ${where.join(" AND ")}`;
      db.query(countSql, params.slice(0, params.length - 2), async (countErr, countRows) => {
        if (countErr) console.warn(countErr.message);

        const used = await getUserStorage(uid);

        res.json({
          success: true,
          count: rows.length,
          total: countRows[0]?.total || 0,
          page: Number(page),
          totalPages: Math.ceil((countRows[0]?.total || 0) / Number(limit)),
          files: rows,
          storage: {
            used,
            usedFormatted: fmtSize(used),
            max: MAX_STORAGE_BYTES,
            maxFormatted: fmtSize(MAX_STORAGE_BYTES),
            percent: Math.min(100, (used / MAX_STORAGE_BYTES) * 100).toFixed(1)
          }
        });
      });
    });
  } catch (err) {
    console.error("❌ List error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================
   2) UPLOAD FILE(S)  →  POST /api/files/upload
   Form-data: files (multiple), parent_id (optional)
   ========================================================= */
router.post("/upload", requireSession, async (req, res) => {
  try {
    const uid = req.session.admin_id;
    const parent_id = req.body.parent_id || null;

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    // Normalize files to array
    let files = req.files.files || req.files.file || req.files.upload;
    if (!files) return res.status(400).json({ success: false, message: "Field name must be 'files'" });
    if (!Array.isArray(files)) files = [files];

    // Quota check
    const totalNew = files.reduce((s, f) => s + (f.size || 0), 0);
    const used = await getUserStorage(uid);
    if (used + totalNew > MAX_STORAGE_BYTES) {
      return res.status(413).json({
        success: false,
        message: `Storage quota exceeded. Used: ${fmtSize(used)}, Limit: ${fmtSize(MAX_STORAGE_BYTES)}`
      });
    }

    const uploaded = [];
    const errors = [];

    for (const file of files) {
      try {
        const ext = path.extname(file.name).replace(".", "").toLowerCase();
        const category = getCategory(ext);

        // Determine resource type for Cloudinary
        let resource_type = "raw";
        if (category === "img") resource_type = "image";
        else if (category === "vid") resource_type = "video";

        // Upload to Cloudinary
        const result = await uploadToCloudinary(file.data, {
          folder: `cloudvault/user_${uid}`,
          resource_type,
          public_id: `file_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
        });

        // Insert to DB
        await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO file_manager 
             (owner_id, name, original_name, file_size, mime_type, extension, category, 
              cloud_url, public_id, resource_type, is_folder, parent_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())`,
            [
              uid,
              file.name,
              file.name,
              file.size || 0,
              file.mimetype || "application/octet-stream",
              ext,
              category,
              result.secure_url,
              result.public_id,
              result.resource_type,
              parent_id
            ],
            (err, r) => err ? reject(err) : resolve(r)
          );
        });

        uploaded.push({
          name: file.name,
          size: file.size,
          url: result.secure_url,
          public_id: result.public_id
        });

        logActivity(uid, "upload", file.name, req.ip);
      } catch (err) {
        console.error("❌ Upload file error:", err);
        errors.push({ file: file.name, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `${uploaded.length} file(s) uploaded`,
      uploaded,
      errors: errors.length ? errors : undefined
    });
  } catch (err) {
    console.error("❌ Upload route error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================
   3) CREATE FOLDER  →  POST /api/files/folder
   Body: { name, parent_id }
   ========================================================= */
router.post("/folder", requireSession, (req, res) => {
  const uid = req.session.admin_id;
  const { name, parent_id = null } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Folder name required" });
  }

  db.query(
    `INSERT INTO file_manager 
     (owner_id, name, original_name, file_size, mime_type, extension, category, 
      is_folder, parent_id, created_at)
     VALUES (?, ?, ?, 0, 'folder', '', 'folder', 1, ?, NOW())`,
    [uid, name.trim(), name.trim(), parent_id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      logActivity(uid, "create_folder", name, req.ip);
      res.json({ success: true, id: result.insertId, name });
    }
  );
});

/* =========================================================
   4) DOWNLOAD  →  GET /api/files/:id/download
   (Cloudinary URL redirect)
   ========================================================= */
router.get("/:id/download", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    `SELECT * FROM file_manager 
     WHERE id = ? AND owner_id = ? AND is_folder = 0`,
    [req.params.id, uid],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "File not found" });

      const f = rows[0];

      // Increment download count
      db.query("UPDATE file_manager SET download_count = download_count + 1 WHERE id = ?", [f.id]);

      logActivity(uid, "download", f.name, req.ip);

      // Cloudinary download URL with fl_attachment
      const downloadUrl = f.cloud_url.includes("/upload/")
        ? f.cloud_url.replace("/upload/", "/upload/fl_attachment/")
        : f.cloud_url;

      res.redirect(downloadUrl);
    }
  );
});

/* =========================================================
   5) PREVIEW  →  GET /api/files/:id/preview
   ========================================================= */
router.get("/:id/preview", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    `SELECT cloud_url, resource_type, mime_type FROM file_manager 
     WHERE id = ? AND owner_id = ? AND is_folder = 0`,
    [req.params.id, uid],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

      res.json({
        success: true,
        url: rows[0].cloud_url,
        resource_type: rows[0].resource_type,
        mime: rows[0].mime_type
      });
    }
  );
});

/* =========================================================
   6) RENAME  →  PATCH /api/files/:id/rename
   Body: { name }
   ========================================================= */
router.patch("/:id/rename", requireSession, (req, res) => {
  const uid = req.session.admin_id;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Name required" });
  }

  db.query(
    "UPDATE file_manager SET name = ? WHERE id = ? AND owner_id = ?",
    [name.trim(), req.params.id, uid],
    (err, r) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!r.affectedRows) return res.status(404).json({ success: false, message: "Not found" });
      logActivity(uid, "rename", name, req.ip);
      res.json({ success: true });
    }
  );
});

/* =========================================================
   7) STAR / UNSTAR  →  PATCH /api/files/:id/star
   ========================================================= */
router.patch("/:id/star", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    "SELECT starred FROM file_manager WHERE id = ? AND owner_id = ?",
    [req.params.id, uid],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

      const newVal = rows[0].starred ? 0 : 1;
      db.query(
        "UPDATE file_manager SET starred = ? WHERE id = ?",
        [newVal, req.params.id],
        (uErr) => {
          if (uErr) return res.status(500).json({ success: false, error: uErr.message });
          res.json({ success: true, starred: !!newVal });
        }
      );
    }
  );
});

/* =========================================================
   8) MOVE TO TRASH  →  DELETE /api/files/:id
   (Soft delete — sirf DB flag)
   ========================================================= */
router.delete("/:id", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    "SELECT * FROM file_manager WHERE id = ? AND owner_id = ?",
    [req.params.id, uid],
    async (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

      const f = rows[0];

      // If folder, recursively trash children
      if (f.is_folder) {
        try {
          await trashFolderRecursive(f.id, uid);
        } catch (e) {
          console.error("Trash recursive:", e);
        }
      }

      db.query(
        "UPDATE file_manager SET trashed = 1, trashed_at = NOW() WHERE id = ?",
        [f.id],
        (uErr) => {
          if (uErr) return res.status(500).json({ success: false, error: uErr.message });
          logActivity(uid, "trash", f.name, req.ip);
          res.json({ success: true, message: "Moved to trash" });
        }
      );
    }
  );
});

function trashFolderRecursive(folderId, uid) {
  return new Promise((resolve) => {
    db.query(
      "SELECT id, is_folder FROM file_manager WHERE parent_id = ? AND owner_id = ?",
      [folderId, uid],
      async (err, children) => {
        if (err || !children) return resolve();
        for (const c of children) {
          if (c.is_folder) await trashFolderRecursive(c.id, uid);
          await new Promise(r => db.query(
            "UPDATE file_manager SET trashed = 1, trashed_at = NOW() WHERE id = ?",
            [c.id],
            () => r()
          ));
        }
        resolve();
      }
    );
  });
}

/* =========================================================
   9) RESTORE FROM TRASH  →  POST /api/files/:id/restore
   ========================================================= */
router.post("/:id/restore", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    "SELECT * FROM file_manager WHERE id = ? AND owner_id = ? AND trashed = 1",
    [req.params.id, uid],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found in trash" });

      db.query(
        "UPDATE file_manager SET trashed = 0, trashed_at = NULL WHERE id = ?",
        [rows[0].id],
        (uErr) => {
          if (uErr) return res.status(500).json({ success: false, error: uErr.message });
          logActivity(uid, "restore", rows[0].name, req.ip);
          res.json({ success: true, message: "Restored" });
        }
      );
    }
  );
});

/* =========================================================
   10) PERMANENT DELETE  →  DELETE /api/files/:id/purge
   (Delete from Cloudinary + DB)
   ========================================================= */
router.delete("/:id/purge", requireSession, async (req, res) => {
  const uid = req.session.admin_id;

  try {
    await purgeRecursive(req.params.id, uid);
    logActivity(uid, "purge", req.params.id, req.ip);
    res.json({ success: true, message: "Permanently deleted" });
  } catch (err) {
    console.error("Purge error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function purgeRecursive(id, uid) {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM file_manager WHERE id = ? AND owner_id = ?",
      [id, uid],
      async (err, rows) => {
        if (err) return reject(err);
        if (!rows.length) return resolve();

        const f = rows[0];

        // Folder → purge children first
        if (f.is_folder) {
          const children = await new Promise(r => db.query(
            "SELECT id FROM file_manager WHERE parent_id = ?",
            [f.id],
            (e, c) => r(c || [])
          ));
          for (const c of children) await purgeRecursive(c.id, uid);
        } else if (f.public_id) {
          // Delete from Cloudinary
          try {
            await cloudinary.uploader.destroy(f.public_id, {
              resource_type: f.resource_type || "raw"
            });
          } catch (e) {
            console.warn("Cloudinary destroy warning:", e.message);
          }
        }

        // Delete from DB
        await new Promise(r => db.query("DELETE FROM file_manager WHERE id = ?", [f.id], () => r()));
        resolve();
      }
    );
  });
}

/* =========================================================
   11) EMPTY TRASH  →  DELETE /api/files/trash/empty
   ========================================================= */
router.delete("/trash/empty", requireSession, async (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    "SELECT id FROM file_manager WHERE owner_id = ? AND trashed = 1",
    [uid],
    async (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });

      let purged = 0;
      for (const r of rows) {
        try { await purgeRecursive(r.id, uid); purged++; } catch {}
      }

      logActivity(uid, "empty_trash", `${purged} items`, req.ip);
      res.json({ success: true, purged });
    }
  );
});

/* =========================================================
   12) BULK ACTION  →  POST /api/files/bulk
   Body: { ids:[], action: "trash"|"restore"|"purge"|"star"|"unstar"|"move", parent_id? }
   ========================================================= */
router.post("/bulk", requireSession, async (req, res) => {
  const uid = req.session.admin_id;
  const { ids = [], action, parent_id = null } = req.body;

  if (!ids.length || !action) {
    return res.status(400).json({ success: false, message: "ids and action required" });
  }

  let affected = 0;

  for (const id of ids) {
    try {
      if (action === "trash") {
        await new Promise(r => db.query(
          "UPDATE file_manager SET trashed = 1, trashed_at = NOW() WHERE id = ? AND owner_id = ?",
          [id, uid], () => r()
        ));
        affected++;
      } else if (action === "restore") {
        await new Promise(r => db.query(
          "UPDATE file_manager SET trashed = 0, trashed_at = NULL WHERE id = ? AND owner_id = ?",
          [id, uid], () => r()
        ));
        affected++;
      } else if (action === "purge") {
        await purgeRecursive(id, uid);
        affected++;
      } else if (action === "star") {
        await new Promise(r => db.query(
          "UPDATE file_manager SET starred = 1 WHERE id = ? AND owner_id = ?",
          [id, uid], () => r()
        ));
        affected++;
      } else if (action === "unstar") {
        await new Promise(r => db.query(
          "UPDATE file_manager SET starred = 0 WHERE id = ? AND owner_id = ?",
          [id, uid], () => r()
        ));
        affected++;
      } else if (action === "move") {
        await new Promise(r => db.query(
          "UPDATE file_manager SET parent_id = ? WHERE id = ? AND owner_id = ?",
          [parent_id, id, uid], () => r()
        ));
        affected++;
      }
    } catch (e) {
      console.warn(`Bulk ${action} failed for id ${id}:`, e.message);
    }
  }

  logActivity(uid, `bulk_${action}`, `${affected} items`, req.ip);
  res.json({ success: true, affected });
});

/* =========================================================
   13) DOWNLOAD FOLDER AS ZIP  →  GET /api/files/:id/zip
   ========================================================= */
router.get("/:id/zip", requireSession, async (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    "SELECT * FROM file_manager WHERE id = ? AND owner_id = ? AND is_folder = 1",
    [req.params.id, uid],
    async (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Folder not found" });

      const folder = rows[0];

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${folder.name}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", e => {
        console.error("Archive error:", e);
        res.status(500).end();
      });
      archive.pipe(res);

      await addFolderToZip(archive, folder.id, uid, "");
      archive.finalize();
    }
  );
});

async function addFolderToZip(archive, folderId, uid, basePath) {
  const children = await new Promise(r => db.query(
    "SELECT * FROM file_manager WHERE parent_id = ? AND owner_id = ? AND trashed = 0",
    [folderId, uid],
    (e, c) => r(c || [])
  ));

  for (const c of children) {
    if (c.is_folder) {
      await addFolderToZip(archive, c.id, uid, `${basePath}${c.name}/`);
    } else if (c.cloud_url) {
      // Stream from Cloudinary
      try {
        const https = require("https");
        const data = await new Promise((resolve, reject) => {
          https.get(c.cloud_url, resp => {
            const chunks = [];
            resp.on("data", ch => chunks.push(ch));
            resp.on("end", () => resolve(Buffer.concat(chunks)));
            resp.on("error", reject);
          }).on("error", reject);
        });
        archive.append(data, { name: `${basePath}${c.name}` });
      } catch (e) {
        console.warn(`Skipping ${c.name}:`, e.message);
      }
    }
  }
}

/* =========================================================
   14) FILE INFO  →  GET /api/files/:id/info
   ========================================================= */
router.get("/:id/info", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    `SELECT id, name, original_name, file_size, mime_type, extension, category,
            cloud_url, public_id, resource_type, is_folder, parent_id, starred,
            trashed, trashed_at, download_count, created_at, updated_at
     FROM file_manager WHERE id = ? AND owner_id = ?`,
    [req.params.id, uid],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

      res.json({
        success: true,
        file: { ...rows[0], file_size_formatted: fmtSize(rows[0].file_size) }
      });
    }
  );
});

/* =========================================================
   15) RECENT FILES  →  GET /api/files/recent/list
   ========================================================= */
router.get("/recent/list", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    `SELECT id, name, file_size, mime_type, extension, category, is_folder,
            cloud_url, created_at
     FROM file_manager
     WHERE owner_id = ? AND trashed = 0
     ORDER BY created_at DESC LIMIT 20`,
    [uid],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, files: rows || [] });
    }
  );
});

/* =========================================================
   16) SEARCH  →  GET /api/files/search?q=...
   ========================================================= */
router.get("/search", requireSession, (req, res) => {
  const uid = req.session.admin_id;
  const q = `%${req.query.q || ""}%`;

  db.query(
    `SELECT id, name, file_size, mime_type, extension, category, is_folder,
            cloud_url, created_at
     FROM file_manager
     WHERE owner_id = ? AND trashed = 0 AND (name LIKE ? OR original_name LIKE ?)
     ORDER BY created_at DESC LIMIT 100`,
    [uid, q, q],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, files: rows || [] });
    }
  );
});

/* =========================================================
   17) STORAGE STATS  →  GET /api/files/stats/info
   ========================================================= */
router.get("/stats/info", requireSession, async (req, res) => {
  const uid = req.session.admin_id;

  try {
    const stats = await new Promise((resolve, reject) => {
      db.query(
        `SELECT 
           COUNT(CASE WHEN is_folder = 0 AND trashed = 0 THEN 1 END) as total_files,
           COUNT(CASE WHEN is_folder = 1 AND trashed = 0 THEN 1 END) as total_folders,
           COUNT(CASE WHEN trashed = 1 THEN 1 END) as trash_items,
           COALESCE(SUM(CASE WHEN is_folder = 0 AND trashed = 0 THEN file_size ELSE 0 END), 0) as used_bytes,
           COALESCE(SUM(download_count), 0) as total_downloads
         FROM file_manager WHERE owner_id = ?`,
        [uid],
        (err, rows) => err ? reject(err) : resolve(rows[0])
      );
    });

    // Category breakdown
    const byCategory = await new Promise((resolve) => {
      db.query(
        `SELECT category, COUNT(*) as count, COALESCE(SUM(file_size),0) as size
         FROM file_manager WHERE owner_id = ? AND is_folder = 0 AND trashed = 0
         GROUP BY category`,
        [uid],
        (err, rows) => resolve(rows || [])
      );
    });

    res.json({
      success: true,
      stats: {
        totalFiles: stats.total_files,
        totalFolders: stats.total_folders,
        trashItems: stats.trash_items,
        totalDownloads: stats.total_downloads,
        storageUsed: stats.used_bytes,
        storageUsedFormatted: fmtSize(stats.used_bytes),
        storageMax: MAX_STORAGE_BYTES,
        storageMaxFormatted: fmtSize(MAX_STORAGE_BYTES),
        storagePercent: ((stats.used_bytes / MAX_STORAGE_BYTES) * 100).toFixed(1),
        byCategory
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================
   18) UPLOAD NEW VERSION  →  POST /api/files/:id/version
   ========================================================= */
router.post("/:id/version", requireSession, async (req, res) => {
  const uid = req.session.admin_id;

  if (!req.files || !req.files.file) {
    return res.status(400).json({ success: false, message: "New version file required (field: file)" });
  }

  const file = req.files.file;

  db.query(
    "SELECT * FROM file_manager WHERE id = ? AND owner_id = ? AND is_folder = 0",
    [req.params.id, uid],
    async (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

      const old = rows[0];

      try {
        // Save old as version
        const [[maxV]] = await new Promise(r => db.query(
          "SELECT COALESCE(MAX(version_no),0) as m FROM file_versions WHERE file_id = ?",
          [old.id],
          (e, res2) => r(res2 || [{ m: 0 }])
        ));

        await new Promise(r => db.query(
          `INSERT INTO file_versions (file_id, version_no, cloud_url, public_id, file_size, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [old.id, maxV.m + 1, old.cloud_url, old.public_id, old.file_size],
          () => r()
        ));

        // Upload new version to Cloudinary
        const ext = path.extname(file.name).replace(".", "").toLowerCase();
        const category = getCategory(ext);
        let resource_type = "raw";
        if (category === "img") resource_type = "image";
        else if (category === "vid") resource_type = "video";

        const result = await uploadToCloudinary(file.data, {
          folder: `cloudvault/user_${uid}`,
          resource_type
        });

        // Update DB
        await new Promise((resolve, reject) => db.query(
          `UPDATE file_manager 
           SET cloud_url = ?, public_id = ?, resource_type = ?, file_size = ?, mime_type = ?, extension = ?, updated_at = NOW()
           WHERE id = ?`,
          [result.secure_url, result.public_id, result.resource_type, file.size, file.mimetype, ext, old.id],
          (e) => e ? reject(e) : resolve()
        ));

        logActivity(uid, "version_upload", old.name, req.ip);
        res.json({ success: true, version: maxV.m + 1, url: result.secure_url });
      } catch (e) {
        console.error("Version upload error:", e);
        res.status(500).json({ success: false, error: e.message });
      }
    }
  );
});

/* =========================================================
   19) LIST VERSIONS  →  GET /api/files/:id/versions
   ========================================================= */
router.get("/:id/versions", requireSession, (req, res) => {
  const uid = req.session.admin_id;

  db.query(
    "SELECT id FROM file_manager WHERE id = ? AND owner_id = ?",
    [req.params.id, uid],
    (err, check) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!check.length) return res.status(404).json({ success: false, message: "Not found" });

      db.query(
        "SELECT * FROM file_versions WHERE file_id = ? ORDER BY version_no DESC",
        [req.params.id],
        (e, rows) => {
          if (e) return res.status(500).json({ success: false, error: e.message });
          res.json({ success: true, versions: rows || [] });
        }
      );
    }
  );
});

/* =========================================================
   20) ACTIVITY LOG  →  GET /api/files/activity/log
   ========================================================= */
router.get("/activity/log", requireSession, (req, res) => {
  const uid = req.session.admin_id;
  const limit = Number(req.query.limit) || 50;

  db.query(
    `SELECT * FROM file_activity WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [uid, limit],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, logs: rows || [] });
    }
  );
});

/* =========================================================
   21) AUTO-CLEAN OLD TRASH  →  Function (cron se call karo)
   ========================================================= */
async function autoCleanTrash() {
  return new Promise((resolve) => {
    db.query(
      `SELECT id, owner_id FROM file_manager
       WHERE trashed = 1 AND trashed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [TRASH_RETENTION_DAYS],
      async (err, rows) => {
        if (err) {
          console.error("Auto-clean error:", err.message);
          return resolve(0);
        }

        let purged = 0;
        for (const r of rows) {
          try {
            await purgeRecursive(r.id, r.owner_id);
            purged++;
          } catch (e) {
            console.warn("Auto-clean purge err:", e.message);
          }
        }
        console.log(`[AUTO-CLEAN] Purged ${purged} old trash items`);
        resolve(purged);
      }
    );
  });
}

/* =========================================================
   EXPORT
   ========================================================= */
module.exports = router;
module.exports.autoCleanTrash = autoCleanTrash;
module.exports.ensureTables = ensureTables;
