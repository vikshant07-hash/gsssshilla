const express = require("express");
const router = express.Router();

const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const QRCode = require("qrcode");

const db = require("../config/db");

const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// SCHOOL CONFIG
// ============================================================

const SCHOOL = {
  name: "GOVT. SR. SEC. SCHOOL SHILLA",
  address: "Shilla, Teh. Nerwa, Distt. Shimla, Himachal Pradesh - 171210",
  logoUrl: "https://gsssshilla07.pages.dev/logo(1).png",
  principalSignatureUrl: "https://gsssshilla07.pages.dev/principal.png",
  verificationUrl: "https://gsssshilla07.pages.dev/verify",
  helpline: "01782-XXXXXX",
  issuedBy: "Govt. Sr. Sec. School Shilla"
};

// ============================================================
// CARD SIZE - CR80 STANDARD PVC ID CARD (86mm x 54mm)
// ============================================================
const CARD_W = 243;
const CARD_H = 153;

// ============================================================
// A4 PAGE SETTINGS — 5 rows (front+back) per A4 portrait sheet
// ============================================================
const GAP_COL = 12;
const GAP_ROW = 8;
const ROWS_PER_PAGE = 5;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_TIMEOUT = 10000;

// ============================================================
// COLOR THEME
// ============================================================
const THEME = {
  navyDeep: "#0B1740",
  blueStart: "#0F2167",
  blueEnd: "#2F58D6",
  goldStart: "#9A6A0A",
  goldEnd: "#F0C24B",
  panelStart: "#FFFFFF",
  panelEnd: "#EEF2FF",
  dark: "#0B1526",
  text: "#152238",
  muted: "#5B6B84",
  light: "#F4F7FC",
  border: "#C7D2E4",
  white: "#FFFFFF",
  success: "#15803D",
  danger: "#9A3412"
};

function isValidImageUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function fetchImageBuffer(url, redirects = 0) {
  return new Promise((resolve) => {
    if (!isValidImageUrl(url) || redirects > 5) return resolve(null);
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (resp) => {
      if ([301, 302, 307, 308].includes(resp.statusCode) && resp.headers.location) {
        resp.resume();
        return resolve(fetchImageBuffer(resp.headers.location, redirects + 1));
      }
      if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
      const contentType = resp.headers["content-type"] || "";
      if (!contentType.startsWith("image/")) { resp.resume(); return resolve(null); }
      const chunks = [];
      let totalSize = 0;
      resp.on("data", (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_IMAGE_SIZE) { req.destroy(); return resolve(null); }
        chunks.push(chunk);
      });
      resp.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(IMAGE_TIMEOUT, () => { req.destroy(); resolve(null); });
  });
}

function fmtDate(date) {
  if (!date) return "—";
  const dt = new Date(date);
  if (isNaN(dt)) return String(date);
  return dt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });
}

function maskAadhar(value) {
  if (!value) return "—";
  const number = String(value).replace(/\s/g, "");
  if (number.length < 4) return "XXXX XXXX XXXX";
  return "XXXX XXXX " + number.slice(-4);
}

function sessionValidUpto(session) {
  if (!session) return "—";
  const match = String(session).match(/(\d{4})\D?(\d{2,4})/);
  if (!match) return String(session);
  let endYear = match[2];
  if (endYear.length === 2) endYear = "20" + endYear;
  return "31/03/" + endYear;
}

function getTodayIndia() {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });
}

function fitText(doc, text, maxWidth, startSize = 6.6, minSize = 4.8) {
  let size = startSize;
  doc.fontSize(size);
  while (doc.widthOfString(String(text)) > maxWidth && size > minSize) {
    size -= 0.2;
    doc.fontSize(size);
  }
  return size;
}

// ============================================================
// CUT MARKS
// ============================================================
function drawCutMarks(doc, x, y, w, h, len = 7, offset = 3) {
  doc.save();
  doc.lineWidth(0.5).strokeColor("#94A3B8");
  doc.moveTo(x - offset, y).lineTo(x - offset - len, y).stroke();
  doc.moveTo(x, y - offset).lineTo(x, y - offset - len).stroke();
  doc.moveTo(x + w + offset, y).lineTo(x + w + offset + len, y).stroke();
  doc.moveTo(x + w, y - offset).lineTo(x + w, y - offset - len).stroke();
  doc.moveTo(x - offset, y + h).lineTo(x - offset - len, y + h).stroke();
  doc.moveTo(x, y + h + offset).lineTo(x, y + h + offset + len).stroke();
  doc.moveTo(x + w + offset, y + h).lineTo(x + w + offset + len, y + h).stroke();
  doc.moveTo(x + w, y + h + offset).lineTo(x + w, y + h + offset + len).stroke();
  doc.restore();
}

// ============================================================
// CARD FRAME
// ============================================================
function drawCardFrame(doc, x, y) {
  const W = CARD_W, H = CARD_H;

  const bg = doc.linearGradient(x, y, x + W, y + H);
  bg.stop(0, THEME.panelStart).stop(1, THEME.panelEnd);
  doc.roundedRect(x, y, W, H, 9).fillAndStroke(bg, THEME.dark);
  doc.lineWidth(1).strokeColor(THEME.dark).stroke();

  doc.roundedRect(x + 2.5, y + 2.5, W - 5, H - 5, 7).lineWidth(0.8).strokeColor(THEME.goldStart).stroke();

  doc.save();
  doc.opacity(0.05);
  doc.font("Helvetica-Bold").fontSize(58).fillColor(THEME.blueStart)
    .text("GSSS", x, y + H / 2 - 30, { width: W, align: "center" });
  doc.restore();

  const bar = doc.linearGradient(x, y, x, y + H);
  bar.stop(0, THEME.goldEnd).stop(1, THEME.goldStart);
  doc.roundedRect(x + 2.5, y + 2.5, 4, H - 5, 2).fill(bar);
}

// ============================================================
// HEADER BANNER
// ============================================================
function drawHeader(doc, x, y, logoBuf) {
  const W = CARD_W;
  const headerH = 30;

  const gradient = doc.linearGradient(x, y, x + W, y + headerH);
  gradient.stop(0, THEME.navyDeep).stop(0.55, THEME.blueStart).stop(1, THEME.blueEnd);
  doc.roundedRect(x + 3, y + 3, W - 6, headerH, 6).fill(gradient);

  const logoSize = 27, logoX = x + 8, logoY = y + 4.5;
  if (logoBuf) {
    try {
      doc.save();
      doc.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1.5).fill(THEME.white);
      doc.restore();
      // Clip logo strictly inside its circle-box
      doc.save();
      doc.rect(logoX, logoY, logoSize, logoSize).clip();
      doc.image(logoBuf, logoX, logoY, { fit: [logoSize, logoSize], align: "center", valign: "center" });
      doc.restore();
    } catch (err) {}
  }

  doc.font("Helvetica-Bold").fontSize(9.6).fillColor(THEME.white)
    .text(SCHOOL.name, x + 38, y + 6.5, { width: W - 46, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(5.8).fillColor("#DCE5FF")
    .text(SCHOOL.address, x + 38, y + 18, { width: W - 46, align: "center" });

  return headerH;
}

// ============================================================
// BADGE
// ============================================================
function drawBadge(doc, x, y, text) {
  doc.font("Helvetica-Bold").fontSize(6.4);
  const textW = doc.widthOfString(text.toUpperCase());
  const badgeW = Math.max(90, textW + 24);
  const badgeH = 12;
  const badgeX = x + (CARD_W - badgeW) / 2;

  const gradient = doc.linearGradient(badgeX, y, badgeX + badgeW, y);
  gradient.stop(0, THEME.goldStart).stop(0.5, THEME.goldEnd).stop(1, THEME.goldStart);
  doc.roundedRect(badgeX, y, badgeW, badgeH, 6).fill(gradient);
  doc.roundedRect(badgeX, y, badgeW, badgeH, 6).lineWidth(0.4).strokeColor(THEME.dark).stroke();

  doc.font("Helvetica-Bold").fontSize(6.4).fillColor(THEME.white)
    .text(text.toUpperCase(), badgeX, y + 3.1, { width: badgeW, align: "center", characterSpacing: 0.4 });
}

// ============================================================
// GENERIC CLIPPED IMAGE DRAWER
// ------------------------------------------------------------
// Draws an image STRICTLY inside the given box. Even if the source
// image is huge, it will be scaled to fit and clipped so it can
// never spill over surrounding text or outside the card.
// ============================================================
function drawImageInBox(doc, imgBuf, bx, by, bw, bh, opts = {}) {
  if (!imgBuf || bw <= 0 || bh <= 0) return false;
  try {
    doc.save();
    doc.rect(bx, by, bw, bh).clip();
    doc.image(imgBuf, bx, by, {
      fit: [bw, bh],
      align: opts.align || "center",
      valign: opts.valign || "center"
    });
    doc.restore();
    return true;
  } catch (err) {
    try { doc.restore(); } catch (_) {}
    return false;
  }
}

// ============================================================
// PHOTO
// ============================================================
function drawStudentPhoto(doc, photoBuf, x, y) {
  const photoW = 56, photoH = 60;
  doc.rect(x - 2, y - 2, photoW + 4, photoH + 4).fillAndStroke(THEME.white, THEME.goldStart);
  doc.lineWidth(0.9);

  const drawn = drawImageInBox(doc, photoBuf, x, y, photoW, photoH);
  if (!drawn) {
    drawPhotoPlaceholder(doc, x, y, photoW, photoH);
  }
  return { photoW, photoH };
}

function drawPhotoPlaceholder(doc, x, y, w, h) {
  doc.rect(x, y, w, h).fillAndStroke(THEME.light, THEME.border);
  doc.font("Helvetica").fontSize(6).fillColor(THEME.muted)
    .text("STUDENT\nPHOTO", x, y + h / 2 - 8, { width: w, align: "center" });
}

// ============================================================
// SIGNATURES
// ------------------------------------------------------------
// Both signatures are drawn inside a small FIXED-HEIGHT clipped box.
// The image is scaled down to fit inside this box and clipped so
// it can NEVER overlap the text or bleed outside the card.
//
// Return value = the Y coordinate of the BOTTOM of the block, so
// the caller can place things beneath it safely.
// ============================================================

const SIG_IMG_H = 18;      // fixed height for signature image box
const SIG_LABEL_H = 7.5;   // height reserved for the name line + label

function drawPrincipalSignature(doc, principalBuf, x, y, width = 78) {
  const imgH = SIG_IMG_H;
  const imgW = width;

  // Draw image strictly inside the box (clipped)
  drawImageInBox(doc, principalBuf, x, y, imgW, imgH);

  const lineY = y + imgH + 1.5;
  doc.moveTo(x, lineY).lineTo(x + width, lineY).lineWidth(0.6).strokeColor(THEME.muted).stroke();
  doc.font("Helvetica-Bold").fontSize(5.4).fillColor(THEME.dark)
    .text("Principal", x, lineY + 1.2, { width, align: "center", lineBreak: false });

  return lineY + 1.2 + SIG_LABEL_H;
}

function drawStudentSignature(doc, signatureBuf, x, y, width) {
  const imgH = SIG_IMG_H;
  const imgW = width - 4;

  drawImageInBox(doc, signatureBuf, x + 2, y, imgW, imgH);

  const lineY = y + imgH + 1.5;
  doc.moveTo(x + 2, lineY).lineTo(x + width - 2, lineY).lineWidth(0.5).strokeColor(THEME.muted).stroke();
  doc.font("Helvetica").fontSize(4.4).fillColor(THEME.muted)
    .text("Student Signature", x, lineY + 1.1, { width, align: "center", lineBreak: false });

  return lineY + 1.1 + SIG_LABEL_H;
}

// ============================================================
// INFO ROW
// ============================================================
function drawInfoRow(doc, x, y, width, label, value, opts = {}) {
  const labelW = opts.labelW || 46;
  const fontSize = opts.fontSize || 6.6;
  const rowH = opts.rowH || 12;

  doc.font("Helvetica-Bold").fontSize(fontSize).fillColor(THEME.text)
    .text(label, x, y, { width: labelW - 5, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(fontSize)
    .text(":", x + labelW - 5, y, { width: 6 });

  const valX = x + labelW + 1;
  const valW = width - labelW - 1;
  doc.font("Helvetica").fillColor(THEME.text);
  fitText(doc, value || "—", valW, fontSize + 0.2, 5);
  doc.text(String(value || "—"), valX, y, { width: valW, height: rowH, ellipsis: true, lineBreak: false });
}

// ============================================================
// INSTRUCTIONS BOX (back side, fills space freed by removing
// duplicate principal signature)
// ============================================================
function drawInstructionsBox(doc, x, y, width, height) {
  if (height < 18) height = 18;

  doc.roundedRect(x, y, width, height, 4).fillAndStroke(THEME.light, THEME.border).lineWidth(0.5);

  doc.font("Helvetica-Bold").fontSize(5.4).fillColor(THEME.danger)
    .text("IMPORTANT INSTRUCTIONS", x + 6, y + 2.5, { width: width - 12, lineBreak: false });

  const rules = [
    "Property of the school — carry daily in school premises.",
    "If found, please return to the school office at once.",
    "Not transferable • report loss or damage immediately."
  ];

  let ry = y + 10.5;
  rules.forEach((rule) => {
    if (ry + 7 > y + height - 6) return; // don't spill outside box
    doc.font("Helvetica-Bold").fontSize(4.5).fillColor(THEME.dark).text("•", x + 6, ry, { width: 6, lineBreak: false });
    doc.font("Helvetica").fontSize(4.5).fillColor(THEME.text)
      .text(rule, x + 12, ry, { width: width - 18, lineBreak: false });
    ry += 6.5;
  });

  doc.font("Helvetica").fontSize(4.2).fillColor(THEME.muted)
    .text(`Issued: ${getTodayIndia()}   •   Helpline: ${SCHOOL.helpline}`, x + 6, y + height - 7, { width: width - 12, lineBreak: false });
}

// ============================================================
// FRONT CARD
// ============================================================
function drawFrontCard(doc, x, y, student, buffers) {
  const W = CARD_W, H = CARD_H;
  drawCardFrame(doc, x, y);
  const headerH = drawHeader(doc, x, y, buffers.logoBuf);
  const badgeY = y + headerH + 7;
  drawBadge(doc, x, badgeY, "Student ID Card");
  const contentY = badgeY + 16;

  // ---- Right column: photo + student signature + valid upto ----
  const photoX = x + W - 66, photoY = contentY;
  const photo = drawStudentPhoto(doc, buffers.photoBuf, photoX, photoY);

  // Student signature is placed BELOW the photo, strictly clipped
  const sigTop = photoY + photo.photoH + 3;
  const sigBottom = drawStudentSignature(doc, buffers.signatureBuf, photoX - 3, sigTop, photo.photoW + 6);

  // Valid upto sits under the student signature (same right column)
  doc.font("Helvetica").fontSize(4.4).fillColor(THEME.muted)
    .text("Valid Upto: " + sessionValidUpto(student.session),
      photoX - 3, sigBottom + 0.5,
      { width: photo.photoW + 6, align: "center", lineBreak: false });

  // ---- Left column: detail rows ----
  const infoX = x + 10;
  const infoW = photoX - infoX - 8;
  const rowH = 11.5;
  const streamSuffix = ["11", "12"].includes(String(student.class)) && student.stream ? " - " + student.stream : "";

  drawInfoRow(doc, infoX, contentY, infoW, "Name", student.name, { fontSize: 7.2, labelW: 34, rowH: 13 });

  let ry = contentY + 13.5;
  drawInfoRow(doc, infoX, ry, infoW, "Father", student.father_name, { labelW: 42 });
  ry += rowH;
  drawInfoRow(doc, infoX, ry, infoW, "Mother", student.mother_name, { labelW: 42 });
  ry += rowH;

  const halfW = (infoW - 8) / 2;
  drawInfoRow(doc, infoX, ry, halfW, "D.O.B.", fmtDate(student.dob), { labelW: 32, fontSize: 6.2 });
  drawInfoRow(doc, infoX + halfW + 8, ry, halfW, "Class", `${student.class || "—"}${streamSuffix}`, { labelW: 32, fontSize: 6.2 });
  ry += rowH;

  drawInfoRow(doc, infoX, ry, halfW, "Roll No.", student.roll_number, { labelW: 32, fontSize: 6.2 });
  drawInfoRow(doc, infoX + halfW + 8, ry, halfW, "Stud. ID", student.student_id, { labelW: 32, fontSize: 6.2 });
  ry += rowH;

  drawInfoRow(doc, infoX, ry, infoW, "Session", student.session, { labelW: 42 });
  ry += rowH;

  // ---- Footer: principal signature ----
  // Compute bottom limit for the signature block so it always
  // stays well inside the card.
  const footerY = Math.min(ry + 3, y + H - 26);
  drawPrincipalSignature(doc, buffers.principalBuf, x + 10, footerY, 78);
}

// ============================================================
// BACK CARD
// ============================================================
function drawBackCard(doc, x, y, student, buffers) {
  const W = CARD_W, H = CARD_H;
  drawCardFrame(doc, x, y);
  const headerH = drawHeader(doc, x, y, buffers.logoBuf);
  const badgeY = y + headerH + 7;
  drawBadge(doc, x, badgeY, "Address & Verification");
  const contentY = badgeY + 16;

  // ---- Right column: QR ----
  const qrSize = 42;
  const qrX = x + W - qrSize - 10;
  const qrY = contentY;

  if (buffers.qrBuf) {
    doc.rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4).fillAndStroke(THEME.white, THEME.goldStart).lineWidth(0.9);
    drawImageInBox(doc, buffers.qrBuf, qrX, qrY, qrSize, qrSize);
  }
  doc.font("Helvetica-Bold").fontSize(4.4).fillColor(THEME.dark)
    .text("SCAN TO VERIFY", qrX - 6, qrY + qrSize + 3, { width: qrSize + 12, align: "center", lineBreak: false });
  const qrColumnBottom = qrY + qrSize + 3 + 6;

  // ---- Left column: info rows ----
  const infoX = x + 10;
  const infoRight = qrX - 10;
  const infoW = infoRight - infoX;

  const fullAddress = [
    student.village,
    student.post_office ? "PO " + student.post_office : "",
    student.tehsil ? "Teh. " + student.tehsil : "",
    student.district ? "Distt. " + student.district : "",
    student.state,
    student.pincode
  ].filter(Boolean).join(", ") || student.address || "—";

  drawInfoRow(doc, infoX, contentY, infoW, "Address", fullAddress, { labelW: 42, fontSize: 6, rowH: 19 });

  const halfW = (infoW - 8) / 2;
  const row2Y = contentY + 20;
  drawInfoRow(doc, infoX, row2Y, halfW, "Mobile", student.mobile_number, { labelW: 34, fontSize: 6.2 });
  drawInfoRow(doc, infoX + halfW + 8, row2Y, halfW, "Aadhar", maskAadhar(student.aadhar_number), { labelW: 34, fontSize: 6.2 });

  const row3Y = row2Y + 11;
  drawInfoRow(doc, infoX, row3Y, halfW, "Email", student.email_id, { labelW: 34, fontSize: 6.2 });
  drawInfoRow(doc, infoX + halfW + 8, row3Y, halfW, "APAAR ID", student.apaar_id, { labelW: 34, fontSize: 6.2 });
  const rowsColumnBottom = row3Y + 11;

  // ---- Instructions box fills the space below ----
  const boxY = Math.max(qrColumnBottom, rowsColumnBottom) + 3;
  const boxHeight = y + H - 6 - boxY;
  drawInstructionsBox(doc, x + 8, boxY, W - 16, boxHeight);
}

// ============================================================
// BUILD IMAGE BUFFERS FOR A STUDENT
// ============================================================
async function buildBuffersFor(student, sharedLogoBuf, sharedPrincipalBuf) {
  const verificationUrl = `${SCHOOL.verificationUrl}/${encodeURIComponent(student.student_id)}`;
  const qrData = verificationUrl;
  const [photoBuf, signatureBuf, qrBuf] = await Promise.all([
    fetchImageBuffer(student.student_photo_url),
    fetchImageBuffer(student.signature_url),
    QRCode.toBuffer(qrData, { width: 250, margin: 1, errorCorrectionLevel: "M" })
  ]);
  return { logoBuf: sharedLogoBuf, principalBuf: sharedPrincipalBuf, photoBuf, signatureBuf, qrBuf };
}

// ============================================================
// PAGE METRICS
// ============================================================
function pageMetrics(doc) {
  const PW = doc.page.width, PH = doc.page.height;
  const totalW = CARD_W * 2 + GAP_COL;
  const totalH = CARD_H * ROWS_PER_PAGE + GAP_ROW * (ROWS_PER_PAGE - 1);
  const startX = (PW - totalW) / 2;
  const startY = (PH - totalH) / 2;
  return { PW, PH, startX, startY };
}

function drawPageFooter(doc, text) {
  const { PW, PH } = pageMetrics(doc);
  doc.font("Helvetica").fontSize(5.5).fillColor("#94A3B8").text(text, 0, PH - 11, { width: PW, align: "center", lineBreak: false });
}

function drawPageGuides(doc) {
  const { startX, startY } = pageMetrics(doc);
  doc.save();
  doc.dash(2, { space: 2 }).lineWidth(0.3).strokeColor("#CBD5E1");
  const guideX = startX + CARD_W + GAP_COL / 2;
  doc.moveTo(guideX, startY - 3).lineTo(guideX, startY + ROWS_PER_PAGE * CARD_H + GAP_ROW * (ROWS_PER_PAGE - 1) + 3).stroke();
  for (let i = 1; i < ROWS_PER_PAGE; i++) {
    const guideY = startY + i * CARD_H + (i - 0.5) * GAP_ROW;
    doc.moveTo(startX - 3, guideY).lineTo(startX + CARD_W * 2 + GAP_COL + 3, guideY).stroke();
  }
  doc.undash();
  doc.restore();
}

// ============================================================
// RENDER FULL SET
// ============================================================
async function renderStudentsGrid(doc, students, sharedLogoBuf, sharedPrincipalBuf, footerText) {
  let metrics = pageMetrics(doc);
  drawPageGuides(doc);

  for (let i = 0; i < students.length; i++) {
    if (i > 0 && i % ROWS_PER_PAGE === 0) {
      drawPageFooter(doc, footerText);
      doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
      metrics = pageMetrics(doc);
      drawPageGuides(doc);
    }

    const rowIndex = i % ROWS_PER_PAGE;
    const rowY = metrics.startY + rowIndex * (CARD_H + GAP_ROW);
    const frontX = metrics.startX;
    const backX = metrics.startX + CARD_W + GAP_COL;
    const student = students[i];
    const buffers = await buildBuffersFor(student, sharedLogoBuf, sharedPrincipalBuf);

    drawFrontCard(doc, frontX, rowY, student, buffers);
    drawBackCard(doc, backX, rowY, student, buffers);
    drawCutMarks(doc, frontX, rowY, CARD_W, CARD_H);
    drawCutMarks(doc, backX, rowY, CARD_W, CARD_H);
  }

  drawPageFooter(doc, footerText);
}

// ============================================================
// SHARED PDF RESPONSE HELPER
// ============================================================
async function sendIdCardPdf(res, students, filename, title, footerText) {
  const [logoBuf, principalBuf] = await Promise.all([
    fetchImageBuffer(SCHOOL.logoUrl),
    fetchImageBuffer(SCHOOL.principalSignatureUrl)
  ]);

  const doc = new PDFDocument({
    size: "A4", layout: "portrait", margin: 0,
    info: { Title: title, Author: SCHOOL.name, Subject: "Student Identification Card(s)" }
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  doc.pipe(res);

  await renderStudentsGrid(doc, students, logoBuf, principalBuf, footerText);
  doc.end();
}

// ============================================================
// ROUTE — SINGLE STUDENT
// ============================================================
router.get("/generate/:studentId/pdf", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q(`SELECT * FROM Nstudent WHERE student_id = ? LIMIT 1`, [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const student = rows[0];

    await sendIdCardPdf(
      res,
      [student],
      `idcard-${student.student_id}.pdf`,
      `Student ID Card - ${student.student_id}`,
      "Official Student ID Card • Govt. Sr. Sec. School Shilla"
    );
  } catch (err) {
    console.error("ID Card PDF Error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Unable to generate ID card PDF" });
  }
});

// ============================================================
// ROUTE — WHOLE CLASS (BULK)
// ============================================================
router.get("/generate-class/:class/pdf", async (req, res) => {
  try {
    const cls = req.params.class;
    const session = req.query.session;
    const where = ["class = ?"];
    const params = [cls];
    if (session) { where.push("session = ?"); params.push(session); }

    const students = await q(
      `SELECT * FROM Nstudent WHERE ${where.join(" AND ")} ORDER BY CAST(roll_number AS UNSIGNED) ASC, name ASC`,
      params
    );

    if (!students.length) return res.status(404).json({ success: false, message: "No students found" });

    const totalPages = Math.ceil(students.length / ROWS_PER_PAGE);
    await sendIdCardPdf(
      res,
      students,
      `idcards-class-${cls}.pdf`,
      `Class ${cls} Student ID Cards`,
      `Class ${cls} • ${students.length} Students • ${totalPages} Page(s) • Official ID Cards`
    );
  } catch (err) {
    console.error("Bulk ID Card PDF Error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Unable to generate class ID cards" });
  }
});

// ============================================================
// ROUTE — SELECTED STUDENTS (any mix)
// ============================================================
async function handleSelected(req, res) {
  try {
    const rawIds = req.method === "GET"
      ? (req.query.ids || "")
      : (req.body && req.body.ids);

    const ids = Array.isArray(rawIds)
      ? rawIds.map((v) => String(v).trim()).filter(Boolean)
      : String(rawIds).split(",").map((v) => v.trim()).filter(Boolean);

    if (!ids.length) {
      return res.status(400).json({ success: false, message: "No student IDs provided" });
    }

    const placeholders = ids.map(() => "?").join(",");
    const students = await q(
      `SELECT * FROM Nstudent WHERE student_id IN (${placeholders})`,
      ids
    );

    if (!students.length) {
      return res.status(404).json({ success: false, message: "No matching students found" });
    }

    const order = new Map(ids.map((id, idx) => [id, idx]));
    students.sort((a, b) => (order.get(String(a.student_id)) ?? 0) - (order.get(String(b.student_id)) ?? 0));

    const totalPages = Math.ceil(students.length / ROWS_PER_PAGE);
    await sendIdCardPdf(
      res,
      students,
      `idcards-selected.pdf`,
      `Selected Student ID Cards`,
      `Selected Students • ${students.length} Students • ${totalPages} Page(s) • Official ID Cards`
    );
  } catch (err) {
    console.error("Selected ID Card PDF Error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Unable to generate selected ID cards" });
  }
}

router.get("/generate-selected/pdf", handleSelected);
router.post("/generate-selected/pdf", handleSelected);

module.exports = router;
