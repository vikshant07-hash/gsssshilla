const db = require("../config/db");
const cloudinary = require("../config/cloudinary");

// ==================== GET ALL UPDATES ====================
const getUpdates = (req, res) => {
  const { limit = 20, offset = 0 } = req.query;

  db.query(
    "SELECT * FROM recent_updates ORDER BY id DESC LIMIT ? OFFSET ?",
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

      // Get total count
      db.query(
        "SELECT COUNT(*) as total FROM recent_updates",
        (countErr, countResult) => {
          if (countErr) {
            console.error("❌ Count Error:", countErr);
          }

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

// ==================== ADD UPDATE ====================
const addUpdate = (req, res) => {
  const { title, description, category, link } = req.body;

  // Validation
  if (!title || !description) {
    return res.status(400).json({
      success: false,
      message: "Title and Description are required"
    });
  }

  // Cloudinary URL
  const fileUrl = req.file ? req.file.path : null;
  const filePublicId = req.file ? req.file.filename : null;
  const fileType = req.file ? req.file.mimetype : null;

  const now = new Date();

  db.query(
    `INSERT INTO recent_updates 
    (title, description, file, file_public_id, file_type, category, link, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      description,
      fileUrl,
      filePublicId,
      fileType,
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
            data: fetchResult ? fetchResult[0] : { id: result.insertId }
          });
        }
      );
    }
  );
};

// ==================== UPDATE UPDATE ====================
const updateUpdate = (req, res) => {
  const updateId = req.params.id;
  const { title, description, category, link } = req.body;

  if (!updateId || isNaN(updateId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid update ID"
    });
  }

  // First get existing update
  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [updateId],
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
      let fileUrl = existingUpdate.file;
      let filePublicId = existingUpdate.file_public_id;
      let fileType = existingUpdate.file_type;

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
        fileUrl = req.file.path;
        filePublicId = req.file.filename;
        fileType = req.file.mimetype;
      }

      // Update in database
      db.query(
        `UPDATE recent_updates 
        SET title = ?, description = ?, category = ?, 
            file = ?, file_public_id = ?, file_type = ?, 
            link = ?, updated_at = NOW()
        WHERE id = ?`,
        [
          title || existingUpdate.title,
          description || existingUpdate.description,
          category || existingUpdate.category,
          fileUrl,
          filePublicId,
          fileType,
          link || existingUpdate.link || null,
          updateId
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
            [updateId],
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
const deleteUpdate = (req, res) => {
  const updateId = req.params.id;

  if (!updateId || isNaN(updateId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid update ID"
    });
  }

  // First get update to delete file from Cloudinary
  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [updateId],
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
        [updateId],
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

// ==================== GET SINGLE UPDATE ====================
const getUpdateById = (req, res) => {
  const updateId = req.params.id;

  if (!updateId || isNaN(updateId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid update ID"
    });
  }

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [updateId],
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

// ==================== GET BY CATEGORY ====================
const getUpdatesByCategory = (req, res) => {
  const { category } = req.params;
  const { limit = 20 } = req.query;

  if (!category) {
    return res.status(400).json({
      success: false,
      message: "Category is required"
    });
  }

  db.query(
    "SELECT * FROM recent_updates WHERE category = ? ORDER BY id DESC LIMIT ?",
    [category, parseInt(limit)],
    (err, results) => {
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
        data: results
      });
    }
  );
};

// ==================== SEARCH UPDATES ====================
const searchUpdates = (req, res) => {
  const { query } = req.params;
  const { limit = 20 } = req.query;

  if (!query) {
    return res.status(400).json({
      success: false,
      message: "Search query is required"
    });
  }

  db.query(
    `SELECT * FROM recent_updates 
    WHERE title LIKE ? OR description LIKE ? 
    ORDER BY id DESC LIMIT ?`,
    [`%${query}%`, `%${query}%`, parseInt(limit)],
    (err, results) => {
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
        data: results
      });
    }
  );
};

module.exports = {
  getUpdates,
  addUpdate,
  updateUpdate,
  deleteUpdate,
  getUpdateById,
  getUpdatesByCategory,
  searchUpdates
};
