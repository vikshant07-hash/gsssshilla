const express = require("express");
const router = express.Router();

const db = require("../config/db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/* ================= EMAIL CONFIG ================= */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

/* ================= OTP GENERATOR ================= */

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

/* ================= SEND OTP ================= */

router.post("/send-otp", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "All Fields Required" });
  }

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, results) => {
      if (err) return res.json({ success: false, message: "Database Error" });

      if (!results.length) {
        return res.json({ success: false, message: "Invalid Username, Try Again!" });
      }

      const user = results[0];

      const match = await bcrypt.compare(password, user.password);

      if (!match) {
        return res.json({ success: false, message: "Wrong Password, Enter Valid Password!" });
      }

      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;

      await new Promise((resolve, reject) => {

  db.query(
    "UPDATE admins SET otp=?, otp_expiry=? WHERE id=?",
    [otp, expiry, user.id],
    (err) => {

      if(err) reject(err);
      else resolve();

    }
  );

});



try {

  await transporter.sendMail({from: process.env.EMAIL_USER,
  to: user.email,
  subject: "Admin Login OTP - Govt. Sr. Sec. School, Shilla",
  html: `
  <div style="
    font-family: Arial, sans-serif;
    background: #0b1220;
    padding: 30px;
    color: #fff;
  ">

    <!-- MAIN CARD -->
    <div style="
      max-width: 520px;
      margin: auto;
      background: #111827;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 0 25px rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.08);
    ">

      <!-- HEADER -->
      <div style="
        background: linear-gradient(90deg, #22c55e, #3b82f6, #a855f7);
        padding: 20px;
        text-align: center;
      ">

        <!-- LOGO -->
        <img
          src="https://wondrous-lily-ac51a5.netlify.app/1778132110413-ChatGPT%20Image%20May%207,%202026,%2010_56_26%20AM.png"
          style="width:70px; height:70px; border-radius:50%; background:#fff; padding:5px;"
        />

        <h2 style="margin:10px 0 0; font-size:18px;">
          GOVT. SR. SEC. SCHOOL, SHILLA
        </h2>

        <p style="margin:5px 0 0; font-size:13px;">
          Secure Authentication System
        </p>

      </div>

      <!-- BODY -->
      <div style="padding: 25px; text-align:center;">

        <h3 style="color:#e5e7eb; margin-bottom:10px;">
          ADMIN LOGIN OTP
        </h3>

        <p style="color:#9ca3af; font-size:14px;">
          Use the OTP to Login
        </p>

        <!-- OTP BOX -->
        <div style="
          margin: 25px auto;
          padding: 18px;
          width: fit-content;
          background: #0f172a;
          border: 2px dashed #ce0c9d;
          border-radius: 12px;
          font-size: 30px;
          letter-spacing: 6px;
          font-weight: bold;
          color: #0d0461;
        ">
          ${otp}
        </div>

        <p style="color:#facc15; font-size:13px;">
          ⏱ Valid for only 5 minutes
        </p>

        <p style="color:#f87171; font-size:13px;">
          ⚠ Do not share this OTP with anyone
        </p>

        <!-- BUTTON STYLE LOOK -->
        <div style="
          margin-top: 20px;
          padding: 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
        ">
          <p style="font-size:13px; color:#9ca3af;">
            If you didn’t request this, ignore this email.
          </p>
        </div>

      </div>

      <!-- FOOTER -->
      <div style="
        padding: 15px;
        text-align:center;
        font-size:12px;
        color:#6b7280;
        border-top:1px solid rgba(255,255,255,0.08);
      ">

        <p>
          📧 Support: 
          <a href="mailto:magicalmathsquiz@gmail.com" style="color:#38bdf8;">
            magicalmathsquiz@gmail.com
          </a>
        </p>

        <p>
          🌐 Govt. Sr. Sec. School, Shilla
        </p>

        <p style="margin-top:8px;">
          © All Rights Reserved, 2026
        </p>

      </div>

    </div>

  </div>
  `});

  return res.json({
        success: true,
        message: "OTP sent to Registered Email"
      });

} catch(error) {

  console.log(error);

  return res.json({
    success:false,
    message:"Email Send Failed"
  });
  }

    }
  );

});

/* ================= LOGIN ================= */

router.post("/login", (req, res) => {
  const { username, password, otp } = req.body;

  if (!username || !password || !otp) {
    return res.json({ success: false, message: "All Fields Required" });
  }

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, results) => {
      if (err) return res.json({ success: false, message: "Database Error" });

      if (!results.length) {
        return res.json({ success: false, message: "Invalid Username" });
      }

      const user = results[0];

      const match = await bcrypt.compare(password, user.password);

      if (!match) {
        return res.json({ success: false, message: "Wrong Password, Enter Valid Password!" });
      }

      if (!user.otp || user.otp !== otp) {
        return res.json({ success: false, message: "Invalid OTP, Please Check and Try again!" });
      }

      if (Date.now() > user.otp_expiry) {
        return res.json({ success: false, message: "OTP Expired, Try Sending a New One!" });
      }

      // clear otp
      db.query(
        "UPDATE admins SET otp=NULL, otp_expiry=NULL WHERE id=?",
        [user.id]
      );

      // JWT TOKEN
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          role: "admin"
        },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );

      return res.json({
        success: true,
        message: "Login Successful",
        token
      });
    }
  );
});

/* ================= RESET OTP ================= */

router.post("/send-reset-otp", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({ success: false, message: "Email Required" });
  }

  db.query(
    "SELECT * FROM admins WHERE email=?",
    [email],
    async (err, results) => {
      if (err) return res.json({ success: false, message: "Database Error" });

      if (!results.length) {
        return res.json({ success: false, message: "Email Not Found" });
      }

      const user = results[0];

      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;

      db.query(
        "UPDATE admins SET otp=?, otp_expiry=? WHERE id=?",
        [otp, expiry, user.id]
      );

      await transporter.sendMail({
  from: process.env.EMAIL_USER,
  to: user.email,
  subject: "Reset OTP - Govt. Sr. Sec. School, Shilla",
  html: `
  <div style="
    font-family: Arial, sans-serif;
    background: #0b1220;
    padding: 30px;
    color: #fff;
  ">

    <!-- MAIN CARD -->
    <div style="
      max-width: 520px;
      margin: auto;
      background: #111827;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 0 25px rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.08);
    ">

      <!-- HEADER -->
      <div style="
        background: linear-gradient(90deg, #22c55e, #3b82f6, #a855f7);
        padding: 20px;
        text-align: center;
      ">

        <!-- LOGO -->
        <img
          src="https://wondrous-lily-ac51a5.netlify.app/1778132110413-ChatGPT%20Image%20May%207,%202026,%2010_56_26%20AM.png"
          style="width:70px; height:70px; border-radius:50%; background:#fff; padding:5px;"
        />

        <h2 style="margin:10px 0 0; font-size:18px;">
          GOVT. SR. SEC. SCHOOL, SHILLA
        </h2>

        <p style="margin:5px 0 0; font-size:13px;">
          Secure Authentication System
        </p>

      </div>

      <!-- BODY -->
      <div style="padding: 25px; text-align:center;">

        <h3 style="color:#e5e7eb; margin-bottom:10px;">
          Password Reset OTP
        </h3>

        <p style="color:#9ca3af; font-size:14px;">
          Use the OTP below to reset your account password
        </p>

        <!-- OTP BOX -->
        <div style="
          margin: 25px auto;
          padding: 18px;
          width: fit-content;
          background: #0f172a;
          border: 2px dashed #a80456;
          border-radius: 12px;
          font-size: 30px;
          letter-spacing: 6px;
          font-weight: bold;
          color: #10087a;
        ">
          ${otp}
        </div>

        <p style="color:#facc15; font-size:13px;">
          ⏱ Valid for only 5 minutes
        </p>

        <p style="color:#f87171; font-size:13px;">
          ⚠ Do not share this OTP with anyone
        </p>

        <!-- BUTTON STYLE LOOK -->
        <div style="
          margin-top: 20px;
          padding: 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
        ">
          <p style="font-size:13px; color:#9ca3af;">
            If you didn’t request this, ignore this email.
          </p>
        </div>

      </div>

      <!-- FOOTER -->
      <div style="
        padding: 15px;
        text-align:center;
        font-size:12px;
        color:#6b7280;
        border-top:1px solid rgba(255,255,255,0.08);
      ">

        <p>
          📧 Support: 
          <a href="mailto:magicalmathsquiz@gmail.com" style="color:#38bdf8;">
            magicalmathsquiz@gmail.com
          </a>
        </p>

        <p>
          🌐 Govt. Sr. Sec. School, Shilla
        </p>

        <p style="margin-top:8px;">
          © All Rights Reserved, 2026
        </p>

      </div>

    </div>

  </div>
  `
});

      return res.json({
        success: true,
        message: "Reset OTP sent"
      });
    }
  );
});

/* ================= RESET PASSWORD ================= */

router.post("/reset-password", (req, res) => {
  const { email, otp, newPassword } = req.body;

  db.query(
    "SELECT * FROM admins WHERE email=?",
    [email],
    async (err, results) => {
      if (err) return res.json({ success: false, message: "Database Error" });

      if (!results.length) {
        return res.json({ success: false, message: "User Not Found" });
      }

      const user = results[0];

      if (!user.otp || user.otp !== otp) {
        return res.json({ success: false, message: "Invalid OTP, Try again!" });
      }

      if (Date.now() > user.otp_expiry) {
        return res.json({ success: false, message: "OTP Expired, Try Sending a New One!" });
      }

      const hash = await bcrypt.hash(newPassword, 10);

      db.query(
        "UPDATE admins SET password=?, otp=NULL, otp_expiry=NULL WHERE id=?",
        [hash, user.id]
      );

      return res.json({
        success: true,
        message: "Password Updated"
      });
    }
  );
});

module.exports = router;