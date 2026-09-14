const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const multer = require("multer");
const { cloudinary, uploadDownload } = require("../config/cloudinary");

const { db } = require("../config/db");

// ✅ Wrapper for callback-based mysql2 (existing db.js)
const q = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// ============================================================
// TABLE AUTO-CREATE
// ============================================================
(async () => {
    try {
        await q(`
            CREATE TABLE IF NOT EXISTS school_documents (
                id INT PRIMARY KEY AUTO_INCREMENT,
                doc_number VARCHAR(100) NOT NULL,
                doc_date DATE NOT NULL,
                doc_type VARCHAR(80) NOT NULL,
                title VARCHAR(255) NOT NULL,
                title_style TEXT DEFAULT NULL,
                subject VARCHAR(500),
                subject_style TEXT DEFAULT NULL,
                body_html LONGTEXT NOT NULL,
                issued_by_name VARCHAR(150),
                issued_by_designation VARCHAR(150),
                signature_url VARCHAR(500) DEFAULT NULL,
                signature_public_id VARCHAR(255) DEFAULT NULL,
                status ENUM('Draft','Published','Archived') DEFAULT 'Draft',
                created_by VARCHAR(120),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_doc_number (doc_number),
                INDEX idx_doc_date (doc_date DESC),
                INDEX idx_type (doc_type),
                INDEX idx_status (status),
                INDEX idx_created (created_at DESC)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log("✅ school_documents table ready");
    } catch (err) {
        console.error("❌ school_documents table error:", err.message);
    }
})();

// ============================================================
// IMAGE UPLOAD (Editor ke liye) — Cloudinary
// ============================================================
const uploadDocumentImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post("/upload-image", uploadDocumentImage.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file" });

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "school/documents/inline", resource_type: "image" },
                (err, result) => err ? reject(err) : resolve(result)
            );
            stream.end(req.file.buffer);
        });

        res.json({ success: true, url: result.secure_url, public_id: result.public_id });
    } catch (err) {
        console.error("❌ Image upload error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// SIGNATURE UPLOAD
// ============================================================
router.post("/upload-signature", uploadDocumentImage.single("signature"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file" });

        // Only images
        if (!req.file.mimetype.startsWith("image/")) {
            return res.status(400).json({ success: false, message: "Only image files allowed" });
        }
        if (req.file.size > 3 * 1024 * 1024) {
            return res.status(400).json({ success: false, message: "Max 3 MB allowed" });
        }

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "school/documents/signatures", resource_type: "image" },
                (err, result) => err ? reject(err) : resolve(result)
            );
            stream.end(req.file.buffer);
        });

        res.json({ success: true, url: result.secure_url, public_id: result.public_id });
    } catch (err) {
        console.error("❌ Signature upload error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// HELPERS
// ============================================================
const BODY_FIELDS = [
    "docNumber", "docDate", "docType", "title", "titleStyle",
    "subject", "subjectStyle", "bodyHtml",
    "issuedByName", "issuedByDesignation",
    "signatureUrl", "signaturePublicId", "status"
];

const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

const pickBody = (b) => {
    const out = {};
    for (const k of BODY_FIELDS) {
        if (b[k] !== undefined && b[k] !== null) out[toSnake(k)] = b[k];
    }
    return out;
};

function fmtDateIN(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fetchImageBuffer(url, redirects = 0) {
    return new Promise((resolve) => {
        if (!url || redirects > 5) return resolve(null);
        try { new URL(url); } catch { return resolve(null); }
        const client = url.startsWith("https") ? https : http;
        const req = client.get(url, (resp) => {
            if ([301, 302, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                resp.resume();
                return resolve(fetchImageBuffer(resp.headers.location, redirects + 1));
            }
            if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
            const ct = resp.headers["content-type"] || "";
            if (!ct.startsWith("image/")) { resp.resume(); return resolve(null); }
            const chunks = [];
            let size = 0;
            resp.on("data", (c) => {
                size += c.length;
                if (size > 5 * 1024 * 1024) { req.destroy(); return resolve(null); }
                chunks.push(c);
            });
            resp.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", () => resolve(null));
        req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
}

// ============================================================
// HTML → RICH BLOCKS (better PDF conversion)
// Handles: headings, paragraphs, bold, italic, underline, lists, tables, images, alignment
// ============================================================
function parseHtmlToBlocks(html) {
    if (!html) return [];
    const blocks = [];

    // Remove scripts/styles
    let s = String(html).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

    // Split by block-level tags preserving them
    // Simple approach: regex-based block extraction
    const blockRegex = /<(h[1-6]|p|div|ul|ol|table|blockquote|pre)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    const matchedRanges = [];

    while ((match = blockRegex.exec(s)) !== null) {
        matchedRanges.push({ start: match.index, end: match.index + match[0].length, tag: match[1].toLowerCase(), content: match[2] });
    }

    // If no blocks matched, treat whole thing as one paragraph
    if (matchedRanges.length === 0) {
        const text = stripHtml(s);
        if (text.trim()) blocks.push({ type: "p", text });
        return blocks;
    }

    for (const m of matchedRanges) {
        if (m.tag.startsWith("h") && m.tag.length === 2) {
            const level = parseInt(m.tag[1]);
            const text = stripHtml(m.content).trim();
            if (text) blocks.push({ type: "heading", level, text });
        } else if (m.tag === "p" || m.tag === "div") {
            const text = stripHtml(m.content).trim();
            if (text) blocks.push({ type: "p", text });
        } else if (m.tag === "ul" || m.tag === "ol") {
            // Extract li items
            const items = [];
            const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
            let li;
            while ((li = liRegex.exec(m.content)) !== null) {
                const text = stripHtml(li[1]).trim();
                if (text) items.push(text);
            }
            if (items.length) blocks.push({ type: "list", ordered: m.tag === "ol", items });
        } else if (m.tag === "blockquote") {
            const text = stripHtml(m.content).trim();
            if (text) blocks.push({ type: "quote", text });
        } else if (m.tag === "table") {
            const rows = [];
            const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let tr;
            while ((tr = trRegex.exec(m.content)) !== null) {
                const cells = [];
                const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
                let cell;
                while ((cell = cellRegex.exec(tr[1])) !== null) {
                    cells.push({ text: stripHtml(cell[2]).trim(), isHeader: cell[1].toLowerCase() === "th" });
                }
                if (cells.length) rows.push(cells);
            }
            if (rows.length) blocks.push({ type: "table", rows });
        } else if (m.tag === "pre") {
            const text = stripHtml(m.content);
            if (text.trim()) blocks.push({ type: "code", text });
        }
    }

    // Handle standalone images (<img> not inside blocks)
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(s)) !== null) {
        blocks.push({ type: "image", src: imgMatch[1] });
    }

    return blocks;
}

function stripHtml(html) {
    return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        .trim();
}

// ============================================================
// SCHOOL CONFIG
// ============================================================
const SCHOOL = {
    name: "GOVT. SR. SEC. SCHOOL SHILLA",
    address: "Shilla, Teh. Nerwa, Distt. Shimla, Himachal Pradesh — 171210",
    logoUrl: "https://gsssshilla07.pages.dev/logo(1).png"
};

// ============================================================
// LIST
// ============================================================
router.get("/", async (req, res) => {
    try {
        const { search = "", type = "", status = "", sortBy = "created_at", order = "desc", page = 1, limit = 20 } = req.query;
        const allowedSort = ["created_at", "updated_at", "doc_date", "doc_number", "title", "doc_type"];
        const sortCol = allowedSort.includes(sortBy) ? sortBy : "created_at";
        const sortDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";

        const where = [];
        const params = [];

        if (type) { where.push("doc_type = ?"); params.push(type); }
        if (status) { where.push("status = ?"); params.push(status); }
        if (search) {
            where.push("(title LIKE ? OR doc_number LIKE ? OR subject LIKE ? OR issued_by_name LIKE ?)");
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const offset = (Number(page) - 1) * Number(limit);

        const rows = await q(
            `SELECT id, doc_number, doc_date, doc_type, title, subject, issued_by_name, issued_by_designation, status, signature_url, created_by, created_at, updated_at
             FROM school_documents ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );

        const countRows = await q(`SELECT COUNT(*) AS total FROM school_documents ${whereSql}`, params);
        const total = countRows[0]?.total || 0;

        const typeCounts = await q(`SELECT doc_type, COUNT(*) AS count FROM school_documents GROUP BY doc_type`);

        res.json({
            success: true, data: rows, typeCounts,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error("❌ List error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// STATS
// ============================================================
router.get("/stats", async (req, res) => {
    try {
        const [total] = await q("SELECT COUNT(*) AS c FROM school_documents");
        const [published] = await q("SELECT COUNT(*) AS c FROM school_documents WHERE status='Published'");
        const [drafts] = await q("SELECT COUNT(*) AS c FROM school_documents WHERE status='Draft'");
        const [thisMonth] = await q("SELECT COUNT(*) AS c FROM school_documents WHERE MONTH(doc_date)=MONTH(NOW()) AND YEAR(doc_date)=YEAR(NOW())");
        res.json({
            success: true,
            data: {
                total: total[0]?.c || 0,
                published: published[0]?.c || 0,
                drafts: drafts[0]?.c || 0,
                thisMonth: thisMonth[0]?.c || 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// NEXT DOC NUMBER
// ============================================================
router.get("/next-number/:type", async (req, res) => {
    try {
        const type = req.params.type.toUpperCase().replace(/\s+/g, "");
        const year = new Date().getFullYear();
        const prefix = `GSSS/${year}/${type}/`;

        const rows = await q(`SELECT doc_number FROM school_documents WHERE doc_number LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`]);

        let next = 1;
        if (rows.length) {
            const parts = rows[0].doc_number.split("/");
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num)) next = num + 1;
        }

        res.json({ success: true, docNumber: prefix + String(next).padStart(3, "0") });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// GET SINGLE
// ============================================================
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });
        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// CREATE
// ============================================================
router.post("/", async (req, res) => {
    try {
        const data = pickBody(req.body);
        if (!data.doc_number) return res.status(400).json({ success: false, message: "Document number required" });
        if (!data.doc_date) return res.status(400).json({ success: false, message: "Date required" });
        if (!data.doc_type) return res.status(400).json({ success: false, message: "Type required" });
        if (!data.title) return res.status(400).json({ success: false, message: "Title required" });
        if (!data.body_html) return res.status(400).json({ success: false, message: "Body required" });
        if (!data.status) data.status = "Draft";
        if (req.admin) data.created_by = req.admin.username || req.admin.name || "admin";

        const cols = Object.keys(data);
        const vals = Object.values(data);
        const ph = cols.map(() => "?").join(",");

        const result = await q(`INSERT INTO school_documents (${cols.join(",")}) VALUES (${ph})`, vals);
        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [result.insertId]);
        res.status(201).json({ success: true, message: "Document created ✅", data: rows[0] });
    } catch (err) {
        console.error("❌ Create error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// UPDATE
// ============================================================
router.put("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const existing = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!existing.length) return res.status(404).json({ success: false, message: "Not found" });

        const data = pickBody(req.body);
        const cols = Object.keys(data);
        if (!cols.length) return res.json({ success: true, message: "No changes", data: existing[0] });

        const setSql = cols.map(c => `${c} = ?`).join(", ");
        await q(`UPDATE school_documents SET ${setSql} WHERE id = ?`, [...Object.values(data), id]);

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        res.json({ success: true, message: "Updated ✅", data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// DELETE
// ============================================================
router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

        // Delete signature from cloudinary
        if (rows[0].signature_public_id) {
            try { await cloudinary.uploader.destroy(rows[0].signature_public_id); } catch (e) {}
        }

        await q("DELETE FROM school_documents WHERE id = ?", [id]);
        res.json({ success: true, message: "Deleted ✅" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// DUPLICATE
// ============================================================
router.post("/:id/duplicate", async (req, res) => {
    try {
        const id = req.params.id;
        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

        const src = rows[0];
        const newNumber = (src.doc_number || "DOC") + "-C" + Date.now().toString().slice(-4);

        const result = await q(
            `INSERT INTO school_documents (doc_number, doc_date, doc_type, title, title_style, subject, subject_style, body_html, issued_by_name, issued_by_designation, signature_url, signature_public_id, status, created_by)
             VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?)`,
            [newNumber, src.doc_type, "Copy of " + src.title, src.title_style, src.subject, src.subject_style, src.body_html, src.issued_by_name, src.issued_by_designation, src.signature_url, src.signature_public_id, req.admin?.username || "admin"]
        );

        const newRows = await q("SELECT * FROM school_documents WHERE id = ?", [result.insertId]);
        res.status(201).json({ success: true, message: "Duplicated ✅", data: newRows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// PDF GENERATION — Professional A4 Document
// ============================================================
router.get("/:id/pdf", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
        const d = rows[0];

        const [logoBuf, signatureBuf] = await Promise.all([
            fetchImageBuffer(SCHOOL.logoUrl),
            fetchImageBuffer(d.signature_url)
        ]);

        const doc = new PDFDocument({
            size: "A4",
            margins: { top: 38, bottom: 38, left: 42, right: 42 },
            info: {
                Title: d.title,
                Author: SCHOOL.name,
                Subject: d.subject || "",
                Creator: "GSSS Shilla Document System"
            }
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${(d.doc_number || "document").replace(/\//g, "-")}.pdf"`);
        doc.pipe(res);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const ML = 42;
        const MR = 42;
        const MT = 38;
        const MB = 38;
        const contentW = pageW - ML - MR;

        // ============================================================
        // SECURITY WATERMARK — Logo + Repeating Pattern
        // ============================================================
        function drawWatermark(pageNum) {
            doc.save();

            // Repeating pattern (diagonal stripes)
            doc.opacity(0.035);
            doc.lineWidth(0.5).strokeColor("#c9972b");
            for (let i = -pageH; i < pageW + pageH; i += 22) {
                doc.moveTo(i, 0).lineTo(i + pageH, pageH).stroke();
            }
            doc.opacity(1);
            doc.restore();

            // Center logo watermark
            if (logoBuf) {
                try {
                    doc.save();
                    doc.opacity(0.06);
                    const wmSize = 280;
                    doc.image(logoBuf, (pageW - wmSize) / 2, (pageH - wmSize) / 2, {
                        width: wmSize,
                        height: wmSize
                    });
                    doc.restore();
                } catch (e) {}
            }

            // Corner security codes
            doc.save();
            doc.opacity(0.14);
            doc.font("Helvetica").fontSize(6).fillColor("#0d1b2a");
            const code = `GSSS-${(d.id || "").toString().padStart(4, "0")}-${new Date().getFullYear()}`;
            doc.text(code, ML, pageH - 20, { width: contentW, align: "left" });
            doc.text(`PAGE ${pageNum}`, ML, pageH - 20, { width: contentW, align: "right" });
            doc.restore();
        }

        // ============================================================
        // HEADER — Official Letterhead
        // ============================================================
        function drawHeader() {
            const headerY = MT;
            const headerH = 92;

            // Logo (circle with gold border)
            const logoSize = 68;
            const logoX = ML;
            const logoY = headerY;

            if (logoBuf) {
                try {
                    doc.save();
                    doc.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 2).fill("#ffffff");
                    doc.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1).lineWidth(1.5).strokeColor("#c9972b").stroke();
                    doc.restore();
                    doc.image(logoBuf, logoX + 3, logoY + 3, {
                        fit: [logoSize - 6, logoSize - 6],
                        align: "center",
                        valign: "center"
                    });
                } catch (e) {}
            }

            // School name
            doc.font("Helvetica-Bold").fontSize(19).fillColor("#0d1b2a")
               .text(SCHOOL.name, ML + logoSize + 14, headerY + 4, {
                   width: contentW - logoSize - 14,
                   align: "center",
                   characterSpacing: 0.8
               });

            // Address line
            doc.font("Helvetica").fontSize(8.5).fillColor("#5a6a7e")
               .text(SCHOOL.address, ML + logoSize + 14, headerY + 30, {
                   width: contentW - logoSize - 14,
                   align: "center",
                   characterSpacing: 0.5
               });

            // Contact line
            doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
               .text("Affiliated to HPBOSE · Recognized by Govt. of Himachal Pradesh", ML + logoSize + 14, headerY + 46, {
                   width: contentW - logoSize - 14,
                   align: "center",
                   characterSpacing: 0.3
               });

            // Gold divider
            const divY = headerY + headerH;
            doc.moveTo(ML, divY).lineTo(pageW - MR, divY).lineWidth(3).strokeColor("#c9972b").stroke();
            doc.moveTo(ML, divY + 4).lineTo(pageW - MR, divY + 4).lineWidth(0.5).strokeColor("#0d1b2a").stroke();

            return divY + 8;
        }

        // ============================================================
        // META ROW — Doc No. / Date / Type Badge
        // ============================================================
        function drawMeta(y) {
            // Left: doc number
            doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a");
            doc.text(`Ref. No: ${d.doc_number || "-"}`, ML, y);

            // Right: date
            doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a");
            doc.text(`Date: ${fmtDateIN(d.doc_date)}`, ML, y, { width: contentW, align: "right" });

            y += 22;

            // Type badge (centered, pill shaped)
            const typeText = String(d.doc_type || "DOCUMENT").toUpperCase();
            doc.font("Helvetica-Bold").fontSize(11.5);
            const typeTextW = doc.widthOfString(typeText);
            const badgeW = typeTextW + 50;
            const badgeH = 24;
            const badgeX = (pageW - badgeW) / 2;

            // Gold badge
            doc.roundedRect(badgeX, y, badgeW, badgeH, 12).fillColor("#0d1b2a").fill();
            doc.roundedRect(badgeX, y, badgeW, badgeH, 12).lineWidth(1.5).strokeColor("#c9972b").stroke();

            doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#ffffff")
               .text(typeText, badgeX, y + 6, {
                   width: badgeW,
                   align: "center",
                   characterSpacing: 3
               });

            return y + badgeH + 12;
        }

        // ============================================================
        // TITLE
        // ============================================================
        function drawTitle(y) {
            if (!d.title) return y;
            doc.font("Helvetica-Bold").fontSize(14).fillColor("#0d1b2a")
               .text(d.title.toUpperCase(), ML, y, {
                   width: contentW,
                   align: "center",
                   characterSpacing: 1
               });
            return doc.y + 12;
        }

        // ============================================================
        // SUBJECT
        // ============================================================
        function drawSubject(y) {
            if (!d.subject) return y;

            doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0d1b2a")
               .text("Subject: ", ML, y, { continued: true });
            doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1a2332")
               .text(d.subject, { width: contentW });

            const lineY = doc.y + 5;
            doc.moveTo(ML, lineY).lineTo(pageW - MR, lineY).lineWidth(0.6).strokeColor("#c9972b").stroke();

            return lineY + 10;
        }

        // ============================================================
        // SIGNATURE BLOCK
        // ============================================================
        function drawSignature(forceY) {
            const sigW = 200;
            const sigX = pageW - MR - sigW;

            // If not enough space, don't draw here (will be on next page)
            const neededH = 90;
            if (forceY + neededH > pageH - 60) return null;

            let y = forceY + 30;

            // Signature image (bigger, cleaner)
            if (signatureBuf) {
                try {
                    doc.image(signatureBuf, sigX + 45, y - 10, {
                        fit: [110, 60],
                        align: "center"
                    });
                    y += 55;
                } catch (e) {
                    y += 20;
                }
            } else {
                y += 45;
            }

            // Signature line
            doc.moveTo(sigX + 20, y).lineTo(sigX + sigW - 20, y)
               .lineWidth(0.8).strokeColor("#64748b").stroke();

            // Name
            doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
               .text(d.issued_by_name || "Principal", sigX, y + 8, { width: sigW, align: "center" });

            // Designation
            doc.font("Helvetica").fontSize(9).fillColor("#475569")
               .text(d.issued_by_designation || "Govt. Sr. Sec. School Shilla", sigX, y + 24, { width: sigW, align: "center" });

            return y + 40;
        }

        // ============================================================
        // FOOTER
        // ============================================================
        function drawFooter(pageNum, totalPages) {
            const footerY = pageH - 32;

            // Security strip (subtle pattern)
            doc.save();
            doc.opacity(0.08);
            for (let i = 0; i < pageW; i += 10) {
                doc.rect(i, footerY - 2, 6, 0.5).fill("#c9972b");
            }
            doc.restore();

            doc.moveTo(ML, footerY).lineTo(pageW - MR, footerY).lineWidth(0.6).strokeColor("#c9972b").stroke();

            doc.font("Helvetica").fontSize(7).fillColor("#64748b");
            doc.text(
                `Official Document · ${SCHOOL.name}`,
                ML, footerY + 5,
                { width: contentW / 2, align: "left" }
            );

            doc.font("Helvetica").fontSize(7).fillColor("#64748b");
            doc.text(
                `Generated: ${new Date().toLocaleString("en-IN")}`,
                ML, footerY + 5,
                { width: contentW, align: "center" }
            );

            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0d1b2a");
            doc.text(
                `Page ${pageNum} of ${totalPages}`,
                ML, footerY + 5,
                { width: contentW, align: "right" }
            );
        }

        // ============================================================
        // RENDER PAGE 1
        // ============================================================
        drawWatermark(1);
        let y = drawHeader();
        y = drawMeta(y);
        y = drawTitle(y);
        y = drawSubject(y);

        // ============================================================
        // BODY CONTENT
        // ============================================================
        const blocks = parseHtmlToBlocks(d.body_html);
        const bottomLimit = pageH - MB - 110; // Reserve space for signature on last page
        let pageNum = 1;

        doc.font("Helvetica").fontSize(11).fillColor("#1a2332");
        const lineGap = 3.5;

        for (const block of blocks) {
            let blockHeight = 0;
            let newY = y;

            if (block.type === "heading") {
                const sizes = { 1: 16, 2: 14, 3: 13, 4: 12, 5: 11.5, 6: 11 };
                doc.font("Helvetica-Bold").fontSize(sizes[block.level] || 13).fillColor("#0d1b2a");
                blockHeight = doc.heightOfString(block.text, { width: contentW, lineGap }) + 6;
            } else if (block.type === "p") {
                doc.font("Helvetica").fontSize(11).fillColor("#1a2332");
                blockHeight = doc.heightOfString(block.text, { width: contentW, lineGap, align: "justify" }) + 8;
            } else if (block.type === "list") {
                doc.font("Helvetica").fontSize(11).fillColor("#1a2332");
                blockHeight = block.items.reduce((h, item) =>
                    h + doc.heightOfString("• " + item, { width: contentW - 15, lineGap }) + 4, 0) + 6;
            } else if (block.type === "table") {
                doc.font("Helvetica").fontSize(10);
                blockHeight = block.rows.length * 22 + 10;
            } else if (block.type === "quote") {
                doc.font("Helvetica-Oblique").fontSize(10.5).fillColor("#475569");
                blockHeight = doc.heightOfString(block.text, { width: contentW - 20, lineGap }) + 14;
            } else if (block.type === "image") {
                blockHeight = 180;
            } else if (block.type === "code") {
                doc.font("Courier").fontSize(9);
                blockHeight = doc.heightOfString(block.text, { width: contentW - 20, lineGap }) + 16;
            }

            // Page break check
            if (newY + blockHeight > bottomLimit) {
                drawFooter(pageNum, 99);
                doc.addPage();
                pageNum++;
                drawWatermark(pageNum);
                y = MT + 15;
                newY = y;
            }

            // Render block
            if (block.type === "heading") {
                const sizes = { 1: 16, 2: 14, 3: 13, 4: 12, 5: 11.5, 6: 11 };
                doc.font("Helvetica-Bold").fontSize(sizes[block.level] || 13).fillColor("#0d1b2a")
                   .text(block.text, ML, newY, { width: contentW, lineGap });
                y = doc.y + 6;

            } else if (block.type === "p") {
                doc.font("Helvetica").fontSize(11).fillColor("#1a2332")
                   .text(block.text, ML, newY, { width: contentW, lineGap, align: "justify" });
                y = doc.y + 8;

            } else if (block.type === "list") {
                let listY = newY;
                block.items.forEach((item, idx) => {
                    const bullet = block.ordered ? `${idx + 1}.` : "•";
                    doc.font("Helvetica").fontSize(11).fillColor("#1a2332")
                       .text(`${bullet}  ${item}`, ML + 10, listY, { width: contentW - 15, lineGap });
                    listY = doc.y + 4;
                });
                y = listY + 4;

            } else if (block.type === "table") {
                const tableY = newY;
                const colCount = Math.max(...block.rows.map(r => r.length));
                const colW = contentW / colCount;
                const rowH = 22;
                let tblY = tableY;

                block.rows.forEach((row, rIdx) => {
                    const isHeader = row.some(c => c.isHeader);
                    let cellX = ML;

                    row.forEach((cell) => {
                        if (isHeader) {
                            doc.rect(cellX, tblY, colW, rowH).fillColor("#fef8ed").fill();
                        }
                        doc.rect(cellX, tblY, colW, rowH).lineWidth(0.5).strokeColor("#94a3b8").stroke();
                        doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#1a2332")
                           .text(cell.text, cellX + 6, tblY + 6, { width: colW - 12, height: rowH - 8, ellipsis: true });
                        cellX += colW;
                    });
                    tblY += rowH;
                });
                y = tblY + 10;

            } else if (block.type === "quote") {
                doc.rect(ML, newY, 3, blockHeight - 6).fillColor("#c9972b").fill();
                doc.font("Helvetica-Oblique").fontSize(10.5).fillColor("#475569")
                   .text(block.text, ML + 15, newY + 6, { width: contentW - 20, lineGap });
                y = doc.y + 10;

            } else if (block.type === "code") {
                doc.rect(ML, newY, contentW, blockHeight - 4).fillColor("#f8fafc").fill();
                doc.rect(ML, newY, contentW, blockHeight - 4).lineWidth(0.5).strokeColor("#e2e8f0").stroke();
                doc.font("Courier").fontSize(9).fillColor("#1a2332")
                   .text(block.text, ML + 10, newY + 8, { width: contentW - 20, lineGap });
                y = doc.y + 10;

            } else if (block.type === "image") {
                const imgBuf = await fetchImageBuffer(block.src);
                if (imgBuf) {
                    try {
                        const maxW = Math.min(contentW, 380);
                        const maxH = 220;
                        doc.image(imgBuf, ML + (contentW - maxW) / 2, newY, {
                            fit: [maxW, maxH],
                            align: "center"
                        });
                        y = newY + maxH + 10;
                    } catch (e) {
                        y = newY + 10;
                    }
                } else {
                    y = newY + 10;
                }
            }
        }

        // ============================================================
        // SIGNATURE (last page, or new page if no space)
        // ============================================================
        const sigNeeded = 100;
        if (y + sigNeeded > pageH - 60) {
            drawFooter(pageNum, 99);
            doc.addPage();
            pageNum++;
            drawWatermark(pageNum);
            y = MT + 20;
        }

        drawSignature(y);

        // ============================================================
        // FOOTERS (all pages — need to redraw with correct total)
        // ============================================================
        const range = doc.bufferedPageRange();
        const totalPages = pageNum;

        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(range.start + i);
            drawFooter(i + 1, totalPages);
        }

        doc.end();
    } catch (err) {
        console.error("❌ PDF error:", err);
        if (!res.headersSent) res.status(500).json({ success: false, message: "PDF failed" });
    }
});

module.exports = router;
