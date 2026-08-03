const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,

  ssl: {
    ca: fs.readFileSync(
      path.join(__dirname, "../certs/isrgrootx1.pem")
    ),
    rejectUnauthorized: true
  }
});

db.connect((err) => {
  if (err) {
    console.error("DB Error:", err);
  } else {
    console.log("✅ TiDB Connected");
  }
});

module.exports = db;