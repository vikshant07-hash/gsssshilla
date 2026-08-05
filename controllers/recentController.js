const db = require("../config/db");
const { deleteFromCloudinary } = require("../config/cloudinary");

// ==================== GET ALL UPDATES (Admin) ====================
exports.getUpdates = (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  db.query(
    `SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [parseInt(limit), parseInt(offset)],
    (err, results) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: err.message
        });
      }

      db.query(
        "SELECT COUNT(*) as total FROM recent_updates",
        (countErr, countResult) => {
          res.json({
            success: true,
            data: results,
            pagination: {
              total: countResult ? countResult[0].total : results.length,
              limit: parseInt(limit),
              offset: parseInt(offset)
            }
          });
        }
      );
    }
  );
};

// ==================== GET PUBLIC UPDATES (With NEW Tag) ====================
exports.getPublicUpdates = (req, res) => {
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

      // Format data for frontend
      const formattedData = results.map(item => ({
        ...item,
        is_new: item.created_at > new Date(Date.now() - 24 * 60 * 60 * 1000),
        file_type_display: getFileTypeDisplay(item.file_type),
        file_icon: getFileIcon(item.file_type)
      }));

      res.json({
        success: true,
        data: formattedData
      });
    }
  );
};

// ==================== GET RECENT UPDATES (Homepage) ====================
exports.getRecentUpdates = (req, res) => {
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
};

// ==================== GET SINGLE UPDATE ====================
exports.getUpdateById = (req, res) => {
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
};

// ==================== ADD UPDATE ====================
exports.addUpdate = (req, res) => {
  const { title, description, category, link } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  // Cloudinary file details
  const file_url = req.file ? req.file.path : null;
  const file_public_id = req.file ? req.file.filename : null;
  const file_type = req.file ? req.file.mimetype : null;
  const file_size = req.file ? req.file.size : null;

  db.query(
    `INSERT INTO recent_updates 
    (title, description, file_url, file_public_id, file_type, file_size, category, link, is_new) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      description || "",
      file_url,
      file_public_id,
      file_type,
      file_size,
      category || "general",
      link || null,
      1 // New by default
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
            data: fetchResult ? fetchResult[0] : { id: result.insertId },
            file: file_url,
            fileType: file_type
          });
        }
      );
    }
  );
};

// ==================== UPDATE UPDATE ====================
exports.updateUpdate = (req, res) => {
  const { id } = req.params;
  const { title, description, category, link } = req.body;

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

      // If new file uploaded, delete old from Cloudinary
      if (req.file) {
        if (existing.file_public_id) {
          deleteFromCloudinary(existing.file_public_id);
        }
        file_url = req.file.path;
        file_public_id = req.file.filename;
        file_type = req.file.mimetype;
        file_size = req.file.size;
      }

      db.query(
        `UPDATE recent_updates 
        SET title = ?, description = ?, file_url = ?, file_public_id = ?, 
            file_type = ?, file_size = ?, category = ?, link = ?, updated_at = NOW()
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
          id
        ],
        (updateErr) => {
          if (updateErr) {
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
};

// ==================== DELETE UPDATE ====================
exports.deleteUpdate = (req, res) => {
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

      // Delete file from Cloudinary
      if (update.file_public_id) {
        deleteFromCloudinary(update.file_public_id);
      }

      db.query(
        "DELETE FROM recent_updates WHERE id = ?",
        [id],
        (deleteErr) => {
          if (deleteErr) {
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
};

// ==================== TOGGLE NEW STATUS ====================
exports.toggleNewStatus = (req, res) => {
  const { id } = req.params;

  db.query(
    "UPDATE recent_updates SET is_new = NOT is_new WHERE id = ?",
    [id],
    (err) => {
      if (err) {
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
};

// ==================== HELPER FUNCTIONS ====================

function getFileTypeDisplay(mimeType) {
  if (!mimeType) return "file";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("word") || mimeType.includes("document")) return "document";
  return "file";
}

function getFileIcon(mimeType) {
  if (!mimeType) return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  return "📄";
}
