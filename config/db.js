const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  ssl: {
    ca: fs.readFileSync(
      path.join(__dirname, "../certs/isrgrootx1.pem"),
      "utf8"
    ),
    rejectUnauthorized: true,
  },
});

// Test Connection
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ DB Connection Error:", err);
  } else {
    console.log("✅ TiDB Connected");
    connection.release();
  }
});

module.exports = db;