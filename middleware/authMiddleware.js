const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  try {

    const authHeader = req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized Access"
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token Missing"
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.admin = {
      id: decoded.id,
      username: decoded.username
    };

    next();

  } catch (error) {

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session Expired. Please Login Again."
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid Token"
    });
  }
};

module.exports = verifyToken;