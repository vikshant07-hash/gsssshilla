<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Results Manager - Admin | GSSS Shilla</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <style>
        :root {
            --bg: #f5f7fb; --bg-white: #ffffff; --text-primary: #1a2332; --text-secondary: #5a6a7e;
            --text-muted: #94a3b8; --gold: #c9972b; --gold-light: #e8b84b; --gold-bg: #fef8ed;
            --blue: #4a8af4; --blue-bg: #eef4ff; --green: #10b981; --green-bg: #ecfdf5;
            --purple: #8b5cf6; --purple-bg: #f5f0ff; --pink: #ec4899; --pink-bg: #fdf2f8;
            --orange: #f59e0b; --orange-bg: #fffbeb; --red: #ef4444; --border: #e8edf8;
            --shadow: 0 2px 12px rgba(0,0,0,0.04); --shadow-hover: 0 8px 30px rgba(0,0,0,0.08);
            --radius: 16px; --radius-sm: 10px; --transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text-primary); min-height: 100vh; display: flex; flex-direction: column; }

        .session-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); z-index: 9999; justify-content: center; align-items: center; }
        .session-overlay.active { display: flex; }
        .session-popup { background: var(--bg-white); border-radius: 24px; padding: 40px 32px; max-width: 440px; width: 92%; text-align: center; box-shadow: 0 25px 80px rgba(0,0,0,0.3); border: 1px solid rgba(201,151,43,0.15); }
        .session-popup .school-logo { width: 80px; height: 80px; border-radius: 20px; background: var(--gold-bg); margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--gold); }
        .session-popup .school-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 12px; }
        .icon-box { width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 36px; }
        .icon-box.expired, .icon-box.invalid { background: #fef2f2; color: var(--red); }
        .session-popup h2 { font-size: 26px; font-weight: 800; color: var(--text-primary); margin-bottom: 6px; }
        .session-popup h2 span { color: var(--gold); }
        .sub-text { font-size: 14px; color: var(--text-secondary); margin-bottom: 8px; }
        .session-timer { font-size: 13px; color: var(--text-muted); background: var(--bg); padding: 8px 16px; border-radius: 50px; display: inline-block; margin: 8px 0 20px; }
        .school-name-popup { font-size: 13px; font-weight: 600; color: var(--gold); margin-bottom: 20px; }
        .login-again-btn { display: inline-flex; align-items: center; gap: 12px; padding: 14px 40px; background: linear-gradient(135deg, var(--gold), var(--gold-light)); color: #fff; border: none; border-radius: 50px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: 'Inter', sans-serif; }
        .login-again-btn:hover { transform: translateY(-4px); }

        .navbar { background: var(--bg-white); border-bottom: 1px solid var(--border); padding: 0 32px; height: 68px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; box-shadow: var(--shadow); }
        .navbar .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
        .navbar .brand .logo-placeholder { width: 42px; height: 42px; border-radius: var(--radius-sm); background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .navbar .brand .logo-placeholder img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
        .navbar .brand .name { font-size: 16px; font-weight: 700; color: var(--text-primary); } 
        .navbar .brand .name span { color: var(--gold); }
        .nav-links { display: flex; gap: 8px; list-style: none; } 
        .nav-links a { text-decoration: none; color: var(--text-secondary); padding: 8px 16px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; transition: var(--transition); } 
        .nav-links a:hover { background: var(--bg); color: var(--text-primary); } 
        .nav-links a.active { background: var(--gold-bg); color: var(--gold); }
        .nav-links a i { margin-right: 6px; }
        .nav-right { display: flex; align-items: center; gap: 12px; } 
        .admin-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 10px; background: var(--bg); border-radius: 50px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
        .avatar { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--gold), var(--gold-light)); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; }
        .online-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
        .hamburger { display: none; background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-primary); }

        .main-container { flex: 1; max-width: 1400px; margin: 0 auto; padding: 24px 32px 40px; width: 100%; }
        .page-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; padding: 20px 28px; background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
        .page-header h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px; } 
        .page-header h1 i { color: var(--gold); }
        .header-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border: none; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; transition: var(--transition); text-decoration: none; font-family: 'Inter', sans-serif; }
        .btn-primary { background: var(--gold); color: #fff; } 
        .btn-primary:hover { background: var(--gold-light); transform: translateY(-2px); }
        .btn-success { background: var(--green); color: #fff; } 
        .btn-success:hover { background: #059669; transform: translateY(-2px); }
        .btn-danger { background: var(--red); color: #fff; } 
        .btn-danger:hover { background: #dc2626; transform: translateY(-2px); }
        .btn-outline { background: var(--bg); color: var(--text-secondary); border: 1px solid var(--border); } 
        .btn-outline:hover { background: var(--border); }
        .btn-sm { padding: 6px 14px; font-size: 12px; border-radius: 8px; }
        .btn-xs { padding: 4px 10px; font-size: 11px; border-radius: 6px; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }

        .tabs { display: flex; gap: 4px; margin-bottom: 24px; background: var(--bg-white); padding: 6px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: var(--shadow); flex-wrap: wrap; }
        .tab-btn { padding: 10px 24px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; font-size: 13px; color: var(--text-secondary); transition: var(--transition); font-family: 'Inter', sans-serif; } 
        .tab-btn:hover { background: var(--bg); } 
        .tab-btn.active { background: var(--gold); color: #fff; }
        .tab-btn i { margin-right: 6px; }
        .tab-content { display: none; } 
        .tab-content.active { display: block; }

        .search-section { background: var(--bg-white); padding: 24px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 20px; box-shadow: var(--shadow); }
        .search-section h3 { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; } 
        .search-section h3 i { color: var(--gold); margin-right: 6px; }
        .search-section p { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }
        .search-row { display: flex; gap: 10px; flex-wrap: wrap; }
        .search-input { flex: 1; min-width: 250px; padding: 12px 16px; border: 2px solid var(--border); border-radius: var(--radius-sm); font-size: 14px; font-family: 'Inter', sans-serif; background: var(--bg); transition: var(--transition); }
        .search-input:focus { outline: none; border-color: var(--gold); background: var(--bg-white); }

        .class-nav { background: var(--bg-white); padding: 20px 24px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 20px; box-shadow: var(--shadow); }
        .class-nav h3 { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; } 
        .class-nav h3 i { color: var(--gold); margin-right: 6px; }
        .class-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
        .class-btn { padding: 8px 20px; border: 2px solid var(--border); background: var(--bg-white); border-radius: 50px; cursor: pointer; font-weight: 600; font-size: 13px; color: var(--text-secondary); transition: var(--transition); font-family: 'Inter', sans-serif; } 
        .class-btn:hover { border-color: var(--gold); color: var(--gold); } 
        .class-btn.active { background: var(--gold); color: #fff; border-color: var(--gold); }
        .class-stats { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 12px; font-size: 13px; color: var(--text-secondary); align-items: center; } 
        .class-stats strong { color: var(--text-primary); }

        .student-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; margin-top: 16px; }
        .student-card { background: var(--bg-white); border-radius: var(--radius); border: 1px solid var(--border); overflow: hidden; cursor: pointer; transition: var(--transition); box-shadow: var(--shadow); } 
        .student-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-hover); border-color: var(--gold); }
        .card-header { padding: 16px 20px 12px; display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border); }
        .student-name { font-size: 16px; font-weight: 700; color: var(--text-primary); } 
        .student-id { font-size: 12px; color: var(--text-muted); }
        .status-badge { font-size: 11px; padding: 3px 12px; border-radius: 50px; font-weight: 600; white-space: nowrap; } 
        .uploaded { background: var(--green-bg); color: var(--green); } 
        .pending { background: var(--orange-bg); color: var(--orange); }
        .card-body { padding: 12px 20px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; } 
        .detail { font-size: 13px; color: var(--text-secondary); } 
        .detail label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; display: block; font-weight: 600; } 
        .detail span { font-weight: 500; color: var(--text-primary); }
        .card-footer { padding: 10px 20px 14px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; } 
        .exam-tag { font-size: 10px; padding: 2px 10px; border-radius: 12px; background: var(--bg); color: var(--text-secondary); }
        .action-btns { display: flex; gap: 6px; flex-wrap: wrap; } 
        .action-btn { padding: 4px 12px; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: var(--transition); font-family: 'Inter', sans-serif; display: inline-flex; align-items: center; gap: 4px; } 
        .action-btn:hover { transform: scale(1.05); } 
        .edit { background: var(--orange-bg); color: var(--orange); } 
        .delete { background: #fee2e2; color: var(--red); } 
        .print { background: var(--pink-bg); color: var(--pink); } 
        .view { background: var(--purple-bg); color: var(--purple); }

        .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); justify-content: center; align-items: center; z-index: 1000; padding: 20px; } 
        .modal-overlay.active { display: flex; }
        .modal-content { background: var(--bg-white); padding: 30px; border-radius: var(--radius); max-width: 700px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
        .modal-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--border); padding-bottom: 14px; margin-bottom: 18px; } 
        .modal-header h2 { font-size: 18px; font-weight: 700; color: var(--text-primary); } 
        .modal-header h2 i { color: var(--gold); margin-right: 8px; } 
        .close-btn { background: none; border: none; font-size: 24px; color: var(--text-muted); cursor: pointer; transition: var(--transition); } 
        .close-btn:hover { color: var(--red); transform: rotate(90deg); }
        .student-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; padding: 8px 0 16px; border-bottom: 1px solid var(--border); margin-bottom: 16px; } 
        .item label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.3px; display: block; } 
        .item span { font-weight: 600; color: var(--text-primary); }
        .exam-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg); border-radius: var(--radius-sm); margin-bottom: 8px; border: 1px solid var(--border); transition: var(--transition); } 
        .exam-item:hover { border-color: var(--gold); }
        .exam-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } 
        .exam-name { font-weight: 600; font-size: 13px; color: var(--text-primary); } 
        .exam-session { font-size: 12px; color: var(--text-muted); }
        .badge { display: inline-block; padding: 3px 12px; border-radius: 50px; font-size: 11px; font-weight: 600; } 
        .badge-success { background: var(--green-bg); color: var(--green); } 
        .badge-warning { background: var(--orange-bg); color: var(--orange); } 
        .badge-info { background: var(--blue-bg); color: var(--blue); }

        .toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; } 
        .toast { padding: 14px 24px; border-radius: var(--radius-sm); color: #fff; font-weight: 600; font-size: 13px; box-shadow: 0 8px 30px rgba(0,0,0,0.15); min-width: 250px; animation: slideIn 0.3s ease; } 
        .toast-success { background: var(--green); } 
        .toast-error { background: var(--red); } 
        .toast-warning { background: var(--orange); } 
        .toast-info { background: var(--text-primary); }
        @keyframes slideIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }

        .alert-box { padding: 14px 18px; border-radius: var(--radius-sm); margin: 12px 0; } 
        .alert-box.error { background: #fee2e2; color: var(--red); border: 1px solid #fecaca; } 
        .alert-box.success { background: var(--green-bg); color: var(--green); border: 1px solid #bbf7d0; } 
        .alert-box.info { background: var(--blue-bg); color: var(--blue); border: 1px solid #bfdbfe; }
        .loading { text-align: center; padding: 40px; color: var(--text-muted); }

        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
        .form-group input, .form-group select { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 14px; font-family: 'Inter', sans-serif; background: var(--bg); }
        .form-group input:disabled { background: #f1f5f9; color: var(--text-muted); cursor: not-allowed; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }

        .table-wrap { overflow-x: auto; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .data-table thead tr { background: var(--bg); }
        .data-table th { padding: 10px 14px; text-align: left; font-weight: 600; color: var(--text-secondary); border-bottom: 2px solid var(--border); }
        .data-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); }
        .data-table tbody tr:hover { background: var(--bg); }

        .footer { background: var(--bg-white); border-top: 1px solid var(--border); padding: 20px 32px; text-align: center; font-size: 13px; color: var(--text-muted); }

        @media (max-width: 768px) { 
            .navbar { padding: 0 20px; } 
            .nav-links { display: none; flex-direction: column; position: absolute; top: 68px; left: 0; right: 0; background: var(--bg-white); padding: 16px; border-bottom: 1px solid var(--border); } 
            .nav-links.open { display: flex; } 
            .hamburger { display: block; } 
            .main-container { padding: 16px; } 
            .page-header { padding: 16px; flex-direction: column; align-items: stretch; } 
            .student-grid { grid-template-columns: 1fr; } 
            .student-detail-grid { grid-template-columns: 1fr; }
            .class-stats { flex-direction: column; align-items: flex-start; gap: 8px; }
        }
    </style>
</head>
<body>

<div class="session-overlay" id="sessionOverlay">
    <div class="session-popup">
        <div class="school-logo"><img src="logo(1).png" alt="GSSS SHILLA Logo"></div>
        <div class="school-name-popup"><i class="fas fa-school"></i> Govt. Sr. Sec. School Shilla</div>
        <div class="icon-box expired" id="popupIconBox"><i class="fas fa-clock" id="popupIcon"></i></div>
        <h2 id="popupTitle">Session <span>Expired</span></h2>
        <p class="sub-text" id="popupSubText">Your session has been expired due to inactivity.<br>Please login again to continue.</p>
        <div class="session-timer"><i class="fas fa-shield-alt"></i> <span id="popupStatusText">Secure session ended</span></div>
        <button class="login-again-btn" onclick="redirectToLogin()"><i class="fas fa-sign-in-alt"></i> <span id="popupBtnText">Login Again</span></button>
    </div>
</div>

<nav class="navbar">
    <a href="#" class="brand">
        <div class="logo-placeholder"><img src="logo(1).png" alt="Logo"></div>
        <div class="name">GSSS<span> SHILLA</span></div>
    </a>
    <ul class="nav-links" id="navLinks">
        <li><a href="admin-dashboard.html"><i class="fas fa-tachometer-alt"></i> Dashboard</a></li>
        <li><a href="admin-students.html"><i class="fas fa-users"></i> Students</a></li>
        <li><a href="admin-result.html" class="active"><i class="fas fa-graduation-cap"></i> Results</a></li>
    </ul>
    <div class="nav-right">
        <div class="admin-badge">
            <span class="avatar" id="adminAvatar">🛡️</span>
            <span id="adminName">Admin</span>
            <span class="online-dot"></span>
        </div>
        <button class="hamburger" onclick="toggleNav()"><i class="fas fa-bars"></i></button>
    </div>
</nav>

<div class="main-container">
    <div class="page-header">
        <h1><i class="fas fa-graduation-cap"></i> Result Management</h1>
        <div class="header-actions">
            <button class="btn btn-primary" onclick="refreshAll()"><i class="fas fa-sync-alt"></i> Refresh</button>
            <a href="admin-students.html" class="btn btn-outline"><i class="fas fa-users"></i> Manage Students</a>
        </div>
    </div>

    <div class="tabs">
        <button class="tab-btn active" data-tab="search" onclick="switchTab('search')"><i class="fas fa-search"></i> Search Student</button>
        <button class="tab-btn" data-tab="classwise" onclick="switchTab('classwise')"><i class="fas fa-users"></i> Class-wise</button>
        <button class="tab-btn" data-tab="upload" onclick="switchTab('upload')"><i class="fas fa-upload"></i> Upload Marksheet</button>
        <button class="tab-btn" data-tab="publish" onclick="switchTab('publish')"><i class="fas fa-check-circle"></i> Publish</button>
    </div>

    <!-- TAB 1: SEARCH STUDENT -->
    <div id="tab-search" class="tab-content active">
        <div class="search-section">
            <h3><i class="fas fa-user-graduate"></i> Student Result Search</h3>
            <p>Student ID daalo aur uski saari marksheets dekho. Student details Nstudent table se fetch hoti hain.</p>
            <div class="search-row">
                <input type="text" class="search-input" id="searchStudentId" placeholder="Enter Student ID (e.g. GSSS2025001)" onkeypress="if(event.key==='Enter') searchStudent()">
                <button class="btn btn-primary" onclick="searchStudent()"><i class="fas fa-search"></i> Search</button>
                <button class="btn btn-outline" onclick="clearSearch()"><i class="fas fa-times"></i> Clear</button>
            </div>
        </div>
        <div id="searchResultArea"></div>
    </div>

    <!-- TAB 2: CLASS-WISE -->
    <div id="tab-classwise" class="tab-content">
        <div class="class-nav">
            <h3><i class="fas fa-school"></i> Select Class</h3>
            <div class="class-buttons" id="classButtons">
                <button class="class-btn" data-class="6" onclick="selectClass(6)">Class 6</button>
                <button class="class-btn" data-class="7" onclick="selectClass(7)">Class 7</button>
                <button class="class-btn" data-class="8" onclick="selectClass(8)">Class 8</button>
                <button class="class-btn" data-class="9" onclick="selectClass(9)">Class 9</button>
                <button class="class-btn active" data-class="10" onclick="selectClass(10)">Class 10</button>
                <button class="class-btn" data-class="11" onclick="selectClass(11)">Class 11</button>
                <button class="class-btn" data-class="12" onclick="selectClass(12)">Class 12</button>
            </div>
            <div class="class-stats">
                <span>👨‍🎓 Students: <strong id="classStudentCount">-</strong></span>
                <span>📄 Marksheets: <strong id="classMarksheetCount">-</strong></span>
                <span>✅ Published: <strong id="classPublishedCount">-</strong></span>
                <select id="sortSelect" class="btn btn-outline" style="padding:6px 14px;font-size:12px;margin-left:auto;cursor:pointer;" onchange="applySort()">
                    <option value="name_asc">Name A-Z</option>
                    <option value="name_desc">Name Z-A</option>
                    <option value="roll_asc">Roll No ↑</option>
                    <option value="roll_desc">Roll No ↓</option>
                    <option value="id_asc">Student ID ↑</option>
                    <option value="id_desc">Student ID ↓</option>
                </select>
            </div>
        </div>
        <div id="studentGridContainer"><div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading students...</div></div>
        <div id="pagination" style="display:flex;justify-content:center;gap:6px;margin-top:20px;"></div>
    </div>

    <!-- TAB 3: UPLOAD -->
    <div id="tab-upload" class="tab-content">
        <div class="class-nav">
            <h3><i class="fas fa-upload"></i> Upload Marksheet PDF</h3>
            <div class="alert-box info" style="margin-bottom:16px;">
                <i class="fas fa-info-circle"></i> Student ID daalo → Fetch karo → Marksheet PDF upload karo.
                Student add karne ke liye <a href="admin-students.html" style="color:var(--gold);font-weight:600;">Student Management</a> me jao.
            </div>
            <form id="uploadForm" enctype="multipart/form-data">
                <div class="form-grid">
                    <div class="form-group">
                        <label>Student ID *</label>
                        <input type="text" id="upStudentId" placeholder="Enter Student ID" required>
                    </div>
                    <div class="form-group">
                        <label>Student Name</label>
                        <input type="text" id="upName" disabled placeholder="Auto-fill hoga">
                    </div>
                    <div class="form-group">
                        <label>Session</label>
                        <input type="text" id="upSession" disabled placeholder="Auto-fill hoga">
                    </div>
                    <div class="form-group">
                        <label>Class</label>
                        <input type="text" id="upClass" disabled placeholder="Auto-fill hoga">
                    </div>
                    <div class="form-group">
                        <label>Exam Type *</label>
                        <select id="upExamType">
                            <option>Annual Examination</option>
                            <option>Half Yearly Examination</option>
                            <option>Pre Board</option>
                            <option>Board Examination</option>
                            <option>Final Examination</option>
                            <option>Monthly Test</option>
                            <option>Unit Test</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Exam Session *</label>
                        <input type="month" id="upExamSession" required>
                    </div>
                    <div class="form-group">
                        <label>Obtained Marks</label>
                        <input type="text" id="upObtainedMarks" placeholder="e.g. 407">
                    </div>
                    <div class="form-group">
                        <label>Max Marks</label>
                        <input type="text" id="upMaxMarks" placeholder="e.g. 500">
                    </div>
                    <div class="form-group" style="grid-column:1/-1;">
                        <label>PDF File * (Max 10MB)</label>
                        <input type="file" id="upPdf" accept=".pdf" required>
                    </div>
                </div>
                <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-primary" onclick="fetchStudentForUpload()"><i class="fas fa-search"></i> Fetch Student</button>
                    <button type="submit" class="btn btn-success" id="uploadBtn"><i class="fas fa-upload"></i> Upload Marksheet</button>
                </div>
            </form>
            <div id="uploadStatus" class="alert-box info" style="margin-top:12px;">
                <i class="fas fa-info-circle"></i> Enter Student ID and click Fetch
            </div>
        </div>
    </div>

    <!-- TAB 4: PUBLISH -->
    <div id="tab-publish" class="tab-content">
        <div class="class-nav">
            <h3><i class="fas fa-check-circle"></i> Publish Results</h3>
            <div class="class-buttons" id="publishClassButtons">
                <button class="class-btn" data-class="6" onclick="selectPublishClass(6)">Class 6</button>
                <button class="class-btn" data-class="7" onclick="selectPublishClass(7)">Class 7</button>
                <button class="class-btn" data-class="8" onclick="selectPublishClass(8)">Class 8</button>
                <button class="class-btn" data-class="9" onclick="selectPublishClass(9)">Class 9</button>
                <button class="class-btn active" data-class="10" onclick="selectPublishClass(10)">Class 10</button>
                <button class="class-btn" data-class="11" onclick="selectPublishClass(11)">Class 11</button>
                <button class="class-btn" data-class="12" onclick="selectPublishClass(12)">Class 12</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin:16px 0;align-items:center;">
                <select id="publishExamFilter" style="width:auto;min-width:200px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:'Inter',sans-serif;background:var(--bg);" onchange="loadPublishableStudents(publishClass)">
                    <option value="">All Exams</option>
                    <option>Annual Examination</option>
                    <option>Half Yearly Examination</option>
                    <option>Pre Board</option>
                    <option>Board Examination</option>
                    <option>Final Examination</option>
                    <option>Monthly Test</option>
                    <option>Unit Test</option>
                </select>
                <label style="font-weight:600;font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
                    Declaration Date *
                    <input type="date" id="publishDate" style="padding:8px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:'Inter',sans-serif;background:var(--bg);" required>
                </label>
                <button class="btn btn-success" onclick="bulkPublish()" style="margin-left:auto;"><i class="fas fa-check-double"></i> Bulk Publish</button>
            </div>
            <div class="table-wrap">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:40px;"><input type="checkbox" id="selectAllPublish" onchange="toggleAllPublish()"></th>
                            <th>Student ID</th>
                            <th>Name</th>
                            <th>Exam Type</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="publishTableBody">
                        <tr><td colspan="6" class="loading">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>

<div class="modal-overlay" id="studentModal">
    <div class="modal-content">
        <div class="modal-header">
            <h2 id="modalStudentName"><i class="fas fa-user-graduate"></i> Student Details</h2>
            <button class="close-btn" onclick="closeModal('studentModal')">&times;</button>
        </div>
        <div id="modalStudentContent"><div class="loading">Loading...</div></div>
    </div>
</div>

<div class="toast-container" id="toastContainer"></div>

<footer class="footer">
    <div>&copy; 2026 Govt. Sr. Sec. School Shilla. All rights reserved.</div>
</footer>

<script>
// ============================================================
// CONFIG
// ============================================================
const API_BASE = window.location.hostname === "localhost"
    ? "http://localhost:5000/api/admin/results"
    : "https://gsssshilla.onrender.com/api/admin/results";

const VERIFY_API = window.location.hostname === "localhost"
    ? "http://localhost:5000/api/admin/verify"
    : "https://gsssshilla.onrender.com/api/admin/verify";

const PAGE_SIZE = 20;

// ============================================================
// STATE
// ============================================================
let currentClass = 10;
let currentPage = 1;
let publishClass = 10;
let sortField = "name";
let sortOrder = "asc";
let currentStudentsCache = [];

// ============================================================
// AUTH
// ============================================================
function getAuthHeaders() {
    try {
        const token = localStorage.getItem("adminToken");
        if (!token) { showPopup("invalid"); return null; }
        return { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
    } catch (e) { showPopup("invalid"); return null; }
}

async function checkAuth() {
    let token = null;
    try { token = localStorage.getItem("adminToken"); } catch (e) {}
    if (!token) { showPopup("invalid"); return false; }

    try {
        const res = await fetch(VERIFY_API, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.success) {
            if (data.admin?.username) {
                document.getElementById("adminAvatar").textContent = data.admin.username.charAt(0).toUpperCase();
                document.getElementById("adminName").textContent = data.admin.username;
            }
            return true;
        }
        showPopup("expired");
        return false;
    } catch (err) {
        showPopup("expired");
        return false;
    }
}

function showPopup(type = "expired") {
    const overlay = document.getElementById("sessionOverlay");
    document.getElementById("popupIconBox").className = "icon-box " + (type === "invalid" ? "invalid" : "expired");
    document.getElementById("popupIcon").className = type === "invalid" ? "fas fa-lock" : "fas fa-clock";
    document.getElementById("popupTitle").innerHTML = type === "invalid" ? 'Invalid <span>Access</span>' : 'Session <span>Expired</span>';
    document.getElementById("popupSubText").innerHTML = type === "invalid"
        ? "You are not authorized to access this page.<br>Please login with valid credentials."
        : "Your session has been expired due to inactivity.<br>Please login again to continue.";
    document.getElementById("popupStatusText").textContent = type === "invalid" ? "Access denied" : "Secure session ended";
    document.getElementById("popupBtnText").textContent = type === "invalid" ? "Go to Login" : "Login Again";
    overlay.classList.add("active");
    try { localStorage.removeItem("adminToken"); } catch (e) {}
}

function redirectToLogin() {
    document.getElementById("sessionOverlay").classList.remove("active");
    window.location.replace("login.html");
}

// ============================================================
// HELPERS
// ============================================================
function esc(v) {
    return v === null || v === undefined ? "" : String(v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    return isNaN(d) ? "-" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMonth(v) {
    if (!v) return "-";
    const parts = v.split("-");
    if (parts.length !== 2) return v;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[parseInt(parts[1]) - 1] + " " + parts[0];
}

function showToast(msg, type = "info") {
    const c = document.getElementById("toastContainer");
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 400); }, 4000);
}

async function apiCall(url, options = {}) {
    const headers = getAuthHeaders();
    if (!headers) throw new Error("Not authenticated");

    let res;
    try {
        res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    } catch (e) {
        throw new Error("Network error. Check connection.");
    }

    if (res.status === 401) {
        showPopup("expired");
        throw new Error("Session expired");
    }

    let data;
    try { data = await res.json(); } catch (e) { throw new Error(`Server error ${res.status}`); }
    if (!res.ok) throw new Error(data.message || `Request failed ${res.status}`);
    return data;
}

function toggleNav() { document.getElementById("navLinks").classList.toggle("open"); }
function openModal(id) { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }
document.addEventListener("click", (e) => { if (e.target.classList.contains("modal-overlay")) closeModal(e.target.id); });

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tab) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");
    document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add("active");

    if (tab === "classwise") loadStudents(currentClass);
    if (tab === "publish") loadPublishableStudents(publishClass);
}

// ============================================================
// SEARCH STUDENT
// ============================================================
async function searchStudent() {
    const studentId = document.getElementById("searchStudentId").value.trim();
    if (!studentId) return showToast("Enter Student ID", "warning");

    const area = document.getElementById("searchResultArea");
    area.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Fetching student...</div>';

    try {
        const data = await apiCall(`${API_BASE}/students/${encodeURIComponent(studentId)}`);
        renderStudentSearchResult(data.data.student, data.data.marksheets);
    } catch (e) {
        if (e.message !== "Session expired") {
            area.innerHTML = `<div class="alert-box error"><i class="fas fa-exclamation-circle"></i> ${esc(e.message)}</div>`;
        }
    }
}

function clearSearch() {
    document.getElementById("searchStudentId").value = "";
    document.getElementById("searchResultArea").innerHTML = "";
}

function renderStudentSearchResult(student, marksheets) {
    const area = document.getElementById("searchResultArea");
    const photo = student.photo || "";

    let totalObtained = 0, totalMax = 0;
    marksheets.forEach(m => {
        totalObtained += parseInt(m.obtained_marks) || 0;
        totalMax += parseInt(m.max_marks) || 0;
    });
    const percentage = totalMax > 0 ? ((totalObtained / totalMax) * 100).toFixed(2) + "%" : "-";

    const marksheetsHtml = marksheets.length === 0
        ? `<div class="alert-box info"><i class="fas fa-info-circle"></i> No marksheets uploaded yet.</div>`
        : marksheets.map(m => `
            <div class="exam-item">
                <div class="exam-info">
                    <span class="exam-name">${esc(m.exam_type)}</span>
                    <span class="exam-session"><i class="far fa-calendar-alt"></i> ${formatMonth(m.exam_session)}</span>
                    <span class="exam-session"><i class="fas fa-star"></i> ${esc(m.obtained_marks || "-")}/${esc(m.max_marks || "-")}</span>
                    <span class="badge ${m.is_published ? "badge-success" : "badge-warning"}">
                        ${m.is_published ? "✅ Published" : "⏳ Unpublished"}
                    </span>
                </div>
                <div class="action-btns">
                    <button class="action-btn view" onclick="viewMarksheet(${m.id})"><i class="fas fa-eye"></i></button>
                    <button class="action-btn print" onclick="printSingleMarksheet(${m.id})"><i class="fas fa-print"></i></button>
                    <button class="action-btn delete" onclick="deleteMarksheet(${m.id}, '${esc(student.student_id)}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join("");

    area.innerHTML = `
        <div class="student-card" style="cursor:default;">
            <div class="card-header">
                <div style="display:flex;gap:12px;align-items:center;">
                    ${photo ? `<img src="${esc(photo)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);" onerror="this.style.display='none'">` : ''}
                    <div>
                        <div class="student-name">${esc(student.name)}</div>
                        <div class="student-id">ID: ${esc(student.student_id)}</div>
                    </div>
                </div>
                <span class="status-badge ${marksheets.length ? "uploaded" : "pending"}">
                    ${marksheets.length ? "✅ " + marksheets.length + " Marksheet(s)" : "⏳ No Marksheets"}
                </span>
            </div>
            <div class="student-detail-grid" style="padding:16px 20px;">
                <div class="item"><label>Father's Name</label><span>${esc(student.father_name || "-")}</span></div>
                <div class="item"><label>Mother's Name</label><span>${esc(student.mother_name || "-")}</span></div>
                <div class="item"><label>Class</label><span>${esc(student.class || "-")}</span></div>
                <div class="item"><label>Roll No</label><span>${esc(student.roll_number || "-")}</span></div>
                <div class="item"><label>Session</label><span>${esc(student.session || "-")}</span></div>
                <div class="item"><label>DOB</label><span>${student.dob ? formatDate(student.dob) : "-"}</span></div>
                <div class="item"><label>APAAR ID</label><span>${esc(student.apaar_id || "-")}</span></div>
                <div class="item"><label>Status</label><span>${esc(student.status || "-")}</span></div>
            </div>
        </div>

        <div class="class-nav" style="margin-top:20px;">
            <h3><i class="fas fa-file-pdf"></i> Marksheets (${marksheets.length})</h3>
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px;gap:8px;">
                <button class="btn btn-sm btn-primary" onclick="printFullMarksheet('${esc(student.student_id)}')">
                    <i class="fas fa-print"></i> Print Full Marksheet
                </button>
            </div>
            ${marksheetsHtml}
        </div>

        <div class="class-nav" style="margin-top:20px;">
            <h3><i class="fas fa-chart-line"></i> Summary</h3>
            <div class="class-stats">
                <span>📊 Total Obtained: <strong>${totalObtained}</strong></span>
                <span>📈 Max Marks: <strong>${totalMax}</strong></span>
                <span>🎯 Percentage: <strong>${percentage}</strong></span>
            </div>
        </div>
    `;
}

// ============================================================
// CLASS-WISE
// ============================================================
function selectClass(c) {
    currentClass = c;
    currentPage = 1;
    document.querySelectorAll("#classButtons .class-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`#classButtons .class-btn[data-class="${c}"]`).classList.add("active");
    loadStudents(c);
}

async function loadStudents(classNum, page = 1) {
    currentPage = page;
    const container = document.getElementById("studentGridContainer");
    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
        const data = await apiCall(`${API_BASE}/class/${classNum}/students?page=${page}&limit=${PAGE_SIZE}`);
        let students = data.data || [];
        currentStudentsCache = students;
        students = sortStudents(students);
        renderStudentCards(students);
        renderPagination(data.pagination, (p) => loadStudents(classNum, p));

        document.getElementById("classStudentCount").textContent = data.pagination?.total ?? students.length;
        document.getElementById("classMarksheetCount").textContent = students.reduce((s, x) => s + (Number(x.marksheet_count) || 0), 0);
        document.getElementById("classPublishedCount").textContent = students.reduce((s, x) => s + (Number(x.published_count) || 0), 0);
    } catch (e) {
        if (e.message !== "Session expired") {
            container.innerHTML = `<div class="alert-box error">${esc(e.message)} <button onclick="loadStudents(${classNum},${page})" class="btn btn-sm btn-outline">Retry</button></div>`;
        }
    }
}

function sortStudents(students) {
    return [...students].sort((a, b) => {
        let valA, valB;
        if (sortField === "roll") {
            valA = parseInt(a.exam_roll_no) || 0;
            valB = parseInt(b.exam_roll_no) || 0;
        } else if (sortField === "name") {
            valA = (a.name || "").toLowerCase();
            valB = (b.name || "").toLowerCase();
        } else {
            valA = (a.student_id || "").toUpperCase();
            valB = (b.student_id || "").toUpperCase();
        }
        if (sortOrder === "asc") return valA > valB ? 1 : valA < valB ? -1 : 0;
        return valA < valB ? 1 : valA > valB ? -1 : 0;
    });
}

function applySort() {
    const v = document.getElementById("sortSelect").value;
    const map = {
        name_asc: ["name", "asc"], name_desc: ["name", "desc"],
        roll_asc: ["roll", "asc"], roll_desc: ["roll", "desc"],
        id_asc: ["student_id", "asc"], id_desc: ["student_id", "desc"]
    };
    [sortField, sortOrder] = map[v] || ["name", "asc"];
    renderStudentCards(sortStudents(currentStudentsCache));
}

function renderStudentCards(students) {
    const container = document.getElementById("studentGridContainer");
    if (!students || students.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--text-muted);">
                <i class="fas fa-users" style="font-size:40px;"></i>
                <p style="margin-top:12px;">No students found</p>
                <p style="font-size:12px;margin-top:8px;">Add students from <a href="admin-students.html" style="color:var(--gold);font-weight:600;">Student Management</a></p>
            </div>`;
        return;
    }

    container.innerHTML = students.map(s => {
        const has = (Number(s.marksheet_count) || 0) > 0;
        const photo = s.photo || "";
        return `
            <div class="student-card" onclick="openStudentDetail('${esc(s.student_id)}')">
                <div class="card-header">
                    <div style="display:flex;gap:12px;align-items:center;">
                        ${photo ? `<img src="${esc(photo)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);" onerror="this.style.display='none'">` : ''}
                        <div>
                            <div class="student-name">${esc(s.name)}</div>
                            <div class="student-id">ID: ${esc(s.student_id)}</div>
                        </div>
                    </div>
                    <span class="status-badge ${has ? "uploaded" : "pending"}">${has ? "✅ " + s.marksheet_count : "⏳ Pending"}</span>
                </div>
                <div class="card-body">
                    <div class="detail"><label>Roll No</label><span>${esc(s.exam_roll_no || "-")}</span></div>
                    <div class="detail"><label>Session</label><span>${esc(s.session || "-")}</span></div>
                    <div class="detail"><label>Father</label><span>${esc(s.father_name || "-")}</span></div>
                    <div class="detail"><label>Class</label><span>${esc(s.class || "-")}</span></div>
                </div>
                <div class="card-footer">
                    <span class="exam-tag">${s.marksheet_count || 0} marksheet(s)</span>
                    <div class="action-btns">
                        <button class="action-btn view" onclick="event.stopPropagation();openStudentDetail('${esc(s.student_id)}')">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function renderPagination(pagination, onPage) {
    const container = document.getElementById("pagination");
    if (!pagination || pagination.totalPages <= 1) { container.innerHTML = ""; return; }
    const { page, totalPages } = pagination;

    let html = `<button ${page <= 1 ? "disabled" : ""} onclick="window._onPage(${page - 1})" class="btn btn-sm btn-outline"><i class="fas fa-chevron-left"></i></button>`;
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
        html += `<button onclick="window._onPage(${i})" class="btn btn-sm" style="background:${i === page ? "var(--gold)" : "var(--bg-white)"};color:${i === page ? "#fff" : "var(--text-secondary)"};border:1px solid var(--border);">${i}</button>`;
    }
    html += `<button ${page >= totalPages ? "disabled" : ""} onclick="window._onPage(${page + 1})" class="btn btn-sm btn-outline"><i class="fas fa-chevron-right"></i></button>`;
    container.innerHTML = html;
    window._onPage = onPage;
}

// ============================================================
// STUDENT DETAIL MODAL
// ============================================================
async function openStudentDetail(studentId) {
    const modalContent = document.getElementById("modalStudentContent");
    modalContent.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
    openModal("studentModal");
    document.getElementById("studentModal").dataset.studentId = studentId;

    try {
        const data = await apiCall(`${API_BASE}/students/${encodeURIComponent(studentId)}`);
        renderStudentDetail(data.data);
    } catch (error) {
        modalContent.innerHTML = `<div class="alert-box error">${esc(error.message)}</div>`;
    }
}

function renderStudentDetail(data) {
    const s = data.student;
    const marksheets = data.marksheets || [];
    document.getElementById("modalStudentName").innerHTML = `<i class="fas fa-user-graduate"></i> ${esc(s.name)}`;

    const marksheetHtml = marksheets.length === 0
        ? `<div class="alert-box info">No marksheets uploaded yet.</div>`
        : marksheets.map(m => `
            <div class="exam-item">
                <div class="exam-info">
                    <span class="exam-name">${esc(m.exam_type)}</span>
                    <span class="exam-session"><i class="far fa-calendar-alt"></i> ${formatMonth(m.exam_session)}</span>
                    <span class="exam-session"><i class="fas fa-star"></i> ${esc(m.obtained_marks || "-")}/${esc(m.max_marks || "-")}</span>
                    <span class="badge ${m.is_published ? "badge-success" : "badge-warning"}">${m.is_published ? "Published" : "Unpublished"}</span>
                </div>
                <div class="action-btns">
                    <button class="action-btn view" onclick="viewMarksheet(${m.id})"><i class="fas fa-eye"></i></button>
                    <button class="action-btn delete" onclick="deleteMarksheet(${m.id}, '${esc(s.student_id)}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join("");

    document.getElementById("modalStudentContent").innerHTML = `
        <div class="student-detail-grid">
            <div class="item"><label>Student ID</label><span>${esc(s.student_id)}</span></div>
            <div class="item"><label>APAAR ID</label><span>${esc(s.apaar_id || "-")}</span></div>
            <div class="item"><label>Father's Name</label><span>${esc(s.father_name || "-")}</span></div>
            <div class="item"><label>Mother's Name</label><span>${esc(s.mother_name || "-")}</span></div>
            <div class="item"><label>Date of Birth</label><span>${s.dob ? formatDate(s.dob) : "-"}</span></div>
            <div class="item"><label>Session</label><span>${esc(s.session || "-")}</span></div>
            <div class="item"><label>Class</label><span>${esc(s.class || "-")}</span></div>
            <div class="item"><label>Roll No</label><span>${esc(s.roll_number || "-")}</span></div>
        </div>
        <h4 style="font-size:14px;color:var(--text-secondary);margin-bottom:10px;">
            <i class="fas fa-file-pdf"></i> Marksheets (${marksheets.length})
        </h4>
        ${marksheetHtml}
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" onclick="printFullMarksheet('${esc(s.student_id)}')">
                <i class="fas fa-print"></i> Print Marksheet
            </button>
            <button class="btn btn-sm btn-outline" onclick="closeModal('studentModal')">
                <i class="fas fa-times"></i> Close
            </button>
        </div>
    `;
}

// ============================================================
// VIEW / DELETE MARKSHEET
// ============================================================
async function viewMarksheet(id) {
    try {
        const data = await apiCall(`${API_BASE}/marksheets/${id}`);
        if (data.success && data.data.cloudinary_url) {
            window.open(data.data.cloudinary_url, "_blank");
        } else {
            showToast("URL not found", "error");
        }
    } catch (e) {
        showToast("Failed to open: " + e.message, "error");
    }
}

async function deleteMarksheet(id, studentId) {
    if (!confirm("Delete this marksheet? Ye action undo nahi hoga.")) return;
    try {
        await apiCall(`${API_BASE}/marksheets/${id}`, { method: "DELETE" });
        showToast("Marksheet deleted ✅", "success");
        if (document.getElementById("studentModal").classList.contains("active")) openStudentDetail(studentId);
        if (document.getElementById("searchStudentId").value.trim() === studentId) searchStudent();
        if (document.getElementById("tab-classwise").classList.contains("active")) loadStudents(currentClass);
    } catch (e) {
        showToast(e.message, "error");
    }
}

// ============================================================
// UPLOAD
// ============================================================
async function fetchStudentForUpload() {
    const id = document.getElementById("upStudentId").value.trim();
    if (!id) return showToast("Enter Student ID", "warning");

    const statusBox = document.getElementById("uploadStatus");
    statusBox.className = "alert-box info";
    statusBox.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';

    try {
        const data = await apiCall(`${API_BASE}/students/${encodeURIComponent(id)}`);
        const s = data.data.student;
        document.getElementById("upName").value = s.name;
        document.getElementById("upSession").value = s.session || "";
        document.getElementById("upClass").value = s.class || "";
        statusBox.className = "alert-box success";
        statusBox.innerHTML = `<i class="fas fa-check-circle"></i> Student found: <strong>${esc(s.name)}</strong> (${esc(s.class)})`;
    } catch (e) {
        statusBox.className = "alert-box error";
        statusBox.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${esc(e.message)} — Add student first from <a href="admin-students.html" style="color:#fff;text-decoration:underline;">Student Management</a>`;
        document.getElementById("upName").value = "";
        document.getElementById("upSession").value = "";
        document.getElementById("upClass").value = "";
    }
}

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const studentId = document.getElementById("upStudentId").value.trim();
    const pdf = document.getElementById("upPdf").files[0];
    const examSession = document.getElementById("upExamSession").value;
    const obtainedMarks = document.getElementById("upObtainedMarks").value.trim();
    const maxMarks = document.getElementById("upMaxMarks").value.trim();

    if (!studentId || !pdf || !examSession) return showToast("Student ID, Exam Session and PDF required", "warning");
    if (pdf.size > 10 * 1024 * 1024) return showToast("PDF under 10MB", "warning");

    const session = document.getElementById("upSession").value;
    const classVal = document.getElementById("upClass").value;
    if (!session || !classVal) return showToast("First fetch student", "warning");

    const formData = new FormData();
    formData.append("student_id", studentId);
    formData.append("session", session);
    formData.append("class", classVal);
    formData.append("exam_type", document.getElementById("upExamType").value);
    formData.append("exam_session", examSession);
    formData.append("obtained_marks", obtainedMarks);
    formData.append("max_marks", maxMarks);
    formData.append("pdf", pdf);

    const btn = document.getElementById("uploadBtn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

    try {
        const token = localStorage.getItem("adminToken");
        const res = await fetch(`${API_BASE}/marksheets/upload`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData
        });

        if (res.status === 401) { showPopup("expired"); return; }

        const result = await res.json();
        if (!result.success) throw new Error(result.message);

        showToast("Marksheet uploaded ✅ (Unpublished)", "success");
        document.getElementById("uploadForm").reset();
        document.getElementById("upName").value = "";
        document.getElementById("upSession").value = "";
        document.getElementById("upClass").value = "";
        const statusBox = document.getElementById("uploadStatus");
        statusBox.className = "alert-box info";
        statusBox.innerHTML = '<i class="fas fa-info-circle"></i> Enter Student ID and click Fetch';
        setDefaultExamSession();
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-upload"></i> Upload Marksheet';
    }
});

// ============================================================
// PUBLISH
// ============================================================
function selectPublishClass(c) {
    publishClass = c;
    document.querySelectorAll("#publishClassButtons .class-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`#publishClassButtons .class-btn[data-class="${c}"]`).classList.add("active");
    loadPublishableStudents(c);
}

async function loadPublishableStudents(classNum) {
    const tbody = document.getElementById("publishTableBody");
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading...</td></tr>';

    try {
        const examFilter = document.getElementById("publishExamFilter").value;
        let url = `${API_BASE}/marksheets?limit=200&class=${classNum}`;
        if (examFilter) url += `&exam_type=${encodeURIComponent(examFilter)}`;

        const data = await apiCall(url);
        if (!data.data || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No marksheets found</td></tr>';
            return;
        }

        tbody.innerHTML = data.data.map(m => `
            <tr>
                <td><input type="checkbox" class="publish-checkbox" data-id="${m.id}" ${m.is_published ? "disabled" : ""}></td>
                <td>${esc(m.student_id)}</td>
                <td>${esc(m.name)}</td>
                <td>${esc(m.exam_type)}</td>
                <td>
                    <span class="badge ${m.is_published ? "badge-success" : "badge-warning"}">
                        ${m.is_published ? "✅ Published" : "⏳ Unpublished"}
                    </span>
                </td>
                <td>
                    <button class="btn btn-xs btn-success" onclick="publishSingle(${m.id})" ${m.is_published ? "disabled" : ""}>
                        <i class="fas fa-check"></i> Publish
                    </button>
                    <button class="btn btn-xs btn-danger" onclick="unpublishSingle(${m.id})" ${!m.is_published ? "disabled" : ""}>
                        <i class="fas fa-times"></i> Unpublish
                    </button>
                </td>
            </tr>
        `).join("");
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--red);">${esc(e.message)}</td></tr>`;
    }
}

function toggleAllPublish() {
    const checked = document.getElementById("selectAllPublish").checked;
    document.querySelectorAll(".publish-checkbox:not(:disabled)").forEach(cb => cb.checked = checked);
}

async function publishSingle(id) {
    const date = document.getElementById("publishDate").value;
    if (!date) return showToast("Select declaration date", "warning");
    try {
        await apiCall(`${API_BASE}/marksheets/${id}/publish`, {
            method: "POST",
            body: JSON.stringify({ declaration_date: date })
        });
        showToast("Published ✅", "success");
        loadPublishableStudents(publishClass);
    } catch (e) { showToast(e.message, "error"); }
}

async function unpublishSingle(id) {
    try {
        await apiCall(`${API_BASE}/marksheets/${id}/unpublish`, { method: "POST" });
        showToast("Unpublished", "success");
        loadPublishableStudents(publishClass);
    } catch (e) { showToast(e.message, "error"); }
}

async function bulkPublish() {
    const date = document.getElementById("publishDate").value;
    if (!date) return showToast("Select declaration date", "warning");

    const selected = [...document.querySelectorAll(".publish-checkbox:checked")].map(cb => cb.dataset.id);
    if (selected.length === 0) return showToast("Select at least one marksheet", "warning");

    try {
        const res = await apiCall(`${API_BASE}/marksheets/bulk-publish`, {
            method: "POST",
            body: JSON.stringify({ ids: selected, declaration_date: date })
        });
        showToast(res.message || "Bulk published ✅", "success");
        document.getElementById("selectAllPublish").checked = false;
        loadPublishableStudents(publishClass);
    } catch (e) { showToast(e.message, "error"); }
}

// ============================================================
// PRINT — PROFESSIONAL A4 MARKSHEET
// ============================================================
async function printFullMarksheet(studentId) {
    try {
        const data = await apiCall(`${API_BASE}/students/${encodeURIComponent(studentId)}`);
        const s = data.data.student;
        const marksheets = data.data.marksheets || [];

        let totalObtained = 0, totalMax = 0;
        marksheets.forEach(m => {
            totalObtained += parseInt(m.obtained_marks) || 0;
            totalMax += parseInt(m.max_marks) || 0;
        });
        const percentage = totalMax > 0 ? ((totalObtained / totalMax) * 100).toFixed(2) : "0.00";
        const grade = getGrade(percentage);
        const result = percentage >= 33 ? "PASS" : "FAIL";
        const resultColor = result === "PASS" ? "#16a34a" : "#dc2626";

        const studentPhoto = s.photo || "";
        const printDate = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

        // Marksheet rows
        let marksheetRows = "";
        marksheets.forEach((m, i) => {
            marksheetRows += `
                <tr>
                    <td style="text-align:center;">${i + 1}</td>
                    <td style="font-weight:600;">${esc(m.exam_type)}</td>
                    <td style="text-align:center;">${formatMonth(m.exam_session)}</td>
                    <td style="text-align:center;font-weight:700;color:#0d1b2a;">${esc(m.obtained_marks || "—")}</td>
                    <td style="text-align:center;font-weight:700;color:#0d1b2a;">${esc(m.max_marks || "—")}</td>
                    <td style="text-align:center;font-weight:700;color:#c9972b;">${calculatePercent(m.obtained_marks, m.max_marks)}</td>
                </tr>
            `;
        });

        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Marksheet - ${esc(s.name)}</title>
<style>
@page { size: A4 portrait; margin: 10mm 12mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a2332; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* Watermark */
.watermark {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    display: flex; align-items: center; justify-content: center;
}
.watermark-text {
    font-size: 120px; font-weight: 900; color: rgba(201,151,43,0.06);
    letter-spacing: 20px; text-transform: uppercase;
    transform: rotate(-35deg); user-select: none;
    font-family: 'Georgia', serif;
}
.watermark-pattern {
    position: absolute; inset: 0;
    background-image: repeating-linear-gradient(45deg, transparent, transparent 60px, rgba(201,151,43,0.03) 60px, rgba(201,151,43,0.03) 62px);
}

.page-container { position: relative; z-index: 1; max-width: 100%; }

/* Header */
.header { text-align: center; padding-bottom: 14px; border-bottom: 3px double #c9972b; margin-bottom: 16px; position: relative; }
.header::after {
    content: ''; position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
    width: 60px; height: 3px; background: #c9972b; border-radius: 3px;
}
.school-logo { width: 70px; height: 70px; border-radius: 50%; border: 3px solid #c9972b; padding: 4px; background: #fff; margin: 0 auto 8px; display: block; }
.school-name { font-family: 'Georgia', serif; font-size: 22px; font-weight: 900; color: #0d1b2a; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
.school-address { font-size: 10px; color: #5a6a7e; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px; }
.school-affiliation { font-size: 9px; color: #94a3b8; letter-spacing: 1px; margin-bottom: 8px; }
.title-badge {
    display: inline-block; background: linear-gradient(135deg, #0d1b2a, #1b3a5c); color: #fff;
    padding: 6px 30px; border-radius: 30px; font-size: 13px; font-weight: 800;
    letter-spacing: 3px; text-transform: uppercase; border: 2px solid #c9972b;
    box-shadow: 0 4px 12px rgba(13,27,42,0.15);
}

/* Student Info */
.info-table { width: 100%; border-collapse: collapse; margin: 16px 0; border: 2px solid #0d1b2a; border-radius: 8px; overflow: hidden; }
.info-table td { padding: 9px 12px; border: 1px solid #cbd5e1; font-size: 11px; vertical-align: middle; }
.info-table .label { background: linear-gradient(135deg, #fef8ed, #fdf2e0); font-weight: 700; color: #0d1b2a; width: 15%; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; }
.info-table .value { font-weight: 600; color: #1a2332; width: 35%; }
.info-table .value.highlight { color: #c9972b; font-weight: 800; font-size: 12px; }

.photo-cell { width: 90px; text-align: center; vertical-align: middle; background: #fef8ed; }
.photo-box { width: 75px; height: 90px; border: 3px solid #c9972b; border-radius: 8px; overflow: hidden; background: #fff; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 8px rgba(0,0,0,0.1); }
.photo-box img { width: 100%; height: 100%; object-fit: cover; }
.photo-placeholder { font-size: 32px; color: #cbd5e1; }

/* Section Heading */
.section-title {
    font-size: 12px; font-weight: 800; color: #0d1b2a; text-transform: uppercase;
    letter-spacing: 2px; margin: 18px 0 10px; padding: 8px 14px;
    background: linear-gradient(90deg, #fef8ed, transparent);
    border-left: 4px solid #c9972b; border-radius: 4px;
    display: flex; align-items: center; gap: 8px;
}

/* Marks Table */
.marks-table { width: 100%; border-collapse: collapse; margin: 8px 0; border: 2px solid #0d1b2a; border-radius: 8px; overflow: hidden; }
.marks-table th {
    background: linear-gradient(135deg, #0d1b2a, #1b3a5c); color: #fff; padding: 10px 12px;
    border: 1px solid #0d1b2a; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; font-weight: 700; text-align: center;
}
.marks-table td { padding: 10px 12px; border: 1px solid #cbd5e1; font-size: 11px; }
.marks-table tbody tr:nth-child(even) { background: #fafbfc; }
.marks-table tbody tr:hover { background: #fef8ed; }
.marks-table tfoot td { background: #fef8ed; font-weight: 800; padding: 12px; border-top: 2px solid #c9972b; }

/* Summary Cards */
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
.summary-card {
    border: 2px solid #c9972b; border-radius: 10px; padding: 14px 10px;
    background: linear-gradient(135deg, #fef8ed, #fdf2e0); text-align: center;
    box-shadow: 0 3px 10px rgba(201,151,43,0.1);
}
.summary-card .label { font-size: 9px; text-transform: uppercase; color: #5a6a7e; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px; }
.summary-card .value { font-size: 22px; font-weight: 900; color: #0d1b2a; font-family: 'Georgia', serif; }
.summary-card .value.gold { color: #c9972b; }
.summary-card .value.pass { color: #16a34a; }
.summary-card .value.fail { color: #dc2626; }
.summary-card .sub { font-size: 9px; color: #94a3b8; margin-top: 3px; }

/* Declaration */
.declaration {
    background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
    border: 2px solid #0284c7; border-radius: 10px;
    padding: 12px 18px; margin: 16px 0; font-size: 11px;
    line-height: 1.7; color: #0c4a6e; position: relative;
}
.declaration::before {
    content: '📋'; position: absolute; top: -12px; left: 18px;
    background: #fff; padding: 0 8px; font-size: 18px;
}
.declaration strong { color: #075985; }

/* Signatures */
.signature-area {
    display: flex; justify-content: space-between; align-items: flex-end;
    margin-top: 40px; padding-top: 20px; border-top: 2px dashed #cbd5e1;
}
.signature-box { text-align: center; font-size: 10px; min-width: 160px; }
.signature-line { width: 140px; border-bottom: 2px solid #0d1b2a; margin: 0 auto 6px; height: 30px; }
.signature-name { font-weight: 800; color: #0d1b2a; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
.signature-title { font-size: 9px; color: #64748b; letter-spacing: 0.5px; }

/* Footer */
.footer-note {
    margin-top: 20px; padding: 10px 14px; background: #f8fafc;
    border-radius: 6px; border-left: 4px solid #c9972b;
    font-size: 9px; color: #64748b; line-height: 1.6;
}
.footer-meta {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 14px; padding-top: 10px; border-top: 2px solid #c9972b;
    font-size: 9px; color: #64748b; letter-spacing: 0.5px;
}
.footer-meta .print-id { font-family: 'Courier New', monospace; font-weight: 700; color: #0d1b2a; }
.footer-meta .verified { color: #16a34a; font-weight: 700; }

/* QR Box */
.qr-box {
    position: absolute; top: 16px; right: 16px;
    text-align: center; padding: 6px;
    border: 2px solid #c9972b; border-radius: 8px;
    background: #fff; box-shadow: 0 3px 10px rgba(0,0,0,0.08);
}
.qr-box .qr-label { font-size: 7px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-top: 3px; letter-spacing: 0.5px; }

@media print {
    body { background: white !important; }
    .page-container { page-break-inside: avoid; }
    .watermark { display: flex !important; }
}
</style></head>
<body>
<div class="watermark">
    <div class="watermark-pattern"></div>
    <div class="watermark-text">GSSS SHILLA</div>
</div>

<div class="page-container">

    <!-- HEADER -->
    <div class="header">
        <img src="logo(1).png" class="school-logo" onerror="this.style.display='none'">
        <div class="school-name">Govt. Sr. Sec. School Shilla</div>
        <div class="school-address">Shilla • Teh. Nerwa • Distt. Shimla • Himachal Pradesh — 171210</div>
        <div class="school-affiliation">Affiliated to HPBOSE • Recognized by Govt. of Himachal Pradesh</div>
        <div class="title-badge">📜 Official Marksheet</div>
    </div>

    <!-- STUDENT INFO -->
    <table class="info-table">
        <tr>
            <td class="label">Student ID</td>
            <td class="value highlight">${esc(s.student_id)}</td>
            <td class="label">Admission No</td>
            <td class="value">${esc(s.admission_number || "—")}</td>
            <td class="photo-cell" rowspan="5">
                <div class="photo-box">
                    ${studentPhoto
                        ? `<img src="${esc(studentPhoto)}" onerror="this.parentElement.innerHTML='<div class=&quot;photo-placeholder&quot;>👤</div>'">`
                        : '<div class="photo-placeholder">👤</div>'}
                </div>
            </td>
        </tr>
        <tr>
            <td class="label">Student Name</td>
            <td class="value" style="font-size:13px;font-weight:800;">${esc(s.name)}</td>
            <td class="label">Father's Name</td>
            <td class="value">${esc(s.father_name || "—")}</td>
        </tr>
        <tr>
            <td class="label">Mother's Name</td>
            <td class="value">${esc(s.mother_name || "—")}</td>
            <td class="label">Date of Birth</td>
            <td class="value">${s.dob ? new Date(s.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—"}</td>
        </tr>
        <tr>
            <td class="label">Class</td>
            <td class="value highlight">${esc(s.class || "—")}${s.stream ? " · " + esc(s.stream) : ""}</td>
            <td class="label">Section</td>
            <td class="value">${esc(s.section || "—")}</td>
        </tr>
        <tr>
            <td class="label">Roll Number</td>
            <td class="value">${esc(s.roll_number || "—")}</td>
            <td class="label">Academic Session</td>
            <td class="value highlight">${esc(s.session || "—")}</td>
        </tr>
    </table>

    <!-- MARKSHEETS -->
    <div class="section-title">📊 Examination Performance Details</div>
    <table class="marks-table">
        <thead>
            <tr>
                <th style="width:40px;">#</th>
                <th>Examination Type</th>
                <th style="width:110px;">Exam Session</th>
                <th style="width:90px;">Obtained</th>
                <th style="width:90px;">Maximum</th>
                <th style="width:90px;">Percentage</th>
            </tr>
        </thead>
        <tbody>
            ${marksheetRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;font-style:italic;">No examination records available</td></tr>'}
        </tbody>
        ${marksheets.length > 0 ? `
        <tfoot>
            <tr>
                <td colspan="3" style="text-align:right;">GRAND TOTAL →</td>
                <td style="text-align:center;color:#c9972b;font-size:14px;">${totalObtained}</td>
                <td style="text-align:center;color:#c9972b;font-size:14px;">${totalMax}</td>
                <td style="text-align:center;color:#c9972b;font-size:14px;">${percentage}%</td>
            </tr>
        </tfoot>` : ""}
    </table>

    <!-- SUMMARY -->
    <div class="summary-grid">
        <div class="summary-card">
            <div class="label">Total Obtained</div>
            <div class="value gold">${totalObtained}</div>
            <div class="sub">Out of ${totalMax}</div>
        </div>
        <div class="summary-card">
            <div class="label">Overall Percentage</div>
            <div class="value gold">${percentage}%</div>
            <div class="sub">Aggregate</div>
        </div>
        <div class="summary-card">
            <div class="label">Grade</div>
            <div class="value">${grade}</div>
            <div class="sub">Based on %</div>
        </div>
        <div class="summary-card">
            <div class="label">Final Result</div>
            <div class="value ${result === "PASS" ? "pass" : "fail"}">${result}</div>
            <div class="sub">Declared</div>
        </div>
    </div>

    <!-- DECLARATION -->
    <div class="declaration">
        <strong>DECLARATION:</strong> This is to certify that <strong>${esc(s.name)}</strong> 
        (Student ID: <strong>${esc(s.student_id)}</strong>), son/daughter of 
        <strong>${esc(s.father_name || "—")}</strong>, has appeared in the examinations mentioned above 
        for the academic session <strong>${esc(s.session || "—")}</strong> and is declared 
        <strong style="color:${resultColor};">${result}</strong>. 
        This marksheet is generated by the school's official digital portal.
    </div>

    <!-- SIGNATURES -->
    <div class="signature-area">
        <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-name">Class Teacher</div>
            <div class="signature-title">Verified By</div>
        </div>
        <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-name">Principal</div>
            <div class="signature-title">Govt. Sr. Sec. School Shilla</div>
        </div>
    </div>

    <!-- FOOTER NOTE -->
    <div class="footer-note">
        <strong>Note:</strong> This is a computer-generated document. Original marksheets can be collected from the school office.
        Any discrepancy in this document should be reported to the school within 7 days.
        This document is valid only when accompanied by the school's official seal.
    </div>

    <!-- META -->
    <div class="footer-meta">
        <span>📅 Print Date: <strong>${printDate}</strong></span>
        <span>🆔 Document ID: <span class="print-id">GSSS-${esc(s.student_id)}-${Date.now().toString(36).toUpperCase()}</span></span>
        <span class="verified">✅ Digitally Verified</span>
    </div>

</div>

<script>
window.onload = function() {
    setTimeout(function() {
        window.print();
        // window.close(); // uncomment agar auto close chahiye
    }, 800);
};
</script>
</body></html>`;

        const pw = window.open("", "_blank", "width=1000,height=800");
        pw.document.write(html);
        pw.document.close();
    } catch (e) {
        showToast(e.message, "error");
    }
}

function printSingleMarksheet(id) {
    // Same function reuse — full marksheet print
    const sid = document.getElementById("studentModal").dataset.studentId;
    if (sid) printFullMarksheet(sid);
}

function calculatePercent(obtained, max) {
    const o = parseInt(obtained) || 0;
    const m = parseInt(max) || 0;
    if (m === 0) return "—";
    return ((o / m) * 100).toFixed(2) + "%";
}

function getGrade(percentage) {
    const p = parseFloat(percentage) || 0;
    if (p >= 90) return "A+";
    if (p >= 80) return "A";
    if (p >= 70) return "B+";
    if (p >= 60) return "B";
    if (p >= 50) return "C";
    if (p >= 40) return "D";
    if (p >= 33) return "E";
    return "F";
}

// ============================================================
// REFRESH
// ============================================================
function refreshAll() {
    const activeTab = document.querySelector(".tab-content.active").id;
    if (activeTab === "tab-classwise") loadStudents(currentClass);
    if (activeTab === "tab-publish") loadPublishableStudents(publishClass);
    if (activeTab === "tab-search") {
        const sid = document.getElementById("searchStudentId").value.trim();
        if (sid) searchStudent();
    }
    showToast("Refreshed ✅", "info");
}

function setDefaultExamSession() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const el = document.getElementById("upExamSession");
    if (el) el.value = `${year}-${month}`;
}

function setDefaultPublishDate() {
    const el = document.getElementById("publishDate");
    if (el) el.value = new Date().toISOString().split("T")[0];
}

// ============================================================
// INIT
// ============================================================
window.addEventListener("DOMContentLoaded", async () => {
    setDefaultExamSession();
    setDefaultPublishDate();

    const ok = await checkAuth();
    if (ok) {
        loadStudents(currentClass);
        loadPublishableStudents(publishClass);
    }
});
</script>
</body>
</html>
