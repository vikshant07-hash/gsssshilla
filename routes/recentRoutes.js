const express = require("express");
const router = express.Router();
const db = require("../config/db");
// ✅ SAHI IMPORT PATH
const { cloudinary } = require("../config/cloudinary");
const { uploadRecent } = require("../config/cloudinary");

// ============================================================
// PUBLIC ROUTES
// ============================================================

router.get("/public", (req, res) => {
  const { limit = 20 } = req.query;

  db.query(
    `SELECT *, 
     CASE 
       WHEN created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 
       ELSE 0 
     END as is_new_dynamic
     FROM recent_updates 
     ORDER BY created_at DESC 
     LIMIT ?`,
    [parseInt(limit)],
    (err, results) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: err.message
        });
      }
      res.json({ success: true, data: results });
    }
  );
});

router.get("/:id", (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (err, results) => {
    if (err) {
      console.error("❌ Database Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
    if (!results.length) {
      return res.status(404).json({ success: false, message: "Update not found" });
    }
    res.json({ success: true, data: results[0] });
  });
});

// ============================================================
// ADMIN ROUTES
// ============================================================

router.get("/admin/all", (req, res) => {
  const { page = 1, limit = 10, search = "", category = "all", status = "all" } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  let whereClause = "1=1";
  let params = [];

  if (search) {
    whereClause += " AND (title LIKE ? OR description LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category && category !== "all") {
    whereClause += " AND category = ?";
    params.push(category);
  }
  if (status && status !== "all") {
    whereClause += " AND is_new = ?";
    params.push(parseInt(status));
  }

  db.query(`SELECT COUNT(*) as total FROM recent_updates WHERE ${whereClause}`, params, (countErr, countResult) => {
    if (countErr) {
      return res.status(500).json({ success: false, error: countErr.message });
    }

    const total = countResult[0].total;

    db.query(
      `SELECT * FROM recent_updates 
      WHERE ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset],
      (err, results) => {
        if (err) {
          return res.status(500).json({ success: false, error: err.message });
        }

        res.json({
          success: true,
          data: results,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: total,
            totalPages: Math.ceil(total / parseInt(limit))
          }
        });
      }
    );
  });
});

router.get("/admin/stats", (req, res) => {
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

// POST - Add Update
router.post("/admin/add", uploadRecent.single("file"), (req, res) => {
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

      db.query("SELECT * FROM recent_updates WHERE id = ?", [result.insertId], (fetchErr, fetchResult) => {
        res.status(201).json({
          success: true,
          message: "✅ Update added successfully!",
          data: fetchResult ? fetchResult[0] : { id: result.insertId }
        });
      });
    }
  );
});

// PUT - Update Update
router.put("/admin/update/:id", uploadRecent.single("file"), (req, res) => {
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
          return res.status(500).json({ success: false, error: updateErr.message });
        }

        db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchUpdatedErr, fetchUpdatedResult) => {
          res.json({
            success: true,
            message: "✅ Update updated successfully!",
            data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
          });
        });
      }
    );
  });
});

// DELETE - Delete Update
router.delete("/admin/delete/:id", (req, res) => {
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

// DELETE - Bulk Delete
router.delete("/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(`SELECT * FROM recent_updates WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) {
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
        return res.status(500).json({ success: false, error: deleteErr.message });
      }
      res.json({ success: true, message: `${ids.length} updates deleted successfully ✅` });
    });
  });
});

// PATCH - Toggle New Status
router.patch("/admin/toggle-new/:id", (req, res) => {
  const { id } = req.params;

  db.query("UPDATE recent_updates SET is_new = NOT is_new, updated_at = NOW() WHERE id = ?", [id], (err) => {
    if (err) {
      console.error("❌ Update Error:", err);
      return res.status(500).json({ success: false, message: "Failed to toggle status", error: err.message });
    }
    res.json({ success: true, message: "✅ Status toggled successfully!" });
  });
});

module.exports = router;
