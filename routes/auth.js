const express = require("express");
const router = express.Router();
const db = require("../config/db");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const verifyToken = require("../middleware/authMiddleware");

// ==================== BREVO SMTP CONFIG ====================

async function sendEmail(to, otp, title, type = "login") {
  try {
    // Different templates for different purposes
    let template = "";
    
    if (type === "login") {
      template = getLoginOTPTemplate(otp, title);
    } else if (type === "reset") {
      template = getResetOTPTemplate(otp, title);
    } else {
      template = getOTPTemplate(otp, title);
    }

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "Govt. Sr. Sec. School Shilla",
          email: process.env.BREVO_SENDER_EMAIL || "noreply@gsssshilla.com"
        },
        to: [{ email: to }],
        subject: title,
        htmlContent: template
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );
    return true;
  } catch (err) {
    console.error("❌ BREVO ERROR:", err.response?.data || err.message);
    return false;
  }
}

// ==================== OTP GENERATOR ====================

function generateOTP() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "0123456789";
  let otp = "";
  for (let i = 0; i < 2; i++) {
    otp += letters[Math.floor(Math.random() * letters.length)];
  }
  for (let i = 0; i < 4; i++) {
    otp += numbers[Math.floor(Math.random() * numbers.length)];
  }
  return otp;
}

// ==================== EMAIL TEMPLATES ====================

function getLoginOTPTemplate(otp, title) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#0b1220;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;background:#0b1220;">
      <div style="background:linear-gradient(145deg,#111827,#1a2332);padding:40px;border-radius:16px;border:1px solid #2a3a5a;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        
        <!-- Header -->
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:48px;margin-bottom:10px;">🏫</div>
          <h1 style="color:#ffffff;font-size:24px;margin:0;font-weight:700;">Govt. Sr. Sec. School</h1>
          <p style="color:#94a3b8;font-size:14px;margin:5px 0 0;">Shilla, Himachal Pradesh</p>
        </div>

        <!-- Divider -->
        <div style="height:2px;background:linear-gradient(90deg,transparent,#ce0c9d,transparent);margin:20px 0;"></div>

        <!-- Title -->
        <h2 style="color:#ffffff;font-size:20px;text-align:center;margin:20px 0 10px;">${title}</h2>
        
        <!-- OTP Box -->
        <div style="background:#0f172a;border:2px dashed #ce0c9d;border-radius:12px;padding:25px;margin:25px 0;text-align:center;">
          <div style="font-size:36px;letter-spacing:8px;font-weight:bold;color:#facc15;font-family:'Courier New',monospace;">
            ${otp}
          </div>
        </div>

        <!-- Instructions -->
        <div style="text-align:center;color:#94a3b8;font-size:14px;line-height:1.6;">
          <p style="margin:5px 0;">⏱️ This OTP is valid for <span style="color:#facc15;font-weight:bold;">5 minutes</span></p>
          <p style="margin:5px 0;">🔒 For security, please do not share this OTP with anyone</p>
        </div>

        <!-- Footer -->
        <div style="margin-top:30px;padding-top:20px;border-top:1px solid #1e293b;text-align:center;font-size:12px;color:#475569;">
          <p style="margin:5px 0;">This is an automated message from School Management System</p>
          <p style="margin:5px 0;">© ${new Date().getFullYear()} Govt. Sr. Sec. School Shilla</p>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

function getResetOTPTemplate(otp, title) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#0b1220;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;background:#0b1220;">
      <div style="background:linear-gradient(145deg,#111827,#1a2332);padding:40px;border-radius:16px;border:1px solid #2a3a5a;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:48px;margin-bottom:10px;">🔐</div>
          <h1 style="color:#ffffff;font-size:24px;margin:0;font-weight:700;">Password Reset</h1>
          <p style="color:#94a3b8;font-size:14px;margin:5px 0 0;">Govt. Sr. Sec. School Shilla</p>
        </div>

        <div style="height:2px;background:linear-gradient(90deg,transparent,#ce0c9d,transparent);margin:20px 0;"></div>

        <h2 style="color:#ffffff;font-size:18px;text-align:center;margin:20px 0 10px;">${title}</h2>
        
        <div style="background:#0f172a;border:2px dashed #facc15;border-radius:12px;padding:25px;margin:25px 0;text-align:center;">
          <div style="font-size:36px;letter-spacing:8px;font-weight:bold;color:#facc15;font-family:'Courier New',monospace;">
            ${otp}
          </div>
        </div>

        <div style="text-align:center;color:#94a3b8;font-size:14px;line-height:1.6;">
          <p style="margin:5px 0;">⏱️ This OTP is valid for <span style="color:#facc15;font-weight:bold;">5 minutes</span></p>
          <p style="margin:5px 0;">🔒 For security, please do not share this OTP with anyone</p>
          <p style="margin:10px 0 0;color:#f87171;font-size:13px;">⚠️ If you didn't request this, please ignore this email</p>
        </div>

        <div style="margin-top:30px;padding-top:20px;border-top:1px solid #1e293b;text-align:center;font-size:12px;color:#475569;">
          <p style="margin:5px 0;">This is an automated message from School Management System</p>
          <p style="margin:5px 0;">© ${new Date().getFullYear()} Govt. Sr. Sec. School Shilla</p>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

function getOTPTemplate(otp, title) {
  return getLoginOTPTemplate(otp, title);
}

// ==================== SEND OTP FOR LOGIN ====================

router.post("/send-otp", (req, res) => {
  const { username, password } = req.body;

  // Validation
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required"
    });
  }

  db.query(
    "SELECT * FROM admins WHERE username = ?",
    [username],
    async (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error occurred"
        });
      }

      if (!results.length) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      const user = results[0];

      // Check if account is active
      if (user.status === 'inactive') {
        return res.status(403).json({
          success: false,
          message: "Account is deactivated. Please contact admin."
        });
      }

      // Verify password
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      // Generate OTP
      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;

      // Save OTP to database
      db.query(
        "UPDATE admins SET otp = ?, otp_expiry = ? WHERE id = ?",
        [otp, expiry, user.id],
        async (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error:", updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to generate OTP"
            });
          }

          // Send OTP via email
          const sent = await sendEmail(
            user.email,
            otp,
            "ADMIN LOGIN OTP",
            "login"
          );

          if (!sent) {
            return res.status(500).json({
              success: false,
              message: "Failed to send OTP. Please try again."
            });
          }

          // Log login attempt (for security)
          console.log(`✅ OTP sent to admin: ${user.username} (${user.email})`);

          return res.json({
            success: true,
            message: "OTP sent successfully to your registered email",
            data: {
              adminId: user.id,
              username: user.username,
              email: user.email
            }
          });
        }
      );
    }
  );
});

// ==================== LOGIN WITH OTP ====================

router.post("/login", (req, res) => {
  const { username, password, otp } = req.body;

  // Validation
  if (!username || !password || !otp) {
    return res.status(400).json({
      success: false,
      message: "Username, password and OTP are required"
    });
  }

  db.query(
    "SELECT * FROM admins WHERE username = ?",
    [username],
    async (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error occurred"
        });
      }

      if (!results.length) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      const user = results[0];

      // Check account status
      if (user.status === 'inactive') {
        return res.status(403).json({
          success: false,
          message: "Account is deactivated. Please contact admin."
        });
      }

      // Verify password
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      // Verify OTP
      if (!user.otp || user.otp.toUpperCase() !== otp.toUpperCase()) {
        return res.status(401).json({
          success: false,
          message: "Invalid OTP"
        });
      }

      // Check OTP expiry
      if (Date.now() > user.otp_expiry) {
        return res.status(401).json({
          success: false,
          message: "OTP expired. Please request a new one."
        });
      }

      // Clear OTP after successful login
      db.query(
        "UPDATE admins SET otp = NULL, otp_expiry = NULL, last_login = NOW() WHERE id = ?",
        [user.id],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error:", updateErr);
          }
        }
      );

      // Generate JWT Token
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role || 'admin'
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "3h"
        }
      );

      // Log successful login
      console.log(`✅ Admin logged in: ${user.username} (${user.email})`);

      return res.json({
        success: true,
        message: "Login successful",
        token,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role || 'admin'
        }
      });
    }
  );
});

// ==================== VERIFY ADMIN TOKEN ====================

router.get(
  "/verify-admin",
  verifyToken,
  (req, res) => {
    // req.admin is set by authMiddleware
    res.json({
      success: true,
      admin: req.admin,
      message: "Token is valid"
    });
  }
);

// ==================== SEND RESET OTP ====================

router.post("/send-reset-otp", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required"
    });
  }

  db.query(
    "SELECT * FROM admins WHERE email = ?",
    [email],
    async (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error occurred"
        });
      }

      if (!results.length) {
        return res.status(404).json({
          success: false,
          message: "Email not found in our system"
        });
      }

      const admin = results[0];

      // Check account status
      if (admin.status === 'inactive') {
        return res.status(403).json({
          success: false,
          message: "Account is deactivated. Please contact admin."
        });
      }

      // Generate OTP
      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;

      // Save OTP
      db.query(
        "UPDATE admins SET otp = ?, otp_expiry = ? WHERE id = ?",
        [otp, expiry, admin.id],
        async (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error:", updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to generate OTP"
            });
          }

          // Send OTP
          const sent = await sendEmail(
            admin.email,
            otp,
            "PASSWORD RESET OTP",
            "reset"
          );

          if (!sent) {
            return res.status(500).json({
              success: false,
              message: "Failed to send OTP. Please try again."
            });
          }

          console.log(`✅ Password reset OTP sent to: ${admin.email}`);

          res.json({
            success: true,
            message: "OTP sent successfully to your registered email"
          });
        }
      );
    }
  );
});

// ==================== RESET PASSWORD ====================

router.post("/reset-password", (req, res) => {
  const { email, otp, newPassword, confirmPassword } = req.body;

  // Validation
  if (!email || !otp || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Email, OTP and new password are required"
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Passwords do not match"
    });
  }

  // Password strength validation
  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters long"
    });
  }

  db.query(
    "SELECT * FROM admins WHERE email = ?",
    [email],
    async (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error occurred"
        });
      }

      if (!results.length) {
        return res.status(404).json({
          success: false,
          message: "Email not found"
        });
      }

      const admin = results[0];

      // Verify OTP
      if (!admin.otp || admin.otp.toUpperCase() !== otp.toUpperCase()) {
        return res.status(401).json({
          success: false,
          message: "Invalid OTP"
        });
      }

      // Check OTP expiry
      if (Date.now() > admin.otp_expiry) {
        return res.status(401).json({
          success: false,
          message: "OTP expired. Please request a new one."
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password and clear OTP
      db.query(
        "UPDATE admins SET password = ?, otp = NULL, otp_expiry = NULL, updated_at = NOW() WHERE id = ?",
        [hashedPassword, admin.id],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error:", updateErr);
            return res.status(500).json({
              success: false,
              message: "Failed to update password"
            });
          }

          console.log(`✅ Password updated for: ${admin.email}`);

          res.json({
            success: true,
            message: "Password updated successfully"
          });
        }
      );
    }
  );
});

// ==================== LOGOUT ====================

router.post("/logout", verifyToken, (req, res) => {
  // Since we're using JWT, logout is handled on client side
  // But we can log the logout attempt
  console.log(`🔓 Admin logged out: ${req.admin?.username || 'Unknown'}`);
  
  res.json({
    success: true,
    message: "Logged out successfully"
  });
});

// ==================== GET ADMIN PROFILE ====================

router.get("/profile", verifyToken, (req, res) => {
  const adminId = req.admin.id;

  db.query(
    "SELECT id, username, email, role, status, last_login, created_at FROM admins WHERE id = ?",
    [adminId],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error occurred"
        });
      }

      if (!results.length) {
        return res.status(404).json({
          success: false,
          message: "Admin not found"
        });
      }

      res.json({
        success: true,
        data: results[0]
      });
    }
  );
});

// ==================== UPDATE ADMIN PROFILE ====================

router.put("/profile", verifyToken, async (req, res) => {
  const adminId = req.admin.id;
  const { email, password } = req.body;

  let updateQuery = "UPDATE admins SET ";
  let updateValues = [];
  let updateFields = [];

  if (email) {
    updateFields.push("email = ?");
    updateValues.push(email);
  }

  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    updateFields.push("password = ?");
    updateValues.push(hashedPassword);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No fields to update"
    });
  }

  updateQuery += updateFields.join(", ");
  updateQuery += ", updated_at = NOW() WHERE id = ?";
  updateValues.push(adminId);

  db.query(updateQuery, updateValues, (err) => {
    if (err) {
      console.error("❌ Update Error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile"
      });
    }

    res.json({
      success: true,
      message: "Profile updated successfully"
    });
  });
});

module.exports = router;
