const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const db = require("../config/db");

// ==================== CLOUDINARY STORAGE CONFIG ====================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "school/notifications", // Organized folder
    resource_type: "auto", // image + pdf + all files
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx"],
    transformation: [
      { quality: "auto" },
      { fetch_format: "auto" }
    ],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const originalName = file.originalname.split(".")[0].replace(/\s+/g, "-");
      return `notification-${originalName}-${uniqueSuffix}`;
    }
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword", 
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images, PDFs and Word documents are allowed!"), false);
    }
  }
});

// ==================== ADD NOTIFICATION ====================

router.post("/add", upload.single("file"), (req, res) => {
  const { title, message, type, isImportant, link } = req.body;

  // Validation
  if (!title || !message) {
    return res.status(400).json({
      success: false,
      message: "Title and Message are required",
    });
  }

  // Cloudinary URL (full URL store hoga)
  const fileUrl = req.file ? req.file.path : null;
  const filePublicId = req.file ? req.file.filename : null;

  // Get current timestamp
  const now = new Date();

  db.query(
    `INSERT INTO notifications 
    (title, message, file, type, isImportant, link, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      message,
      fileUrl,
      type || "general",
      isImportant || 0,
      link || null,
      now
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to add notification",
          error: err.message
        });
      }

      // Fetch the newly created notification
      db.query(
        "SELECT * FROM notifications WHERE id = ?",
        [result.insertId],
        (fetchErr, fetchResult) => {
          if (fetchErr) {
            console.error("❌ Fetch Error:", fetchErr);
          }

          res.status(201).json({
            success: true,
            message: "Notification added successfully ✅",
            data: fetchResult[0] || { id: result.insertId },
            file: fileUrl,
            filePublicId: filePublicId
          });
        }
      );
    }
  );
});

// ==================== GET ALL NOTIFICATIONS ====================

router.get("/", (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  db.query(
    "SELECT * FROM notifications ORDER BY id DESC LIMIT ? OFFSET ?",
    [parseInt(limit), parseInt(offset)],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch notifications",
          error: err.message
        });
      }

      // Get total count
      db.query(
        "SELECT COUNT(*) as total FROM notifications",
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
});

// ==================== GET IMPORTANT NOTIFICATIONS ====================

router.get("/important", (req, res) => {
  db.query(
    "SELECT * FROM notifications WHERE isImportant = 1 ORDER BY id DESC",
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch important notifications",
          error: err.message
        });
      }

      res.json({
        success: true,
        data: result
      });
    }
  );
});

// ==================== GET RECENT NOTIFICATIONS ====================

router.get("/recent", (req, res) => {
  const { limit = 10 } = req.query;

  db.query(
    "SELECT * FROM notifications ORDER BY id DESC LIMIT ?",
    [parseInt(limit)],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch recent notifications",
          error: err.message
        });
      }

      res.json({
        success: true,
        data: result
      });
    }
  );
});

// ==================== GET SINGLE NOTIFICATION ====================

router.get("/:id", (req, res) => {
  const notificationId = req.params.id;

  if (!notificationId || isNaN(notificationId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid notification ID"
    });
  }

  db.query(
    "SELECT * FROM notifications WHERE id = ?",
    [notificationId],
    (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch notification",
          error: err.message
        });
      }

      if (!result.length) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      res.json({
        success: true,
        data: result[0]
      });
    }
  );
});

// ==================== UPDATE NOTIFICATION ====================

router.put("/:id", upload.single("file"), (req, res) => {
  const notificationId = req.params.id;
  const { title, message, type, isImportant, link } = req.body;

  if (!notificationId || isNaN(notificationId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid notification ID"
    });
  }

  // First get existing notification
  db.query(
    "SELECT * FROM notifications WHERE id = ?",
    [notificationId],
    (fetchErr, fetchResult) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch notification",
          error: fetchErr.message
        });
      }

      if (!fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      const existingNotification = fetchResult[0];
      let fileUrl = existingNotification.file;
      let filePublicId = existingNotification.file_public_id || null;

      // If new file uploaded, delete old from Cloudinary
      if (req.file) {
        // Delete old file from Cloudinary if exists
        if (existingNotification.file_public_id) {
          cloudinary.uploader.destroy(
            existingNotification.file_public_id,
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
      }

      // Update notification
      db.query(
        `UPDATE notifications 
        SET title = ?, message = ?, type = ?, isImportant = ?, 
            file = ?, file_public_id = ?, link = ?, updated_at = NOW()
        WHERE id = ?`,
        [
          title || existingNotification.title,
          message || existingNotification.message,
          type || existingNotification.type,
          isImportant !== undefined ? isImportant : existingNotification.isImportant,
          fileUrl,
          filePublicId,
          link || existingNotification.link || null,
          notificationId
        ],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error:", updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to update notification",
              error: updateErr.message
            });
          }

          // Fetch updated notification
          db.query(
            "SELECT * FROM notifications WHERE id = ?",
            [notificationId],
            (fetchUpdatedErr, fetchUpdatedResult) => {
              if (fetchUpdatedErr) {
                console.error("❌ Fetch Updated Error:", fetchUpdatedErr);
              }

              res.json({
                success: true,
                message: "Notification updated successfully ✅",
                data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
              });
            }
          );
        }
      );
    }
  );
});

// ==================== DELETE NOTIFICATION ====================

router.delete("/:id", (req, res) => {
  const notificationId = req.params.id;

  if (!notificationId || isNaN(notificationId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid notification ID"
    });
  }

  // First get notification to delete file from Cloudinary
  db.query(
    "SELECT * FROM notifications WHERE id = ?",
    [notificationId],
    (fetchErr, fetchResult) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch notification",
          error: fetchErr.message
        });
      }

      if (!fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      const notification = fetchResult[0];

      // Delete file from Cloudinary if exists
      if (notification.file_public_id) {
        cloudinary.uploader.destroy(
          notification.file_public_id,
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
        "DELETE FROM notifications WHERE id = ?",
        [notificationId],
        (deleteDbErr) => {
          if (deleteDbErr) {
            console.error("❌ Delete Error:", deleteDbErr);
            return res.status(500).json({
              success: false,
              message: "Failed to delete notification",
              error: deleteDbErr.message
            });
          }

          res.json({
            success: true,
            message: "Notification deleted successfully ✅"
          });
        }
      );
    }
  );
});

// ==================== TOGGLE IMPORTANT STATUS ====================

router.patch("/:id/toggle-important", (req, res) => {
  const notificationId = req.params.id;

  if (!notificationId || isNaN(notificationId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid notification ID"
    });
  }

  db.query(
    "UPDATE notifications SET isImportant = NOT isImportant WHERE id = ?",
    [notificationId],
    (err, result) => {
      if (err) {
        console.error("❌ Update Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to toggle important status",
          error: err.message
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Notification not found"
        });
      }

      // Get updated notification
      db.query(
        "SELECT * FROM notifications WHERE id = ?",
        [notificationId],
        (fetchErr, fetchResult) => {
          if (fetchErr) {
            console.error("❌ Fetch Error:", fetchErr);
          }

          res.json({
            success: true,
            message: "Important status toggled successfully ✅",
            data: fetchResult ? fetchResult[0] : null
          });
        }
      );
    }
  );
});

// ==================== SEARCH NOTIFICATIONS ====================

router.get("/search/:query", (req, res) => {
  const searchQuery = req.params.query;
  const { limit = 20 } = req.query;

  if (!searchQuery) {
    return res.status(400).json({
      success: false,
      message: "Search query is required"
    });
  }

  db.query(
    `SELECT * FROM notifications 
    WHERE title LIKE ? OR message LIKE ? 
    ORDER BY id DESC LIMIT ?`,
    [`%${searchQuery}%`, `%${searchQuery}%`, parseInt(limit)],
    (err, result) => {
      if (err) {
        console.error("❌ Search Error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to search notifications",
          error: err.message
        });
      }

      res.json({
        success: true,
        data: result
      });
    }
  );
});

module.exports = router;
