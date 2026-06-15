const express = require("express");
const cors = require("cors");
require("dotenv").config();

const nodemailer = require("nodemailer");

const app = express();
const verifyToken =
  require("./middleware/authMiddleware");


/* ================= MIDDLEWARE ================= */



app.get("/smtp-test", async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_EMAIL,
        pass: process.env.BREVO_SMTP_KEY
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });

    console.log("Checking SMTP...");

    await transporter.verify();

    console.log("SMTP VERIFIED");

    res.send("SMTP OK");

  } catch (err) {
    console.log("SMTP ERROR:", err);
    res.send("SMTP ERROR: " + err.message);
  }
});


app.use(cors({
  origin: "https://gssschoolshilla.netlify.app",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


/* ================= STATIC FILES ================= */

app.use("/uploads", express.static("uploads"));

/* ================= ROUTES ================= */

app.use("/images", require("./routes/images"));
app.use("/notifications", require("./routes/notifications"));
app.use("/downloads", require("./routes/downloads"));


app.use(
  "/api/gallery",
  require("./routes/galleryRoutes")
);


app.use("/faculty", require("./routes/facultyRoutes"));
app.use("/admin/faculty", require("./routes/adminFacultyRoutes"));

app.use("/contact", require("./routes/contactRoutes"));
app.use("/admin/contact", require("./routes/contactAdmin"));

app.use("/", require("./routes/auth"));

app.use("/analytics", require("./routes/analytics"));


app.use("/api/admin", require("./routes/adminRoutes"));

/* ================= HEALTH CHECK ================= */

app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

app.get(
  "/verify-admin",
  verifyToken,
  (req, res) => {

    res.json({
      success: true,
      user: req.user
    });

  }
);

app.get("/test", (req, res) => {
  res.send("TEST OK");
});

/* ================= PORT ================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});