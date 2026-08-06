const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const { cloudinary } = require("./config/cloudinary");
const { uploadRecent } = require("./config/cloudinary");
const { db } = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== CORS ====================
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// ROOT & TEST
// ============================================================

app.get("/", (req, res) => {
  res.json({ success: true, message: "🏛️ School Management Backend" });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ Server Working!" });
});

// ============================================================
// RECENT ROUTES - WITH IST TIMEZONE
// ============================================================

// GET - All Updates (Admin) - WITH IST
app.get("/recent/admin/all", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
     FROM recent_updates ORDER BY created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results });
    }
  );
});

// GET - Public Updates - WITH IST
app.get("/recent/public", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM recent_updates ORDER BY created_at DESC LIMIT 20`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results });
    }
  );
});

// GET - Single Update - WITH IST
app.get("/recent/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
     FROM recent_updates WHERE id = ?`,
    [id],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      if (!results.length) {
        return res.status(404).json({ success: false, message: "Update not found" });
      }
      res.json({ success: true, data: results[0] });
    }
  );
});

// ============================================================
// POST - ADD UPDATE
// ============================================================

app.post("/recent/admin/add", uploadRecent.single("file"), (req, res) => {
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  const file_url = req.file ? req.file.path : null;
  const file_public_id = req.file ? req.file.filename : null;
  const file_type = req.file ? req.file.mimetype : null;
  const file_size = req.file ? req.file.size : null;

  db.query(
    `INSERT INTO recent_updates 
    (title, description, file_url, file_public_id, file_type, file_size, category, link, is_new, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      title,
      description || "",
      file_url,
      file_public_id,
      file_type,
      file_size,
      category || "general",
      link || null,
      isNew !== undefined ? parseInt(isNew) : 1
    ],
    (err, result) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      db.query(
        `SELECT *, 
         DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
         FROM recent_updates WHERE id = ?`,
        [result.insertId],
        (fetchErr, fetchResult) => {
          res.status(201).json({
            success: true,
            message: "✅ Update added successfully!",
            data: fetchResult ? fetchResult[0] : { id: result.insertId }
          });
        }
      );
    }
  );
});

// ============================================================
// PUT - UPDATE UPDATE
// ============================================================

app.put("/recent/admin/update/:id", uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult.length) {
      return res.status(404).json({ success: false, message: "Update not found" });
    }

    const existing = fetchResult[0];
    let file_url = existing.file_url;
    let file_public_id = existing.file_public_id;
    let file_type = existing.file_type;
    let file_size = existing.file_size;

    if (req.file) {
      if (existing.file_public_id) {
        cloudinary.uploader.destroy(existing.file_public_id)
          .catch(err => console.error("Cloudinary delete error:", err));
      }
      file_url = req.file.path;
      file_public_id = req.file.filename;
      file_type = req.file.mimetype;
      file_size = req.file.size;
    }

    db.query(
      `UPDATE recent_updates 
      SET title = ?, description = ?, file_url = ?, file_public_id = ?, 
          file_type = ?, file_size = ?, category = ?, link = ?, is_new = ?, updated_at = NOW()
      WHERE id = ?`,
      [
        title,
        description || existing.description,
        file_url,
        file_public_id,
        file_type,
        file_size,
        category || existing.category,
        link || existing.link || null,
        isNew !== undefined ? parseInt(isNew) : existing.is_new,
        id
      ],
      (updateErr) => {
        if (updateErr) {
          console.error("❌ Update Error:", updateErr);
          return res.status(500).json({ success: false, error: updateErr.message });
        }

        db.query(
          `SELECT *, 
           DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
           DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
           FROM recent_updates WHERE id = ?`,
          [id],
          (fetchUpdatedErr, fetchUpdatedResult) => {
            res.json({
              success: true,
              message: "✅ Update updated successfully!",
              data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
            });
          }
        );
      }
    );
  });
});

// ============================================================
// DELETE - DELETE UPDATE
// ============================================================

app.delete("/recent/admin/delete/:id", (req, res) => {
  const { id } = req.params;
  console.log("🗑️ DELETE ID:", id);

  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, message: "Database error", error: fetchErr.message });
    }

    if (!fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Update not found with ID: " + id });
    }

    const update = fetchResult[0];
    console.log("📦 Found:", update.title);

    if (update.file_public_id) {
      cloudinary.uploader.destroy(update.file_public_id)
        .then(result => console.log("✅ Cloudinary deleted:", result))
        .catch(err => console.error("❌ Cloudinary error:", err));
    }

    db.query("DELETE FROM recent_updates WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, message: "Failed to delete", error: deleteErr.message });
      }

      console.log("✅ Deleted ID:", id);
      res.json({ success: true, message: "✅ Update deleted successfully!" });
    });
  });
});

// ============================================================
// DELETE - BULK DELETE
// ============================================================

app.delete("/recent/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(`SELECT * FROM recent_updates WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    fetchResults.forEach(update => {
      if (update.file_public_id) {
        cloudinary.uploader.destroy(update.file_public_id)
          .catch(err => console.error("Cloudinary error:", err));
      }
    });

    db.query(`DELETE FROM recent_updates WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, error: deleteErr.message });
      }
      res.json({ success: true, message: `${ids.length} updates deleted successfully ✅` });
    });
  });
});

// ============================================================
// GET - ADMIN STATS
// ============================================================

app.get("/recent/admin/stats", (req, res) => {
  const queries = {
    total: "SELECT COUNT(*) as total FROM recent_updates",
    new: "SELECT COUNT(*) as new FROM recent_updates WHERE is_new = 1",
    old: "SELECT COUNT(*) as old FROM recent_updates WHERE is_new = 0",
    withFile: "SELECT COUNT(*) as withFile FROM recent_updates WHERE file_url IS NOT NULL"
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.query(query, (err, result) => {
      if (err) {
        console.error(`❌ Stats Error (${key}):`, err);
        results[key] = { error: err.message };
      } else {
        results[key] = result;
      }
      completed++;
      
      if (completed === totalQueries) {
        res.json({ success: true, data: results });
      }
    });
  });
});

// ============================================================
// 404 & ERROR HANDLER
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl,
    availableRoutes: [
      "/",
      "/test",
      "/recent/public",
      "/recent/admin/all",
      "/recent/admin/add",
      "/recent/admin/update/:id",
      "/recent/admin/delete/:id",
      "/recent/admin/bulk-delete",
      "/recent/admin/stats"
    ]
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

// ============================================================
// PORT
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🏛️ SERVER STARTED (IST Timezone)");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Timezone: IST (+05:30)`);
  console.log("=".repeat(50));
  console.log("✅ Available Routes:");
  console.log("  GET  /");
  console.log("  GET  /test");
  console.log("  GET  /recent/public");
  console.log("  GET  /recent/admin/all");
  console.log("  POST /recent/admin/add");
  console.log("  PUT  /recent/admin/update/:id");
  console.log("  DELETE /recent/admin/delete/:id");
  console.log("  DELETE /recent/admin/bulk-delete");
  console.log("  GET  /recent/admin/stats");
  console.log("=".repeat(50));
});
