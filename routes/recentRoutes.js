const express = require("express");
const router = express.Router();
const db = require("../config/db");
const cloudinary = require("../config/cloudinary");
const { uploadRecent } = require("../config/cloudinary");
const verifyToken = require("../middleware/authMiddleware");

// ============================================================
// ==================== HELPER FUNCTIONS ====================
// ============================================================

function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function getFileTypeDisplay(mimeType) {
  if (!mimeType) return '📄 No File';
  if (mimeType.startsWith('image/')) return '🖼️ Image';
  if (mimeType === 'application/pdf') return '📄 PDF';
  if (mimeType.startsWith('audio/')) return '🎵 Audio';
  if (mimeType.startsWith('video/')) return '🎬 Video';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝 Document';
  return '📎 File';
}

function getFileIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.startsWith('video/')) return '🎬';
  return '📎';
}

// ============================================================
// ==================== PUBLIC ROUTES ====================
// ============================================================

// GET - Public Updates with NEW tag (24 hours)
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

      const formattedData = results.map(item => ({
        ...item,
        is_new: item.created_at > new Date(Date.now() - 24 * 60 * 60 * 1000),
        file_icon: getFileIcon(item.file_type),
        file_type_display: getFileTypeDisplay(item.file_type),
        created_at_formatted: formatDateTime(item.created_at)
      }));

      res.json({
        success: true,
        data: formattedData
      });
    }
  );
});

// GET - Recent Updates for Scrolling Box
router.get("/recent", (req, res) => {
  const { limit = 10 } = req.query;

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
          message: "Failed to fetch recent updates",
          error: err.message
        });
      }

      res.json({
        success: true,
        data: results
      });
    }
  );
});

// GET - Single Update (Public)
router.get("/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (err, results) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch update",
          error: err.message
        });
      }

      if (!results.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      res.json({
        success: true,
        data: results[0]
      });
    }
  );
});

// ============================================================
// ==================== ADMIN ROUTES ====================
// ============================================================

// GET - All Updates with Pagination
router.get("/admin/all", verifyToken, (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    search = "", 
    category = "all",
    status = "all"
  } = req.query;

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

  db.query(
    `SELECT COUNT(*) as total FROM recent_updates WHERE ${whereClause}`,
    params,
    (countErr, countResult) => {
      if (countErr) {
        console.error("❌ Count Error:", countErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: countErr.message
        });
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
            console.error("❌ Database Error:", err);
            return res.status(500).json({
              success: false,
              message: "Failed to fetch updates",
              error: err.message
            });
          }

          const formattedData = results.map(item => ({
            ...item,
            created_at_formatted: formatDateTime(item.created_at),
            updated_at_formatted: formatDateTime(item.updated_at),
            file_icon: getFileIcon(item.file_type),
            file_type_display: getFileTypeDisplay(item.file_type),
            is_new_badge: item.is_new ? '🆕 New' : '📌 Old',
            is_new_class: item.is_new ? 'badge-new' : 'badge-old'
          }));

          res.json({
            success: true,
            data: formattedData,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: total,
              totalPages: Math.ceil(total / parseInt(limit)),
              hasNext: parseInt(page) * parseInt(limit) < total,
              hasPrev: parseInt(page) > 1
            }
          });
        }
      );
    }
  );
});

// GET - Admin Stats
router.get("/admin/stats", verifyToken, (req, res) => {
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
        res.json({
          success: true,
          data: results
        });
      }
    });
  });
});

// POST - Add Update
router.post("/admin/add", verifyToken, uploadRecent.single("file"), (req, res) => {
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  const file_url = req.file ? req.file.path : null;
  const file_public_id = req.file ? req.file.filename : null;
  const file_type = req.file ? req.file.mimetype : null;
  const file_size = req.file ? req.file.size : null;
  const file_original_name = req.file ? req.file.originalname : null;

  db.query(
    `INSERT INTO recent_updates 
    (title, description, file_url, file_public_id, file_type, file_size, 
     file_original_name, category, link, is_new, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      title,
      description || "",
      file_url,
      file_public_id,
      file_type,
      file_size,
      file_original_name,
      category || "general",
      link || null,
      isNew !== undefined ? parseInt(isNew) : 1
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to add update",
          error: err.message
        });
      }

      db.query(
        "SELECT * FROM recent_updates WHERE id = ?",
        [result.insertId],
        (fetchErr, fetchResult) => {
          res.status(201).json({
            success: true,
            message: "Update added successfully ✅",
            data: fetchResult ? fetchResult[0] : { id: result.insertId }
          });
        }
      );
    }
  );
});

// PUT - Update Update
router.put("/admin/update/:id", verifyToken, uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr || !fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      const existing = fetchResult[0];
      let file_url = existing.file_url;
      let file_public_id = existing.file_public_id;
      let file_type = existing.file_type;
      let file_size = existing.file_size;
      let file_original_name = existing.file_original_name;

      if (req.file) {
        if (existing.file_public_id) {
          cloudinary.uploader.destroy(existing.file_public_id)
            .catch(err => console.error("Cloudinary delete error:", err));
        }
        file_url = req.file.path;
        file_public_id = req.file.filename;
        file_type = req.file.mimetype;
        file_size = req.file.size;
        file_original_name = req.file.originalname;
      }

      db.query(
        `UPDATE recent_updates 
        SET title = ?, description = ?, file_url = ?, file_public_id = ?, 
            file_type = ?, file_size = ?, file_original_name = ?,
            category = ?, link = ?, is_new = ?, updated_at = NOW()
        WHERE id = ?`,
        [
          title,
          description || existing.description,
          file_url,
          file_public_id,
          file_type,
          file_size,
          file_original_name,
          category || existing.category,
          link || existing.link || null,
          isNew !== undefined ? parseInt(isNew) : existing.is_new,
          id
        ],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error:", updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to update",
              error: updateErr.message
            });
          }

          db.query(
            "SELECT * FROM recent_updates WHERE id = ?",
            [id],
            (fetchUpdatedErr, fetchUpdatedResult) => {
              res.json({
                success: true,
                message: "Update updated successfully ✅",
                data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
              });
            }
          );
        }
      );
    }
  );
});

// DELETE - Delete Update
router.delete("/admin/delete/:id", verifyToken, (req, res) => {
  const { id } = req.params;

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr || !fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      const update = fetchResult[0];

      if (update.file_public_id) {
        cloudinary.uploader.destroy(update.file_public_id)
          .catch(err => console.error("Cloudinary delete error:", err));
      }

      db.query(
        "DELETE FROM recent_updates WHERE id = ?",
        [id],
        (deleteErr) => {
          if (deleteErr) {
            console.error("❌ Delete Error:", deleteErr);
            return res.status(500).json({
              success: false,
              message: "Failed to delete",
              error: deleteErr.message
            });
          }

          res.json({
            success: true,
            message: "Update deleted successfully ✅"
          });
        }
      );
    }
  );
});

// PATCH - Toggle New Status
router.patch("/admin/toggle-new/:id", verifyToken, (req, res) => {
  const { id } = req.params;

  db.query(
    "UPDATE recent_updates SET is_new = NOT is_new, updated_at = NOW() WHERE id = ?",
    [id],
    (err) => {
      if (err) {
        console.error("❌ Update Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to toggle status",
          error: err.message
        });
      }

      res.json({
        success: true,
        message: "Status toggled successfully ✅"
      });
    }
  );
});

// DELETE - Bulk Delete
router.delete("/admin/bulk-delete", verifyToken, (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No IDs provided"
    });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(
    `SELECT * FROM recent_updates WHERE id IN (${placeholders})`,
    ids,
    (fetchErr, fetchResults) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: fetchErr.message
        });
      }

      fetchResults.forEach(update => {
        if (update.file_public_id) {
          cloudinary.uploader.destroy(update.file_public_id)
            .catch(err => console.error("Cloudinary delete error:", err));
        }
      });

      db.query(
        `DELETE FROM recent_updates WHERE id IN (${placeholders})`,
        ids,
        (deleteErr) => {
          if (deleteErr) {
            console.error("❌ Delete Error:", deleteErr);
            return res.status(500).json({
              success: false,
              message: "Failed to delete",
              error: deleteErr.message
            });
          }

          res.json({
            success: true,
            message: `${ids.length} updates deleted successfully ✅`
          });
        }
      );
    }
  );
});

module.exports = router;
