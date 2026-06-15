const nodemailer = require("nodemailer");

// ==========================
// TRANSPORT CONFIG
// ==========================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: "magicalmathsquiz@gmail.com",
    pass: "vujqnplesxdcwivz"
  },
  tls: {
    rejectUnauthorized: false
  }
});

// ==========================
// SEND MAIL (PROMISE BASED)
// ==========================
const sendMail = async (to, subject, text) => {
  try {
    const info = await transporter.sendMail({
      from: `"Govt. Sr. Sec. School Shilla" <magicalmathsquiz@gmail.com>`,
      to,
      subject,
      text
    });

    console.log("EMAIL SENT ✔:", info.response);
    return true;

  } catch (err) {
    console.log("EMAIL ERROR ❌:", err.message);
    return false;
  }
};

module.exports = sendMail;