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
    console.warn("⚠️ Using SSL without certificate verification (development mode)");
    sslConfig = {
      rejectUnauthorized: false,
    };
  }
} catch (error) {
  console.error("❌ Error loading SSL certificate:", error.message);
  sslConfig = {
    rejectUnauthorized: false,
  };
}

// ==================== DATABASE CONNECTION POOL ====================
const db = mysql.createPool({
  // Database Credentials
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "school_management",
  port: Number(process.env.DB_PORT) || 3306,

  // Connection Pool Settings
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  // SSL Configuration
  ssl: sslConfig,

  // Timeouts
  connectTimeout: 10000,      // 10 seconds
  acquireTimeout: 10000,      // 10 seconds
  timeout: 60000,             // 60 seconds

  // Timezone
  timezone: "+05:30",         // India Standard Time (IST)

  // Date Strings
  dateStrings: true,

  // Type Casting
  typeCast: function (field, next) {
    if (field.type === "TINY" && field.length === 1) {
      return field.string() === "1"; // Convert TINYINT to boolean
    }
    return next();
  },
});

// ==================== TEST DATABASE CONNECTION ====================
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database Connection Error:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
    });

    // Retry logic for production
    if (process.env.NODE_ENV === "production") {
      console.log("🔄 Retrying database connection in 5 seconds...");
      setTimeout(() => {
        db.getConnection((retryErr, retryConn) => {
          if (retryErr) {
            console.error("❌ Database connection failed after retry:", retryErr.message);
          } else {
            console.log("✅ Database connected successfully after retry");
            retryConn.release();
          }
        });
      }, 5000);
    }
  } else {
    console.log("✅ Database Connected Successfully");
    console.log(`   📊 Database: ${process.env.DB_NAME}`);
    console.log(`   🖥️  Host: ${process.env.DB_HOST}`);
    console.log(`   🔌 Port: ${process.env.DB_PORT}`);
    console.log(`   🔗 Pool Size: ${process.env.DB_POOL_SIZE || 10}`);
    connection.release();
  }
});

// ==================== PROMISE WRAPPER ====================
/**
 * Execute a SQL query with Promise
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise} - Query results
 */
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (error, results) => {
      if (error) {
        console.error("❌ Query Error:", {
          sql: sql,
          params: params,
          error: error.message,
          code: error.code,
        });
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
};

// ==================== TRANSACTION HELPER ====================
/**
 * Execute a transaction
 * @param {Function} callback - Transaction callback function
 * @returns {Promise} - Transaction result
 */
const transaction = async (callback) => {
  const connection = await db.promise().getConnection();
  
  try {
    await connection.beginTransaction();
    console.log("🔄 Transaction started");
    
    const result = await callback(connection);
    
    await connection.commit();
    console.log("✅ Transaction committed");
    
    return result;
  } catch (error) {
    await connection.rollback();
    console.error("❌ Transaction rolled back:", error.message);
    throw error;
  } finally {
    connection.release();
    console.log("🔓 Connection released");
  }
};

// ==================== DATABASE HEALTH CHECK ====================
/**
 * Check database health
 * @returns {Promise<Object>} - Health status
 */
const checkDatabaseHealth = async () => {
  try {
    const startTime = Date.now();
    const result = await query("SELECT 1 as health, NOW() as current_time");
    const endTime = Date.now();
    
    return {
      status: "healthy",
      responseTime: `${endTime - startTime}ms`,
      timestamp: new Date().toISOString(),
      serverTime: result[0]?.current_time || new Date().toISOString(),
      database: process.env.DB_NAME,
      host: process.env.DB_HOST,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
      code: error.code,
      database: process.env.DB_NAME,
      host: process.env.DB_HOST,
    };
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get a single record by ID
 * @param {string} table - Table name
 * @param {number} id - Record ID
 * @returns {Promise<Object|null>} - Record or null
 */
const getById = async (table, id) => {
  const sql = `SELECT * FROM ${table} WHERE id = ? LIMIT 1`;
  const results = await query(sql, [id]);
  return results[0] || null;
};

/**
 * Get all records from a table
 * @param {string} table - Table name
 * @param {string} orderBy - Order by column
 * @param {string} order - ASC or DESC
 * @param {number} limit - Limit results
 * @returns {Promise<Array>} - Records
 */
const getAll = async (table, orderBy = "created_at", order = "DESC", limit = 100) => {
  const sql = `SELECT * FROM ${table} ORDER BY ${orderBy} ${order} LIMIT ?`;
  return await query(sql, [limit]);
};

/**
 * Delete a record by ID
 * @param {string} table - Table name
 * @param {number} id - Record ID
 * @returns {Promise<Object>} - Delete result
 */
const deleteById = async (table, id) => {
  const sql = `DELETE FROM ${table} WHERE id = ?`;
  return await query(sql, [id]);
};

/**
 * Count records in a table
 * @param {string} table - Table name
 * @param {string} where - WHERE clause (optional)
 * @param {Array} params - Parameters for WHERE clause
 * @returns {Promise<number>} - Count
 */
const count = async (table, where = "", params = []) => {
  let sql = `SELECT COUNT(*) as total FROM ${table}`;
  if (where) {
    sql += ` WHERE ${where}`;
  }
  const results = await query(sql, params);
  return results[0]?.total || 0;
};

/**
 * Check if record exists
 * @param {string} table - Table name
 * @param {string} where - WHERE clause
 * @param {Array} params - Parameters
 * @returns {Promise<boolean>} - Exists or not
 */
const exists = async (table, where, params = []) => {
  const count = await count(table, where, params);
  return count > 0;
};

// ==================== BULK OPERATIONS ====================

/**
 * Insert multiple records
 * @param {string} table - Table name
 * @param {Array} records - Array of records to insert
 * @returns {Promise<Object>} - Insert result
 */
const insertBulk = async (table, records) => {
  if (!records || records.length === 0) {
    throw new Error("No records to insert");
  }

  const keys = Object.keys(records[0]);
  const placeholders = records.map(() => `(${keys.map(() => "?").join(", ")})`).join(", ");
  const values = records.flatMap(record => keys.map(key => record[key]));

  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES ${placeholders}`;
  return await query(sql, values);
};

/**
 * Update multiple records
 * @param {string} table - Table name
 * @param {Object} data - Data to update
 * @param {string} where - WHERE clause
 * @param {Array} params - Parameters
 * @returns {Promise<Object>} - Update result
 */
const updateBulk = async (table, data, where, params = []) => {
  const keys = Object.keys(data);
  const setClause = keys.map(key => `${key} = ?`).join(", ");
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
  const values = [...Object.values(data), ...params];
  return await query(sql, values);
};

// ==================== SEARCH FUNCTIONS ====================

/**
 * Search in table with pagination
 * @param {string} table - Table name
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Search results
 */
const search = async (table, options = {}) => {
  const {
    search = "",
    searchColumns = [],
    page = 1,
    limit = 10,
    orderBy = "created_at",
    order = "DESC",
    where = "",
    whereParams = []
  } = options;

  let sql = `SELECT * FROM ${table}`;
  let countSql = `SELECT COUNT(*) as total FROM ${table}`;
  let params = [];

  // Build WHERE clause
  let conditions = [];
  
  if (where) {
    conditions.push(where);
    params = [...whereParams];
  }

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

  // Count total
  const totalResult = await query(countSql, params);
  const total = totalResult[0]?.total || 0;

  // Pagination
  const offset = (page - 1) * limit;
  sql += ` ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const data = await query(sql, params);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  };
};

// ==================== EXPORT ====================
module.exports = {
  // Connection
  db,
  
  // Core Functions
  query,
  transaction,
  
  // Helper Functions
  getById,
  getAll,
  deleteById,
  count,
  exists,
  
  // Bulk Operations
  insertBulk,
  updateBulk,
  
  // Search
  search,
  
  // Health Check
  checkDatabaseHealth,
};
