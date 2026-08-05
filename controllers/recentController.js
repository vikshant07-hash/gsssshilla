const db = require("../config/db");
const cloudinary = require("../config/cloudinary");

// ==================== GET ALL UPDATES ====================
exports.getUpdates = (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  db.query(
    `
    SELECT * FROM recent_updates
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
    `,
    [parseInt(limit), parseInt(offset)],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: err.message
        });
      }

      // Get total count
      db.query(
        "SELECT COUNT(*) as total FROM recent_updates",
        (countErr, countResult) => {
          if (countErr) {
            console.error("❌ Count Error:", countErr);
          }

          res.json({
            success: true,
            data: result,
            pagination: {
              total: countResult ? countResult[0].total : result.length,
              limit: parseInt(limit),
              offset: parseInt(offset)
            }
          });
        }
      );
    }
  );
};

// ==================== GET SINGLE UPDATE ====================
exports.getUpdateById = (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid update ID"
    });
  }

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch update",
          error: err.message
        });
      }

      if (!result.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      res.json({
        success: true,
        data: result[0]
      });
    }
  );
};

// ==================== ADD UPDATE ====================
exports.addUpdate = (req, res) => {
  const { title, description, category, link } = req.body;

  // Validation
  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  // Cloudinary URL from multer
  const file_url = req.file ? req.file.path : null;
  const file_public_id = req.file ? req.file.filename : null;
  const file_type = req.file ? req.file.mimetype : null;

  const now = new Date();

  db.query(
    `
    INSERT INTO recent_updates 
    (title, description, file_url, file_public_id, file_type, category, link, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      title,
      description || "",
      file_url,
      file_public_id,
      file_type,
      category || "general",
      link || null,
      now
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

      // Fetch the newly created update
      db.query(
        "SELECT * FROM recent_updates WHERE id = ?",
        [result.insertId],
        (fetchErr, fetchResult) => {
          if (fetchErr) {
            console.error("❌ Fetch Error:", fetchErr);
          }

          res.status(201).json({
            success: true,
            message: "Update added successfully ✅",
            data: fetchResult ? fetchResult[0] : { id: result.insertId },
            file: file_url
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

  // Validation
  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid update ID"
    });
  }

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  // First get existing update
  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch update",
          error: fetchErr.message
        });
      }

      if (!fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      const existingUpdate = fetchResult[0];
      let file_url = existingUpdate.file_url;
      let file_public_id = existingUpdate.file_public_id;
      let file_type = existingUpdate.file_type;

      // If new file uploaded, delete old from Cloudinary
      if (req.file) {
        // Delete old file from Cloudinary if exists
        if (existingUpdate.file_public_id) {
          cloudinary.uploader.destroy(
            existingUpdate.file_public_id,
            (deleteErr) => {
              if (deleteErr) {
                console.error("❌ Cloudinary Delete Error:", deleteErr);
              } else {
                console.log("✅ Old file deleted from Cloudinary");
              }
            }
          );
        }
        file_url = req.file.path;
        file_public_id = req.file.filename;
        file_type = req.file.mimetype;
      }

      // Update in database
      db.query(
        `
        UPDATE recent_updates 
        SET title = ?, 
            description = ?, 
            file_url = ?, 
            file_public_id = ?, 
            file_type = ?, 
            category = ?, 
            link = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [
          title,
          description || existingUpdate.description,
          file_url,
          file_public_id,
          file_type,
          category || existingUpdate.category,
          link || existingUpdate.link || null,
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

          // Fetch updated update
          db.query(
            "SELECT * FROM recent_updates WHERE id = ?",
            [id],
            (fetchUpdatedErr, fetchUpdatedResult) => {
              if (fetchUpdatedErr) {
                console.error("❌ Fetch Updated Error:", fetchUpdatedErr);
              }

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

  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid update ID"
    });
  }

  // First get update to delete file from Cloudinary
  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch update",
          error: fetchErr.message
        });
      }

      if (!fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      const update = fetchResult[0];

      // Delete file from Cloudinary if exists
      if (update.file_public_id) {
        cloudinary.uploader.destroy(
          update.file_public_id,
          (deleteErr) => {
            if (deleteErr) {
              console.error("❌ Cloudinary Delete Error:", deleteErr);
            } else {
              console.log("✅ File deleted from Cloudinary");
            }
          }
        );
      }

      // Delete from database
      db.query(
        "DELETE FROM recent_updates WHERE id = ?",
        [id],
        (deleteDbErr) => {
          if (deleteDbErr) {
            console.error("❌ Delete Error:", deleteDbErr);
            return res.status(500).json({
              success: false,
              message: "Failed to delete update",
              error: deleteDbErr.message
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

// ==================== GET BY CATEGORY ====================
exports.getUpdatesByCategory = (req, res) => {
  const { category } = req.params;
  const { limit = 20 } = req.query;

  if (!category) {
    return res.status(400).json({
      success: false,
      message: "Category is required"
    });
  }

  db.query(
    "SELECT * FROM recent_updates WHERE category = ? ORDER BY created_at DESC LIMIT ?",
    [category, parseInt(limit)],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: err.message
        });
      }

      res.json({
        success: true,
        data: result
      });
    }
  );
};

// ==================== SEARCH UPDATES ====================
exports.searchUpdates = (req, res) => {
  const { query } = req.params;
  const { limit = 20 } = req.query;

  if (!query) {
    return res.status(400).json({
      success: false,
      message: "Search query is required"
    });
  }

  db.query(
    `
    SELECT * FROM recent_updates 
    WHERE title LIKE ? OR description LIKE ? 
    ORDER BY created_at DESC 
    LIMIT ?
    `,
    [`%${query}%`, `%${query}%`, parseInt(limit)],
    (err, result) => {
      if (err) {
        console.error("❌ Search Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to search updates",
          error: err.message
        });
      }

      res.json({
        success: true,
        data: result
      });
    }
  );
};

// ==================== GET RECENT UPDATES ====================
exports.getRecentUpdates = (req, res) => {
  const { limit = 5 } = req.query;

  db.query(
    "SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT ?",
    [parseInt(limit)],
    (err, result) => {
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
        data: result
      });
    }
  );
};
