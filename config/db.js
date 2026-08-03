const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 4000,

  ssl: {
    ca: fs.readFileSync(path.join(__dirname, "../certs/isrgrootx1.pem"))
  },

  connectTimeout: 10000,
  charset: "utf8mb4"
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database Connection Failed");
    console.error(err);
  } else {
    console.log("✅ TiDB Connected Successfully");
  }
});

module.exports = db;