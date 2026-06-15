const express = require("express");
const router = express.Router();

const db = require("../config/db");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/* ================= BREVO SMTP (FINAL SAFE CONFIG) ================= */


async function sendEmail(to, otp, title) {
  try {
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "Govt. Sr. Sec. School Shilla",
          email: "magicalmathsquiz@gmail.com"
        },
        to: [
          {
            email: to
          }
        ],
        subject: title,
        htmlContent: getOTPTemplate(otp, title)
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    return true;
  } catch (err) {
    console.log(
      "BREVO ERROR:",
      err.response?.data || err.message
    );
    return false;
  }
}


/* ================= OTP ================= */

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

/* ================= EMAIL TEMPLATE ================= */

function getOTPTemplate(otp, title) {
  return `
  <div style="font-family:Arial;background:#0b1220;padding:30px;color:#fff">
    <div style="max-width:500px;margin:auto;background:#111827;padding:20px;border-radius:12px;text-align:center">

      <h2>🏫 Govt. Sr. Sec. School Shilla</h2>
      <h3>${title}</h3>

      <div style="margin:20px auto;padding:15px;
        background:#0f172a;border:2px dashed #ce0c9d;
        font-size:28px;letter-spacing:5px;font-weight:bold;">
        ${otp}
      </div>

      <p style="color:#facc15">Valid for 5 minutes</p>
      <p style="color:#f87171">Do not share OTP</p>

    </div>
  </div>
  `;
}


async function sendEmail(to, otp, title) {
  return axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        name: "Govt. Sr. Sec. School Shilla",
        email: "magicalmathsquiz@gmail.com"
      },
      to: [
        {
          email: to
        }
      ],
      subject: title,
      htmlContent: getOTPTemplate(otp, title)
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );
}







/* ================= SEND OTP ================= */

router.post("/send-otp", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, results) => {
      if (err) return res.json({ success: false, message: "DB Error" });
      if (!results.length) return res.json({ success: false, message: "Invalid user" });

      const user = results[0];

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.json({ success: false, message: "Wrong password" });

      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;

      db.query("UPDATE admins SET otp=?, otp_expiry=? WHERE id=?", [
        otp,
        expiry,
        user.id,
      ]);

      try {
        const sent = await sendEmail(
  user.email,
  otp,
  "ADMIN LOGIN OTP"
);

if (!sent) {
  return res.json({
    success: false,
    message: "Email failed"
  });
}

return res.json({
  success: true,
  message: "OTP sent"
});
        return res.json({ success: true, message: "OTP sent" });
      } catch (error) {
        console.log("EMAIL ERROR:", error);
        return res.json({ success: false, message: "Email failed" });
      }
    }
  );
});

/* ================= LOGIN ================= */

router.post("/login", (req, res) => {
  const { username, password, otp } = req.body;

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, results) => {
      if (err) return res.json({ success: false, message: "DB Error" });
      if (!results.length) return res.json({ success: false, message: "Invalid user" });

      const user = results[0];

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.json({ success: false, message: "Wrong password" });

      if (!user.otp || user.otp !== otp)
        return res.json({ success: false, message: "Invalid OTP" });

      if (Date.now() > user.otp_expiry)
        return res.json({ success: false, message: "OTP expired" });

      db.query("UPDATE admins SET otp=NULL, otp_expiry=NULL WHERE id=?", [
        user.id,
      ]);

      const token = jwt.sign(
        { id: user.id, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );

      return res.json({
        success: true,
        token,
      });
    }
  );
});

module.exports = router;