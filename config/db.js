const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ==================== SSL CERTIFICATE CONFIGURATION ====================
let sslConfig = {};

try {
  const certPath = path.join(__dirname, "../certs/isrgrootx1.pem");
  
  if (fs.existsSync(certPath)) {
    sslConfig = {
      ca: fs.readFileSync(certPath, "utf8"),
      rejectUnauthorized: true,
    };
    console.log("✅ SSL Certificate loaded successfully");
  } else {
    console.warn("⚠️ SSL Certificate not found at:", certPath);
    sslConfig = { rejectUnauthorized: false };
  }
} catch (error) {
  console.error("❌ Error loading SSL certificate:", error.message);
  sslConfig = { rejectUnauthorized: false };
}

// ==================== SCHOOL DATABASE POOL ====================
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "school_management",
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ssl: sslConfig,
  connectTimeout: 10000,
  timezone: "+05:30",
  dateStrings: true,
  typeCast: function (field, next) {
    if (field.type === "TINY" && field.length === 1) {
      return field.string() === "1";
    }
    return next();
  },
});

// ==================== TEST SCHOOL DB ====================
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database Connection Error:", {
      message: err.message,
      code: err.code,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
    });
    if (process.env.NODE_ENV === "production") {
      console.log("🔄 Retrying in 5s...");
      setTimeout(() => {
        db.getConnection((retryErr, retryConn) => {
          if (retryErr) console.error("❌ Retry failed:", retryErr.message);
          else { console.log("✅ Connected after retry"); retryConn.release(); }
        });
      }, 5000);
    }
  } else {
    console.log("✅ Database Connected Successfully");
    console.log(`   📊 Database: ${process.env.DB_NAME}`);
    console.log(`   🖥️  Host: ${process.env.DB_HOST}`);
    connection.release();
  }
});

// ==================== PROMISE WRAPPER (School) ====================
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (error, results) => {
      if (error) {
        console.error("❌ Query Error:", { sql, error: error.message });
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
};

// ==================== TRANSACTION ====================
const transaction = async (callback) => {
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    console.error("❌ Transaction rolled back:", error.message);
    throw error;
  } finally {
    connection.release();
  }
};

// ==================== HEALTH CHECK ====================
const checkDatabaseHealth = async () => {
  try {
    const startTime = Date.now();
    const result = await query("SELECT 1 as health, NOW() as current_time");
    const endTime = Date.now();
    return {
      status: "healthy",
      responseTime: `${endTime - startTime}ms`,
      timestamp: new Date().toISOString(),
      serverTime: result[0]?.current_time,
      database: process.env.DB_NAME,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
    };
  }
};

// ==================== HELPERS ====================
const getById = async (table, id) => {
  const results = await query(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  return results[0] || null;
};

const getAll = async (table, orderBy = "created_at", order = "DESC", limit = 100) => {
  return await query(`SELECT * FROM ${table} ORDER BY ${orderBy} ${order} LIMIT ?`, [limit]);
};

const deleteById = async (table, id) => {
  return await query(`DELETE FROM ${table} WHERE id = ?`, [id]);
};

const count = async (table, where = "", params = []) => {
  let sql = `SELECT COUNT(*) as total FROM ${table}`;
  if (where) sql += ` WHERE ${where}`;
  const results = await query(sql, params);
  return results[0]?.total || 0;
};

const exists = async (table, where, params = []) => {
  const c = await count(table, where, params);
  return c > 0;
};

// ==================== BULK OPERATIONS ====================
const insertBulk = async (table, records) => {
  if (!records || records.length === 0) throw new Error("No records");
  const keys = Object.keys(records[0]);
  const placeholders = records.map(() => `(${keys.map(() => "?").join(", ")})`).join(", ");
  const values = records.flatMap(record => keys.map(key => record[key]));
  return await query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES ${placeholders}`, values);
};

const updateBulk = async (table, data, where, params = []) => {
  const keys = Object.keys(data);
  const setClause = keys.map(key => `${key} = ?`).join(", ");
  const values = [...Object.values(data), ...params];
  return await query(`UPDATE ${table} SET ${setClause} WHERE ${where}`, values);
};

// ==================== SEARCH ====================
const search = async (table, options = {}) => {
  const {
    search = "", searchColumns = [], page = 1, limit = 10,
    orderBy = "created_at", order = "DESC",
    where = "", whereParams = []
  } = options;

  let sql = `SELECT * FROM ${table}`;
  let countSql = `SELECT COUNT(*) as total FROM ${table}`;
  let params = [];
  let conditions = [];

  if (where) { conditions.push(where); params = [...whereParams]; }
  if (search && searchColumns.length > 0) {
    const searchCondition = searchColumns.map(col => `${col} LIKE ?`).join(" OR ");
    conditions.push(`(${searchCondition})`);
    params = [...params, ...searchColumns.map(() => `%${search}%`)];
  }

  if (conditions.length > 0) {
    const whereClause = conditions.join(" AND ");
    sql += ` WHERE ${whereClause}`;
    countSql += ` WHERE ${whereClause}`;
  }

  const totalResult = await query(countSql, params);
  const total = totalResult[0]?.total || 0;

  const offset = (page - 1) * limit;
  sql += ` ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const data = await query(sql, params);
  return {
    data,
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  };
};

// ==================== PAGINATION HELPER ====================
const paginate = async (baseSQL, params = [], page = 1, limit = 10) => {
  page = Math.max(parseInt(page) || 1, 1);
  limit = Math.min(parseInt(limit) || 10, 50);
  const offset = (page - 1) * limit;

  const countSQL = `SELECT COUNT(*) as total FROM (${baseSQL}) as t`;
  const countResult = await query(countSQL, params);
  const total = countResult[0]?.total || 0;

  const dataSQL = `${baseSQL} LIMIT ? OFFSET ?`;
  const data = await query(dataSQL, [...params, limit, offset]);

  return {
    data,
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

// ═══════════════════════════════════════════════════════════
// 🆕 BLOG DATABASE POOL (Alag DB, BLOG_DB_* use karta hai)
// ═══════════════════════════════════════════════════════════
const blogDb = mysql.createPool({
  host: process.env.BLOG_DB_HOST,                    // ← BLOG_DB_HOST
  user: process.env.BLOG_DB_USER,                    // ← BLOG_DB_USER
  password: process.env.BLOG_DB_PASSWORD,            // ← BLOG_DB_PASSWORD
  port: Number(process.env.BLOG_DB_PORT) || 4000,    // ← BLOG_DB_PORT
  database: process.env.BLOG_DB_NAME || "blog_db",   // ← BLOG_DB_NAME
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ssl: sslConfig,
  connectTimeout: 10000,
  timezone: "+05:30",
  dateStrings: true,
  typeCast: function (field, next) {
    if (field.type === "TINY" && field.length === 1) {
      return field.string() === "1";
    }
    return next();
  },
});

// Test blog DB
blogDb.getConnection((err, conn) => {
  if (err) {
    console.error("❌ Blog DB Error:", err.message);
  } else {
    console.log("✅ Blog DB Connected:", process.env.BLOG_DB_NAME);
    conn.release();
  }
});

// Blog query wrapper
const blogQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    blogDb.query(sql, params, (error, results) => {
      if (error) {
        console.error("❌ Blog Query Error:", { sql, error: error.message });
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
};

// ==================== EXPORTS ====================
module.exports = {
  // School
  db,
  query,
  transaction,
  getById,
  getAll,
  deleteById,
  count,
  exists,
  insertBulk,
  updateBulk,
  search,
  paginate,
  checkDatabaseHealth,

  // 🆕 Blog
  blogDb,
  blogQuery,
};
