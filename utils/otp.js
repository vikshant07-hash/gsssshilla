function generateOTP() {
  return Math.floor(1 + Math.random() * 5).toString();
}

module.exports = generateOTP;