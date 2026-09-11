```js
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

  address:
    "Shilla, Nerwa, Distt. Shimla, Himachal Pradesh - 171210",

  logoUrl:
    "https://gsssshilla07.pages.dev/logo(1).png",

  principalSignatureUrl:
    "https://gsssshilla07.pages.dev/principal.png",

  verificationUrl:
    "https://gsssshilla07.pages.dev/verify",

  issuedBy:
    "Govt. Sr. Sec. School Shilla"
};


// ============================================================
// CARD SIZE
// CR80 STANDARD PVC ID CARD
// ============================================================

const CARD_W = 243;
const CARD_H = 153;


// ============================================================
// A4 PAGE SETTINGS
// ============================================================

const GAP_COL = 12;
const GAP_ROW = 8;

const ROWS_PER_PAGE = 5;


// ============================================================
// IMAGE SETTINGS
// ============================================================

const MAX_IMAGE_SIZE =
  5 * 1024 * 1024;

const IMAGE_TIMEOUT =
  10000;


// ============================================================
// COLOR THEME
// ============================================================

const THEME = {

  blueStart: "#142B72",

  blueEnd: "#3D63D8",

  goldStart: "#B8860B",

  goldEnd: "#E9C46A",

  dark: "#102033",

  text: "#1E293B",

  muted: "#64748B",

  light: "#F8FAFC",

  border: "#CBD5E1",

  white: "#FFFFFF",

  success: "#15803D"

};


// ============================================================
// SAFE IMAGE URL VALIDATION
// ============================================================

function isValidImageUrl(url) {

  if (!url) return false;

  try {

    const parsed =
      new URL(url);

    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:"
    );

  } catch {

    return false;

  }

}


// ============================================================
// FETCH IMAGE BUFFER
// ============================================================

function fetchImageBuffer(
  url,
  redirects = 0
) {

  return new Promise((resolve) => {

    if (
      !isValidImageUrl(url) ||
      redirects > 5
    ) {
      return resolve(null);
    }


    const client =
      url.startsWith("https")
        ? https
        : http;


    const req =
      client.get(url, (resp) => {


        // ========================================
        // REDIRECT SUPPORT
        // ========================================

        if (
          [301, 302, 307, 308]
            .includes(resp.statusCode) &&
          resp.headers.location
        ) {

          resp.resume();

          return resolve(
            fetchImageBuffer(
              resp.headers.location,
              redirects + 1
            )
          );

        }


        // ========================================
        // STATUS CHECK
        // ========================================

        if (
          resp.statusCode !== 200
        ) {

          resp.resume();

          return resolve(null);

        }


        // ========================================
        // CONTENT TYPE CHECK
        // ========================================

        const contentType =
          resp.headers["content-type"] ||
          "";

        if (
          !contentType.startsWith("image/")
        ) {

          resp.resume();

          return resolve(null);

        }


        const chunks = [];

        let totalSize = 0;


        resp.on(
          "data",
          (chunk) => {

            totalSize +=
              chunk.length;


            if (
              totalSize >
              MAX_IMAGE_SIZE
            ) {

              req.destroy();

              return resolve(null);

            }


            chunks.push(chunk);

          }
        );


        resp.on(
          "end",
          () => {

            resolve(
              Buffer.concat(chunks)
            );

          }
        );


      });


    req.on(
      "error",
      () => resolve(null)
    );


    req.setTimeout(
      IMAGE_TIMEOUT,
      () => {

        req.destroy();

        resolve(null);

      }
    );

  });

}


// ============================================================
// DATE FORMAT
// ============================================================

function fmtDate(date) {

  if (!date) return "—";

  const dt =
    new Date(date);

  if (isNaN(dt)) {

    return String(date);

  }

  return dt.toLocaleDateString(
    "en-IN",
    {

      timeZone:
        "Asia/Kolkata",

      day:
        "2-digit",

      month:
        "2-digit",

      year:
        "numeric"

    }
  );

}


// ============================================================
// MASK AADHAR
// ============================================================

function maskAadhar(value) {

  if (!value) return "—";

  const number =
    String(value)
      .replace(/\s/g, "");


  if (
    number.length < 4
  ) {

    return "XXXX XXXX XXXX";

  }


  return (
    "XXXX XXXX " +
    number.slice(-4)
  );

}


// ============================================================
// SESSION VALIDITY
// ============================================================

function sessionValidUpto(session) {

  if (!session) {

    return "—";

  }


  const match =
    String(session)
      .match(
        /(\d{4})\D?(\d{2,4})/
      );


  if (!match) {

    return String(session);

  }


  let endYear =
    match[2];


  if (
    endYear.length === 2
  ) {

    endYear =
      "20" + endYear;

  }


  return (
    "31/03/" +
    endYear
  );

}


// ============================================================
// CURRENT INDIA DATE
// ============================================================

function getTodayIndia() {

  return new Date()
    .toLocaleDateString(
      "en-IN",
      {

        timeZone:
          "Asia/Kolkata",

        day:
          "2-digit",

        month:
          "2-digit",

        year:
          "numeric"

      }
    );

}


// ============================================================
// TEXT FIT HELPER
// PREVENTS OVERFLOW
// ============================================================

function fitText(
  doc,
  text,
  maxWidth,
  startSize = 6,
  minSize = 4
) {

  let size =
    startSize;

  doc.fontSize(size);


  while (
    doc.widthOfString(
      String(text)
    ) > maxWidth &&
    size > minSize
  ) {

    size -= 0.2;

    doc.fontSize(size);

  }


  return size;

}


// ============================================================
// DRAW CUT MARKS
// ============================================================

function drawCutMarks(
  doc,
  x,
  y,
  w,
  h,
  len = 7,
  offset = 3
) {

  doc.save();

  doc
    .lineWidth(0.5)
    .strokeColor("#94A3B8");


  // TOP LEFT

  doc
    .moveTo(
      x - offset,
      y
    )
    .lineTo(
      x - offset - len,
      y
    )
    .stroke();

  doc
    .moveTo(
      x,
      y - offset
    )
    .lineTo(
      x,
      y - offset - len
    )
    .stroke();


  // TOP RIGHT

  doc
    .moveTo(
      x + w + offset,
      y
    )
    .lineTo(
      x + w + offset + len,
      y
    )
    .stroke();

  doc
    .moveTo(
      x + w,
      y - offset
    )
    .lineTo(
      x + w,
      y - offset - len
    )
    .stroke();


  // BOTTOM LEFT

  doc
    .moveTo(
      x - offset,
      y + h
    )
    .lineTo(
      x - offset - len,
      y + h
    )
    .stroke();

  doc
    .moveTo(
      x,
      y + h + offset
    )
    .lineTo(
      x,
      y + h + offset + len
    )
    .stroke();


  // BOTTOM RIGHT

  doc
    .moveTo(
      x + w + offset,
      y + h
    )
    .lineTo(
      x + w + offset + len,
      y + h
    )
    .stroke();

  doc
    .moveTo(
      x + w,
      y + h + offset
    )
    .lineTo(
      x + w,
      y + h + offset + len
    )
    .stroke();


  doc.restore();

}


// ============================================================
// DRAW CARD BACKGROUND
// ============================================================

function drawCardFrame(
  doc,
  x,
  y
) {

  const W = CARD_W;
  const H = CARD_H;


  // OUTER CARD

  doc
    .roundedRect(
      x,
      y,
      W,
      H,
      8
    )
    .fillAndStroke(
      THEME.white,
      THEME.dark
    );


  // INNER BORDER

  doc
    .roundedRect(
      x + 2.5,
      y + 2.5,
      W - 5,
      H - 5,
      6
    )
    .lineWidth(0.8)
    .strokeColor(
      THEME.goldStart
    )
    .stroke();

}


// ============================================================
// DRAW HEADER
// ============================================================

function drawHeader(
  doc,
  x,
  y,
  logoBuf
) {

  const W = CARD_W;

  const headerH =
    27;


  // HEADER GRADIENT

  const gradient =
    doc.linearGradient(
      x,
      y,
      x + W,
      y + headerH
    );


  gradient
    .stop(
      0,
      THEME.blueStart
    )
    .stop(
      1,
      THEME.blueEnd
    );


  doc
    .roundedRect(
      x + 3,
      y + 3,
      W - 6,
      headerH,
      6
    )
    .fill(gradient);


  // LOGO - BIGGER

  const logoSize =
    23;

  const logoX =
    x + 7;

  const logoY =
    y + 5;


  if (logoBuf) {

    try {

      doc.image(
        logoBuf,
        logoX,
        logoY,
        {
          fit: [
            logoSize,
            logoSize
          ]
        }
      );

    } catch (err) {}

  }


  // SCHOOL NAME

  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(
      THEME.white
    )
    .text(
      SCHOOL.name,
      x + 34,
      y + 7,
      {

        width:
          W - 42,

        align:
          "center",

        lineBreak:
          false

      }
    );


  // ADDRESS

  doc
    .font("Helvetica")
    .fontSize(5.1)
    .fillColor("#E0E7FF")
    .text(
      SCHOOL.address,
      x + 34,
      y + 17,
      {

        width:
          W - 42,

        align:
          "center"

      }
    );


  return headerH;

}


// ============================================================
// DRAW BADGE
// ============================================================

function drawBadge(
  doc,
  x,
  y,
  text
) {

  const badgeW =
    text === "STUDENT ID CARD"
      ? 84
      : 112;

  const badgeH =
    10;


  const badgeX =
    x +
    (
      CARD_W - badgeW
    ) / 2;


  const gradient =
    doc.linearGradient(
      badgeX,
      y,
      badgeX + badgeW,
      y
    );


  gradient
    .stop(
      0,
      THEME.goldStart
    )
    .stop(
      1,
      THEME.goldEnd
    );


  doc
    .roundedRect(
      badgeX,
      y,
      badgeW,
      badgeH,
      5
    )
    .fill(gradient);


  doc
    .font("Helvetica-Bold")
    .fontSize(5.7)
    .fillColor(
      THEME.white
    )
    .text(
      text,
      badgeX,
      y + 2.7,
      {

        width:
          badgeW,

        align:
          "center",

        characterSpacing:
          0.35

      }
    );


}


// ============================================================
// DRAW STUDENT PHOTO
// ============================================================

function drawStudentPhoto(
  doc,
  photoBuf,
  x,
  y
) {

  const photoW =
    48;

  const photoH =
    57;


  // PHOTO BORDER

  doc
    .rect(
      x - 2,
      y - 2,
      photoW + 4,
      photoH + 4
    )
    .lineWidth(0.8)
    .strokeColor(
      THEME.goldStart
    )
    .stroke();


  if (photoBuf) {

    try {

      doc.image(
        photoBuf,
        x,
        y,
        {

          fit: [
            photoW,
            photoH
          ],

          align:
            "center",

          valign:
            "center"

        }
      );

    } catch (err) {

      drawPhotoPlaceholder(
        doc,
        x,
        y,
        photoW,
        photoH
      );

    }

  } else {

    drawPhotoPlaceholder(
      doc,
      x,
      y,
      photoW,
      photoH
    );

  }


  return {
    photoW,
    photoH
  };

}


// ============================================================
// PHOTO PLACEHOLDER
// ============================================================

function drawPhotoPlaceholder(
  doc,
  x,
  y,
  w,
  h
) {

  doc
    .rect(
      x,
      y,
      w,
      h
    )
    .fillAndStroke(
      THEME.light,
      THEME.border
    );


  doc
    .font("Helvetica")
    .fontSize(5.5)
    .fillColor(
      THEME.muted
    )
    .text(
      "STUDENT PHOTO",
      x,
      y + h / 2 - 3,
      {

        width: w,

        align:
          "center"

      }
    );

}


// ============================================================
// DRAW PRINCIPAL SIGNATURE
// ============================================================

function drawPrincipalSignature(
  doc,
  principalBuf,
  x,
  y,
  width = 58
) {

  const signatureHeight =
    17;


  if (principalBuf) {

    try {

      doc.image(
        principalBuf,
        x + 4,
        y - 8,
        {

          fit: [
            width - 8,
            signatureHeight
          ],

          align:
            "center",

          valign:
            "bottom"

        }
      );

    } catch (err) {}

  }


  doc
    .moveTo(
      x,
      y + 10
    )
    .lineTo(
      x + width,
      y + 10
    )
    .lineWidth(0.5)
    .strokeColor(
      THEME.muted
    )
    .stroke();


  doc
    .font("Helvetica-Bold")
    .fontSize(5.2)
    .fillColor(
      THEME.dark
    )
    .text(
      "Principal",
      x,
      y + 12,
      {

        width,

        align:
          "center"

      }
    );

}


// ============================================================
// DRAW STUDENT SIGNATURE
// ============================================================

function drawStudentSignature(
  doc,
  signatureBuf,
  x,
  y,
  width
) {

  const signatureHeight =
    11;


  if (signatureBuf) {

    try {

      doc.image(
        signatureBuf,
        x + 2,
        y,
        {

          fit: [
            width - 4,
            signatureHeight
          ],

          align:
            "center",

          valign:
            "bottom"

        }
      );

    } catch (err) {}

  }


  doc
    .moveTo(
      x + 2,
      y + 12
    )
    .lineTo(
      x + width - 2,
      y + 12
    )
    .lineWidth(0.4)
    .strokeColor(
      THEME.muted
    )
    .stroke();


  doc
    .font("Helvetica")
    .fontSize(4.5)
    .fillColor(
      THEME.muted
    )
    .text(
      "Student Signature",
      x,
      y + 13.5,
      {

        width,

        align:
          "center"

      }
    );

}


// ============================================================
// DRAW FRONT CARD
// ============================================================

function drawFrontCard(
  doc,
  x,
  y,
  student,
  buffers
) {

  const W =
    CARD_W;

  const H =
    CARD_H;


  drawCardFrame(
    doc,
    x,
    y
  );


  const headerH =
    drawHeader(
      doc,
      x,
      y,
      buffers.logoBuf
    );


  const badgeY =
    y + headerH + 7;


  drawBadge(
    doc,
    x,
    badgeY,
    "STUDENT ID CARD"
  );


  const contentY =
    badgeY + 15;


  // ========================================
  // PHOTO AREA
  // ========================================

  const photoX =
    x + W - 55;

  const photoY =
    contentY;


  const photo =
    drawStudentPhoto(
      doc,
      buffers.photoBuf,
      photoX,
      photoY
    );


  drawStudentSignature(
    doc,
    buffers.signatureBuf,
    photoX,
    photoY +
      photo.photoH +
      4,
    photo.photoW
  );


  // ========================================
  // INFORMATION AREA
  // ========================================

  const infoX =
    x + 8;

  const infoW =
    photoX -
    infoX -
    8;


  const labelW =
    41;

  const valueX =
    infoX +
    labelW +
    2;

  const valueW =
    infoW -
    labelW -
    2;


  const rowH =
    9.5;


  const rows = [

    [
      "Name",
      student.name
    ],

    [
      "Father",
      student.father_name
    ],

    [
      "Mother",
      student.mother_name
    ],

    [
      "D.O.B.",
      fmtDate(
        student.dob
      )
    ],

    [
      "Class",
      `${student.class || "—"}${
        ["11", "12"]
          .includes(
            String(
              student.class
            )
          ) &&
        student.stream
          ? " - " +
            student.stream
          : ""
      }`
    ],

    [
      "Roll No.",
      student.roll_number
    ],

    [
      "Student ID",
      student.student_id
    ],

    [
      "Session",
      student.session
    ]

  ];


  rows.forEach(
    ([label, value], index) => {

      const rowY =
        contentY +
        index * rowH;


      // LABEL

      doc
        .font(
          "Helvetica-Bold"
        )
        .fontSize(5.7)
        .fillColor(
          THEME.text
        )
        .text(
          label,
          infoX,
          rowY,
          {

            width:
              labelW - 5,

            lineBreak:
              false

          }
        );


      // COLON

      doc
        .font(
          "Helvetica-Bold"
        )
        .fontSize(5.7)
        .text(
          ":",
          infoX +
            labelW -
            4,
          rowY,
          {

            width: 5

          }
        );


      // VALUE

      doc
        .font(
          "Helvetica"
        )
        .fillColor(
          THEME.text
        );


      fitText(
        doc,
        value || "—",
        valueW,
        6,
        4.8
      );


      doc.text(
        String(
          value || "—"
        ),
        valueX,
        rowY,
        {

          width:
            valueW,

          height:
            rowH,

          ellipsis:
            true,

          lineBreak:
            false

        }
      );

    }
  );


  // ========================================
  // FOOTER AREA
  // ========================================

  const footerY =
    y + H - 25;


  // PRINCIPAL SIGNATURE

  drawPrincipalSignature(
    doc,
    buffers.principalBuf,
    x + 11,
    footerY,
    62
  );


  // VALIDITY

  doc
    .font(
      "Helvetica"
    )
    .fontSize(4.8)
    .fillColor(
      THEME.muted
    )
    .text(
      "Valid upto:",
      x + W - 75,
      footerY + 11,
      {

        width: 67,

        align:
          "center"

      }
    );


  doc
    .font(
      "Helvetica-Bold"
    )
    .fontSize(5.2)
    .fillColor(
      THEME.dark
    )
    .text(
      sessionValidUpto(
        student.session
      ),
      x + W - 75,
      footerY + 17,
      {

        width: 67,

        align:
          "center"

      }
    );

}


// ============================================================
// DRAW BACK CARD
// ============================================================

function drawBackCard(
  doc,
  x,
  y,
  student,
  buffers
) {

  const W =
    CARD_W;

  const H =
    CARD_H;


  drawCardFrame(
    doc,
    x,
    y
  );


  const headerH =
    drawHeader(
      doc,
      x,
      y,
      buffers.logoBuf
    );


  const badgeY =
    y + headerH + 7;


  drawBadge(
    doc,
    x,
    badgeY,
    "ADDRESS & VERIFICATION"
  );


  const contentY =
    badgeY + 17;


  // ========================================
  // QR AREA
  // ========================================

  const qrSize =
    42;

  const qrX =
    x + W - qrSize - 10;

  const qrY =
    y + H - qrSize - 30;


  if (buffers.qrBuf) {

    try {

      doc
        .rect(
          qrX - 2,
          qrY - 2,
          qrSize + 4,
          qrSize + 4
        )
        .lineWidth(0.7)
        .strokeColor(
          THEME.goldStart
        )
        .stroke();


      doc.image(
        buffers.qrBuf,
        qrX,
        qrY,
        {

          fit: [
            qrSize,
            qrSize
          ]

        }
      );

    } catch (err) {}

  }


  // ========================================
  // ADDRESS + INFO
  // ========================================

  const infoX =
    x + 8;

  const labelW =
    44;

  const valueX =
    infoX +
    labelW +
    2;


  const infoRight =
    qrX - 10;


  const valueW =
    infoRight -
    valueX;


  // FULL ADDRESS

  const fullAddress =
    [

      student.village,

      student.post_office
        ? "PO " +
          student.post_office
        : "",

      student.tehsil
        ? "Teh. " +
          student.tehsil
        : "",

      student.district
        ? "Distt. " +
          student.district
        : "",

      student.state,

      student.pincode

    ]
      .filter(Boolean)
      .join(", ")
    ||
    student.address
    ||
    "—";


  const rows = [

    [
      "Address",
      fullAddress,
      25
    ],

    [
      "Mobile No.",
      student.mobile_number,
      9
    ],

    [
      "Email",
      student.email_id,
      9
    ],

    [
      "APAAR ID",
      student.apaar_id,
      9
    ]

  ];


  let currentY =
    contentY;


  rows.forEach(
    ([label, value, height]) => {


      doc
        .font(
          "Helvetica-Bold"
        )
        .fontSize(5.7)
        .fillColor(
          THEME.text
        )
        .text(
          label,
          infoX,
          currentY,
          {

            width:
              labelW - 4

          }
        );


      doc
        .text(
          ":",
          infoX +
            labelW -
            4,
          currentY
        );


      doc
        .font(
          "Helvetica"
        )
        .fontSize(
          label === "Address"
            ? 5.2
            : 5.7
        )
        .fillColor(
          THEME.text
        )
        .text(
          String(
            value || "—"
          ),
          valueX,
          currentY,
          {

            width:
              valueW,

            height,

            ellipsis:
              true

          }
        );


      currentY +=
        height + 3;

    }
  );


  // ========================================
  // QR LABEL
  // ========================================

  doc
    .font(
      "Helvetica-Bold"
    )
    .fontSize(4.4)
    .fillColor(
      THEME.dark
    )
    .text(
      "SCAN TO VERIFY",
      qrX - 5,
      qrY + qrSize + 3,
      {

        width:
          qrSize + 10,

        align:
          "center"

      }
    );


  // ========================================
  // PRINCIPAL SIGNATURE
  // ========================================

  const footerY =
    y + H - 24;


  drawPrincipalSignature(
    doc,
    buffers.principalBuf,
    x + 12,
    footerY,
    65
  );


  // ========================================
  // ISSUE DATE
  // ========================================

  doc
    .font(
      "Helvetica"
    )
    .fontSize(4.5)
    .fillColor(
      THEME.muted
    )
    .text(
      "Issued: " +
      getTodayIndia(),
      x + 80,
      y + H - 15,
      {

        width:
          65,

        align:
          "center"

      }
    );


  // ========================================
  // SCHOOL PROPERTY TEXT
  // ========================================

  doc
    .font(
      "Helvetica"
    )
    .fontSize(4.2)
    .fillColor(
      THEME.muted
    )
    .text(
      "This card is the property of the school.",
      x + 80,
      y + H - 8,
      {

        width:
          110,

        align:
          "center"

      }
    );

}


// ============================================================
// BUILD BUFFERS
// ============================================================

async function buildBuffersFor(
  student,
  sharedLogoBuf,
  sharedPrincipalBuf
) {


  // ========================================
  // QR VERIFICATION DATA
  // ========================================

  const verificationUrl =
    `${SCHOOL.verificationUrl}/${encodeURIComponent(
      student.student_id
    )}`;


  const qrData =
    verificationUrl;


  // ========================================
  // FETCH ALL
  // ========================================

  const [

    photoBuf,

    signatureBuf,

    qrBuf

  ] =
    await Promise.all([

      fetchImageBuffer(
        student.student_photo_url
      ),

      fetchImageBuffer(
        student.signature_url
      ),

      QRCode.toBuffer(
        qrData,
        {

          width: 250,

          margin: 1,

          errorCorrectionLevel:
            "M"

        }
      )

    ]);


  return {

    logoBuf:
      sharedLogoBuf,

    principalBuf:
      sharedPrincipalBuf,

    photoBuf,

    signatureBuf,

    qrBuf

  };

}


// ============================================================
// PAGE METRICS
// ============================================================

function pageMetrics(doc) {

  const PW =
    doc.page.width;

  const PH =
    doc.page.height;


  const totalW =
    CARD_W * 2 +
    GAP_COL;


  const totalH =
    CARD_H *
      ROWS_PER_PAGE +
    GAP_ROW *
      (
        ROWS_PER_PAGE - 1
      );


  const startX =
    (
      PW -
      totalW
    ) / 2;


  const startY =
    (
      PH -
      totalH
    ) / 2;


  return {

    PW,

    PH,

    startX,

    startY

  };

}


// ============================================================
// PAGE FOOTER
// ============================================================

function drawPageFooter(
  doc,
  text
) {

  const {

    PW,

    PH

  } =
    pageMetrics(doc);


  doc
    .font(
      "Helvetica"
    )
    .fontSize(5.5)
    .fillColor(
      "#94A3B8"
    )
    .text(
      text,
      0,
      PH - 11,
      {

        width:
          PW,

        align:
          "center"

      }
    );

}


// ============================================================
// DRAW PAGE GUIDES
// ============================================================

function drawPageGuides(doc) {

  const {

    startX,

    startY

  } =
    pageMetrics(doc);


  doc.save();

  doc
    .dash(2, {
      space: 2
    })
    .lineWidth(0.3)
    .strokeColor(
      "#CBD5E1"
    );


  // VERTICAL GUIDE

  const guideX =
    startX +
    CARD_W +
    GAP_COL / 2;


  doc
    .moveTo(
      guideX,
      startY - 3
    )
    .lineTo(
      guideX,
      startY +
      ROWS_PER_PAGE *
      CARD_H +
      GAP_ROW *
      (
        ROWS_PER_PAGE - 1
      ) +
      3
    )
    .stroke();


  // HORIZONTAL GUIDES

  for (
    let i = 1;
    i < ROWS_PER_PAGE;
    i++
  ) {

    const guideY =
      startY +
      i *
      CARD_H +
      (
        i - 0.5
      ) *
      GAP_ROW;


    doc
      .moveTo(
        startX - 3,
        guideY
      )
      .lineTo(
        startX +
        CARD_W * 2 +
        GAP_COL +
        3,
        guideY
      )
      .stroke();

  }


  doc.undash();

  doc.restore();

}


// ============================================================
// RENDER STUDENTS GRID
// ============================================================

async function renderStudentsGrid(
  doc,
  students,
  sharedLogoBuf,
  sharedPrincipalBuf,
  footerText
) {

  let metrics =
    pageMetrics(doc);


  drawPageGuides(doc);


  for (
    let i = 0;
    i < students.length;
    i++
  ) {


    // ========================================
    // NEW PAGE
    // ========================================

    if (
      i > 0 &&
      i %
        ROWS_PER_PAGE ===
        0
    ) {

      drawPageFooter(
        doc,
        footerText
      );


      doc.addPage(
        {

          size:
            "A4",

          layout:
            "portrait",

          margin: 0

        }
      );


      metrics =
        pageMetrics(doc);


      drawPageGuides(doc);

    }


    const rowIndex =
      i %
      ROWS_PER_PAGE;


    const rowY =
      metrics.startY +
      rowIndex *
      (
        CARD_H +
        GAP_ROW
      );


    const frontX =
      metrics.startX;


    const backX =
      metrics.startX +
      CARD_W +
      GAP_COL;


    const student =
      students[i];


    const buffers =
      await buildBuffersFor(
        student,
        sharedLogoBuf,
        sharedPrincipalBuf
      );


    // ========================================
    // FRONT
    // ========================================

    drawFrontCard(
      doc,
      frontX,
      rowY,
      student,
      buffers
    );


    // ========================================
    // BACK
    // ========================================

    drawBackCard(
      doc,
      backX,
      rowY,
      student,
      buffers
    );


    // ========================================
    // CUT MARKS
    // ========================================

    drawCutMarks(
      doc,
      frontX,
      rowY,
      CARD_W,
      CARD_H
    );


    drawCutMarks(
      doc,
      backX,
      rowY,
      CARD_W,
      CARD_H
    );

  }


  // ========================================
  // LAST PAGE FOOTER
  // ========================================

  drawPageFooter(
    doc,
    footerText
  );

}


// ============================================================
// ROUTE
// SINGLE STUDENT
// PUBLIC
// ============================================================

router.get(
  "/generate/:studentId/pdf",
  async (
    req,
    res
  ) => {

    try {

      const {
        studentId
      } =
        req.params;


      const rows =
        await q(
          `
          SELECT *
          FROM Nstudent
          WHERE student_id = ?
          LIMIT 1
          `,
          [
            studentId
          ]
        );


      if (
        !rows.length
      ) {

        return res
          .status(404)
          .json(
            {

              success:
                false,

              message:
                "Student not found"

            }
          );

      }


      const student =
        rows[0];


      // ========================================
      // SCHOOL IMAGES
      // ========================================

      const [

        logoBuf,

        principalBuf

      ] =
        await Promise.all([

          fetchImageBuffer(
            SCHOOL.logoUrl
          ),

          fetchImageBuffer(
            SCHOOL.principalSignatureUrl
          )

        ]);


      // ========================================
      // PDF
      // ========================================

      const doc =
        new PDFDocument(
          {

            size:
              "A4",

            layout:
              "portrait",

            margin: 0,

            info:
              {

                Title:
                  `Student ID Card - ${student.student_id}`,

                Author:
                  SCHOOL.name,

                Subject:
                  "Official Student Identification Card"

              }

          }
        );


      res.setHeader(
        "Content-Type",
        "application/pdf"
      );


      res.setHeader(
        "Content-Disposition",
        `inline; filename="idcard-${student.student_id}.pdf"`
      );


      doc.pipe(res);


      await renderStudentsGrid(
        doc,
        [
          student
        ],
        logoBuf,
        principalBuf,
        "Official Student ID Card • Govt. Sr. Sec. School Shilla"
      );


      doc.end();


    } catch (err) {

      console.error(
        "ID Card PDF Error:",
        err
      );


      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .json(
            {

              success:
                false,

              message:
                "Unable to generate ID card PDF"

            }
          );

      }

    }

  }
);


// ============================================================
// ROUTE
// BULK CLASS PDF
// PUBLIC
// ============================================================

router.get(
  "/generate-class/:class/pdf",
  async (
    req,
    res
  ) => {

    try {

      const cls =
        req.params.class;


      const session =
        req.query.session;


      const where =
        [
          "class = ?"
        ];


      const params =
        [
          cls
        ];


      if (session) {

        where.push(
          "session = ?"
        );

        params.push(
          session
        );

      }


      const students =
        await q(
          `
          SELECT *
          FROM Nstudent
          WHERE ${where.join(" AND ")}
          ORDER BY
            CAST(roll_number AS UNSIGNED) ASC,
            name ASC
          `,
          params
        );


      if (
        !students.length
      ) {

        return res
          .status(404)
          .json(
            {

              success:
                false,

              message:
                "No students found"

            }
          );

      }


      // ========================================
      // SCHOOL IMAGES
      // ========================================

      const [

        logoBuf,

        principalBuf

      ] =
        await Promise.all([

          fetchImageBuffer(
            SCHOOL.logoUrl
          ),

          fetchImageBuffer(
            SCHOOL.principalSignatureUrl
          )

        ]);


      // ========================================
      // PDF
      // ========================================

      const doc =
        new PDFDocument(
          {

            size:
              "A4",

            layout:
              "portrait",

            margin: 0,

            info:
              {

                Title:
                  `Class ${cls} Student ID Cards`,

                Author:
                  SCHOOL.name,

                Subject:
                  "Bulk Student ID Cards"

              }

          }
        );


      res.setHeader(
        "Content-Type",
        "application/pdf"
      );


      res.setHeader(
        "Content-Disposition",
        `inline; filename="idcards-class-${cls}.pdf"`
      );


      doc.pipe(res);


      const totalPages =
        Math.ceil(
          students.length /
          ROWS_PER_PAGE
        );


      const footerText =
        `Class ${cls} • ${students.length} Students • ${totalPages} Page(s) • Official ID Cards`;


      await renderStudentsGrid(
        doc,
        students,
        logoBuf,
        principalBuf,
        footerText
      );


      doc.end();


    } catch (err) {

      console.error(
        "Bulk ID Card PDF Error:",
        err
      );


      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .json(
            {

              success:
                false,

              message:
                "Unable to generate class ID cards"

            }
          );

      }

    }

  }
);


module.exports =
  router;
```
