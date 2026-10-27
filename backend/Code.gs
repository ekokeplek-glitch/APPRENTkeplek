/**
 * RyokoRent Apps Script Gateway (Multi-Device Sync Architecture)
 * 
 * Single Source of Truth: Google Sheets (RyokoRent Data Operasional)
 * Architecture Reference: docs/SYNC_ARCHITECTURE.md (REV-10 / TASK-030)
 *
 * Sheets Schema (9 sheets):
 * 1. Booking          - Data reservasi 13 field standar, status, kurir, keuangan, versi
 * 2. Unit             - Master armada fisik, status unit, lokasi terakhir
 * 3. Tracking         - Riwayat pergerakan & posisi armada (kurir/pool)
 * 4. Servis           - Catatan servis rutin 7 kategori, odometer, biaya, bengkel
 * 5. Log              - Catatan operasional harian & insiden lapangan
 * 6. Users            - Akun pengguna, peran (admin/operator), hash PIN bersalt
 * 7. Penerima_Telegram - Daftar penerima alert Telegram pribadi (kurir & operator)
 * 8. Audit            - Jejak audit append-only dengan kunci idempotensi
 * 9. Alert_Log        - Riwayat notifikasi Telegram terkirim (mencegah duplikat)
 */

// ==========================================
// 1. KONFIGURASI & KONSTANTA
// ==========================================

const APP_VERSION = '2.0.0-multi-device';
const BUFFER_MINUTES = 60; // Buffer 60 menit antar sewa untuk inspeksi & cuci unit
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 jam masa aktif token sesi

const SHEETS = {
  BOOKING: 'Booking',
  UNIT: 'Unit',
  TRACKING: 'Tracking',
  SERVIS: 'Servis',
  LOG: 'Log',
  USERS: 'Users',
  PENERIMA_TELEGRAM: 'Penerima_Telegram',
  AUDIT: 'Audit',
  ALERT_LOG: 'Alert_Log'
};

const SHEET_HEADERS = {
  [SHEETS.BOOKING]: [
    'noBooking', 'waktuPemesanan', 'statusSewa', 'namaPenyewa', 'nomorWa',
    'noDarurat', 'alamatKtp', 'jenisIdPendukung', 'alamatSaatIni', 'idSosmed',
    'modelMotor', 'kodeUnitFisik', 'jumlahHelm', 'durasiSewa', 'jadwalMulai',
    'jadwalSelesai', 'lokasiAntar', 'lokasiJemput', 'kurirPengantar',
    'totalEstimasiBiaya', 'dendaKeterlambatan', 'catatanKhusus',
    'statusReviewAdmin', 'opsiTindakLanjut', 'aksiTerakhirDisetujui',
    'createdAt', 'updatedAt', 'serverVersion'
  ],
  [SHEETS.UNIT]: [
    'id', 'kodeUnit', 'modelId', 'namaModel', 'platNomor',
    'status', 'tahun', 'warna', 'lokasiTerakhir', 'updatedAt', 'serverVersion'
  ],
  [SHEETS.TRACKING]: [
    'id', 'unitId', 'kodeUnit', 'lokasi', 'latitude',
    'longitude', 'namaKurir', 'catatan', 'waktu'
  ],
  [SHEETS.SERVIS]: [
    'id', 'unitId', 'kodeUnit', 'kategoriServis', 'biaya',
    'odometer', 'bengkel', 'catatan', 'tanggal', 'status', 'waktu'
  ],
  [SHEETS.LOG]: [
    'id', 'tanggal', 'waktu', 'kategori', 'judul',
    'deskripsi', 'prioritas', 'namaPelapor', 'diselesaikan'
  ],
  [SHEETS.USERS]: [
    'id', 'username', 'pinHash', 'salt', 'role',
    'nama', 'aktif', 'terakhirLogin'
  ],
  [SHEETS.PENERIMA_TELEGRAM]: [
    'id', 'chatId', 'role', 'nama', 'nomorWa',
    'aktif', 'dibuatPada'
  ],
  [SHEETS.AUDIT]: [
    'id', 'timestamp', 'actorId', 'actorRole', 'action',
    'entity', 'entityId', 'idempotencyKey', 'status', 'details'
  ],
  [SHEETS.ALERT_LOG]: [
    'id', 'bookingId', 'tingkatAlert', 'waktuKirim', 'chatIdPenerima',
    'statusKirim', 'pesan'
  ]
};

// ==========================================
// 2. INISIALISASI DATABASE & SKEMA
// ==========================================

/**
 * Inisialisasi seluruh 9 sheet dengan header dan styling baku
 * Dapat dijalankan manual dari editor Apps Script atau otomatis saat request pertama
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  Object.keys(SHEET_HEADERS).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SHEET_HEADERS[sheetName];
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#0284c7')
        .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  });

  // Buat default akun Admin jika Users masih kosong
  // Buat default akun jika Users masih kosong (Hierarki 5 Peran)
  const usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (usersSheet && usersSheet.getLastRow() <= 1) {
    const defaultPin = '1234'; // Default PIN awal, wajib diganti
    
    // 1. Administrator: Akses ke semua fitur tanpa kecuali
    const salt1 = generateSalt();
    usersSheet.appendRow([
      'USR-001', 'superadmin', hashPin(defaultPin, salt1), salt1, 'administrator',
      'Administrator Utama', 'TRUE', new Date().toISOString()
    ]);
    
    // 2. Owner: Semua fitur kecuali recovery & snapshot
    const salt2 = generateSalt();
    usersSheet.appendRow([
      'USR-002', 'owner', hashPin(defaultPin, salt2), salt2, 'owner',
      'Owner Rental', 'TRUE', new Date().toISOString()
    ]);

    // 3. Admin: Seperti owner dikurangi omset/finansial & manajemen pengguna
    const salt3 = generateSalt();
    usersSheet.appendRow([
      'USR-003', 'admin', hashPin(defaultPin, salt3), salt3, 'admin',
      'Admin Operasional', 'TRUE', new Date().toISOString()
    ]);

    // 4. Operator: Seperti admin dikurangi tarif & unit armada
    const salt4 = generateSalt();
    usersSheet.appendRow([
      'USR-004', 'operator', hashPin(defaultPin, salt4), salt4, 'operator',
      'Operator Pool Dinoyo', 'TRUE', new Date().toISOString()
    ]);

    // 5. Kurir: Khusus pelacakan unit motor (lacak unit)
    const salt5 = generateSalt();
    usersSheet.appendRow([
      'USR-005', 'kurir', hashPin(defaultPin, salt5), salt5, 'kurir',
      'Kurir Lapangan', 'TRUE', new Date().toISOString()
    ]);
  }

  // Buat seed unit jika Unit masih kosong
  const unitSheet = ss.getSheetByName(SHEETS.UNIT);
  if (unitSheet && unitSheet.getLastRow() <= 1) {
    const initialUnits = [
      ['U01', 'U01', 'm_beat', 'Honda Beat ESP 110', 'N 2341 AA', 'ryokou_tersedia', 2022, 'Hitam', 'Pool Dinoyo (Malang)', new Date().toISOString(), 1],
      ['U02', 'U02', 'm_beat', 'Honda Beat Deluxe', 'N 4512 BB', 'ryokou_tersedia', 2023, 'Silver', 'Pool Dinoyo (Malang)', new Date().toISOString(), 1],
      ['U03', 'U03', 'm_vario', 'Honda Vario 125 CBS', 'N 6789 CC', 'ryokou_tersedia', 2023, 'Merah', 'Pool Batu', new Date().toISOString(), 1],
      ['U04', 'U04', 'm_scoopy', 'Honda Scoopy Prestige', 'N 1122 DD', 'ryokou_tersedia', 2023, 'Putih', 'Pool Dinoyo (Malang)', new Date().toISOString(), 1],
      ['U05', 'U05', 'm_nmax', 'Yamaha NMAX 155 ABS', 'N 3344 EE', 'ryokou_tersedia', 2022, 'Hitam Doff', 'Pool Batu', new Date().toISOString(), 1]
    ];
    initialUnits.forEach(u => unitSheet.appendRow(u));
  }

  return { success: true, message: 'Database 9-sheet RyokoRent berhasil diinisialisasi' };
}

// ==========================================
// 3. KEAMANAN, HASHING, & TOKEN SESI
// ==========================================

function getJwtSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('JWT_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('JWT_SECRET', secret);
  }
  return secret;
}

function generateSalt() {
  return Utilities.getUuid().substring(0, 16);
}

function hashPin(pin, salt) {
  const raw = pin + ':' + salt;
  const signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return signature.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function createSessionToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.nama,
    exp: Date.now() + TOKEN_EXPIRY_MS
  };
  const jsonPayload = JSON.stringify(payload);
  const base64Payload = Utilities.base64EncodeWebSafe(jsonPayload);
  const secret = getJwtSecret();
  const rawSignature = Utilities.computeHmacSha256Signature(base64Payload, secret);
  const base64Sig = Utilities.base64EncodeWebSafe(rawSignature);
  return base64Payload + '.' + base64Sig;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  
  const base64Payload = parts[0];
  const signature = parts[1];
  const secret = getJwtSecret();
  const expectedSigBytes = Utilities.computeHmacSha256Signature(base64Payload, secret);
  const expectedSig = Utilities.base64EncodeWebSafe(expectedSigBytes);
  
  if (signature !== expectedSig) return null;
  
  try {
    const payloadStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(base64Payload)).getDataAsString();
    const payload = JSON.parse(payloadStr);
    if (!payload.exp || Date.now() > payload.exp) {
      return null; // Token kedaluwarsa
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// ==========================================
// 4. HANDLER HTTP: doGet (BACA & SYNC PULL)
// ==========================================

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'PING';
    
    if (action === 'PING') {
      return jsonResponse({
        status: 'ONLINE',
        app: 'RyokoRent Gateway Apps Script',
        version: APP_VERSION,
        serverTimeWib: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss') + ' WIB',
        sheets: Object.values(SHEETS)
      });
    }

    if (action === 'INIT_DB') {
      const res = setupDatabase();
      return jsonResponse(res);
    }

    if (action === 'SYNC_PULL' || action === 'PULL') {
      const token = e.parameter.token;
      const session = verifySessionToken(token);
      if (!session) {
        return jsonResponse({ success: false, error: 'UNAUTHORIZED', message: 'Token sesi tidak valid atau kedaluwarsa' }, 401);
      }
      return handleSyncPull(session);
    }

    return jsonResponse({ success: false, error: 'UNKNOWN_ACTION', action: action }, 400);
  } catch (err) {
    return jsonResponse({ success: false, error: 'SERVER_ERROR', message: err.toString() }, 500);
  }
}

/**
 * Sinkronisasi data ke klien dengan pemfilteran hak akses peran (RBAC)
 * Admin: menerima seluruh kolom termasuk omset, total biaya, denda
 * Operator: kolom total biaya, omset, denda difilter menjadi null
 */
function handleSyncPull(session) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const role = session.role;
  const canViewFinancials = role === 'administrator' || role === 'owner';
  const canManageUsers = role === 'administrator' || role === 'owner';
  const isCourier = role === 'kurir';

  // 1. Ambil Master Unit
  const unitSheet = ss.getSheetByName(SHEETS.UNIT);
  const units = [];
  if (unitSheet && unitSheet.getLastRow() > 1) {
    const data = unitSheet.getDataRange().getValues();
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const item = {};
      headers.forEach((h, colIdx) => {
        item[h] = row[colIdx];
      });
      units.push(item);
    }
  }

  // 2. Ambil Tracking
  const trackSheet = ss.getSheetByName(SHEETS.TRACKING);
  const tracking = [];
  if (trackSheet && trackSheet.getLastRow() > 1) {
    const data = trackSheet.getDataRange().getValues();
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const item = {};
      headers.forEach((h, colIdx) => {
        item[h] = row[colIdx];
      });
      tracking.push(item);
    }
  }

  // Hitung versi server tertinggi
  const serverVersion = getServerVersion();

  // Khusus Kurir: Hanya diberikan data pelacakan unit motor
  if (isCourier) {
    return jsonResponse({
      success: true,
      serverVersion: serverVersion,
      timestamp: new Date().toISOString(),
      role: session.role,
      data: {
        bookings: [],
        units: units,
        tracking: tracking,
        serviceRecords: [],
        dailyOperationalLogs: [],
        users: []
      }
    });
  }

  // 3. Ambil Bookings (Administrator, Owner, Admin, Operator)
  const bookingSheet = ss.getSheetByName(SHEETS.BOOKING);
  const bookings = [];
  if (bookingSheet && bookingSheet.getLastRow() > 1) {
    const data = bookingSheet.getDataRange().getValues();
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const item = {};
      headers.forEach((h, colIdx) => {
        item[h] = row[colIdx];
      });
      // Sembunyikan kolom keuangan untuk role selain Administrator & Owner (Admin & Operator dibatasi)
      if (!canViewFinancials) {
        item.totalEstimasiBiaya = null;
        item.dendaKeterlambatan = null;
      }
      bookings.push(item);
    }
  }

  // 4. Ambil Servis
  const serviceSheet = ss.getSheetByName(SHEETS.SERVIS);
  const serviceLogs = [];
  if (serviceSheet && serviceSheet.getLastRow() > 1) {
    const data = serviceSheet.getDataRange().getValues();
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const item = {};
      headers.forEach((h, colIdx) => {
        item[h] = row[colIdx];
      });
      if (!canViewFinancials) {
        item.biaya = null;
      }
      serviceLogs.push(item);
    }
  }

  // 5. Ambil Log Operasional
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const logs = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    const data = logSheet.getDataRange().getValues();
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const item = {};
      headers.forEach((h, colIdx) => {
        item[h] = row[colIdx];
      });
      logs.push(item);
    }
  }

  // 6. Ambil Pengguna (Hanya Administrator & Owner)
  let usersList = [];
  if (canManageUsers) {
    const usersSheet = ss.getSheetByName(SHEETS.USERS);
    if (usersSheet && usersSheet.getLastRow() > 1) {
      const data = usersSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        usersList.push({
          id: data[i][0],
          username: data[i][1],
          role: data[i][4],
          nama: data[i][5],
          aktif: data[i][6],
          terakhirLogin: data[i][7]
        });
      }
    }
  }

  // Hitung versi server tertinggi
  const serverVersion = getServerVersion();

  return jsonResponse({
    success: true,
    serverVersion: serverVersion,
    timestamp: new Date().toISOString(),
    role: session.role,
    data: {
      bookings: bookings,
      units: units,
      tracking: tracking,
      serviceLogs: serviceLogs,
      dailyOperationalLogs: logs,
      users: usersList
    }
  });
}

// ==========================================
// 5. HANDLER HTTP: doPost (MUTASI & TULIS)
// ==========================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'BAD_REQUEST', message: 'Payload body kosong' }, 400);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    // Aksi LOGIN tidak memerlukan token sesi awal
    if (action === 'LOGIN') {
      return handleLogin(payload);
    }

    // Seluruh operasi tulis lainnya wajib membawa token sesi
    const session = verifySessionToken(payload.token);
    if (!session) {
      return jsonResponse({ success: false, error: 'UNAUTHORIZED', message: 'Token sesi tidak valid atau kedaluwarsa' }, 401);
    }

    // Gunakan LockService untuk menjamin serialisasi eksekusi tulis (anti race condition)
    const lock = LockService.getScriptLock();
    const lockSuccess = lock.tryLock(30000); // Tunggu maks 30 detik
    if (!lockSuccess) {
      return jsonResponse({ success: false, error: 'CONCURRENCY_TIMEOUT', message: 'Server sibuk memproses antrean lain, silakan coba sesaat lagi' }, 503);
    }

    try {
      // Periksa kunci idempotensi pada tabel Audit jika ada
      const idempotencyKey = payload.idempotencyKey;
      if (idempotencyKey) {
        const cachedResult = checkIdempotency(idempotencyKey);
        if (cachedResult) {
          return jsonResponse({
            success: true,
            idempotentReplay: true,
            message: 'Operasi sudah pernah diproses sebelumnya (idempoten)',
            data: cachedResult
          });
        }
      }

      // Router mutasi
      let result;
      switch (action) {
        case 'CREATE_BOOKING':
          result = handleCreateBooking(payload.data, session, idempotencyKey);
          break;
        case 'APPROVE_BOOKING':
          result = handleApproveBooking(payload.data, session, idempotencyKey);
          break;
        case 'UPDATE_STATUS':
          result = handleUpdateStatus(payload.data, session, idempotencyKey);
          break;
        case 'RECORD_SERVICE':
          result = handleRecordService(payload.data, session, idempotencyKey);
          break;
        case 'RECORD_LOG':
          result = handleRecordLog(payload.data, session, idempotencyKey);
          break;
        case 'UPDATE_TRACKING':
          result = handleUpdateTracking(payload.data, session, idempotencyKey);
          break;
        case 'SYNC_OUTBOX':
          result = handleSyncOutbox(payload.items, session);
          break;
        default:
          result = { success: false, error: 'UNSUPPORTED_ACTION', message: 'Aksi mutasi tidak dikenali: ' + action };
      }

      // Increment versi server bila ada mutasi berhasil
      if (result.success) {
        incrementServerVersion();
      }

      return jsonResponse(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ success: false, error: 'SERVER_ERROR', message: err.toString() }, 500);
  }
}

// ==========================================
// 6. IMPLEMENTASI AKSI OPERASIONAL
// ==========================================

function handleLogin(payload) {
  const username = (payload.username || '').trim().toLowerCase();
  const pin = (payload.pin || '').toString().trim();

  if (!username || !pin) {
    return jsonResponse({ success: false, error: 'INVALID_CREDENTIALS', message: 'Username dan PIN wajib diisi' }, 400);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (!usersSheet || usersSheet.getLastRow() <= 1) {
    setupDatabase();
  }

  const data = usersSheet.getDataRange().getValues();
  let foundUser = null;
  let userRowIdx = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][1].toString().toLowerCase() === username && data[i][6].toString().toUpperCase() === 'TRUE') {
      foundUser = {
        id: data[i][0],
        username: data[i][1],
        pinHash: data[i][2],
        salt: data[i][3],
        role: data[i][4],
        nama: data[i][5]
      };
      userRowIdx = i + 1;
      break;
    }
  }

  if (!foundUser) {
    return jsonResponse({ success: false, error: 'AUTH_FAILED', message: 'Username tidak ditemukan atau akun dinonaktifkan' }, 401);
  }

  const computedHash = hashPin(pin, foundUser.salt);
  if (computedHash !== foundUser.pinHash) {
    return jsonResponse({ success: false, error: 'AUTH_FAILED', message: 'PIN salah' }, 401);
  }

  // Update terakhir login
  usersSheet.getRange(userRowIdx, 8).setValue(new Date().toISOString());

  // Buat session token
  const token = createSessionToken(foundUser);

  recordAudit({
    actorId: foundUser.id,
    actorRole: foundUser.role,
    action: 'LOGIN',
    entity: 'Users',
    entityId: foundUser.id,
    status: 'SUCCESS',
    details: 'Login berhasil dari perangkat klien'
  });

  return jsonResponse({
    success: true,
    token: token,
    user: {
      id: foundUser.id,
      username: foundUser.username,
      role: foundUser.role,
      name: foundUser.nama
    }
  });
}

/**
 * Validasi bentrok jadwal di sisi server (+ buffer 60 menit)
 */
function checkServerScheduleConflict(kodeUnit, startIso, endIso, excludeBookingId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bookingSheet = ss.getSheetByName(SHEETS.BOOKING);
  if (!bookingSheet || bookingSheet.getLastRow() <= 1) return { conflict: false };

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const bufferMs = BUFFER_MINUTES * 60 * 1000;

  const data = bookingSheet.getDataRange().getValues();
  const headers = data[0];
  const noBookingCol = headers.indexOf('noBooking');
  const kodeUnitCol = headers.indexOf('kodeUnitFisik');
  const startCol = headers.indexOf('jadwalMulai');
  const endCol = headers.indexOf('jadwalSelesai');
  const statusCol = headers.indexOf('statusSewa');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const bId = row[noBookingCol];
    if (excludeBookingId && bId === excludeBookingId) continue;

    const rowUnit = row[kodeUnitCol];
    const rowStatus = row[statusCol];

    // Status yang menahan unit: booking aktif atau servis
    const blockingStatuses = ['ryokou_menunggu_verifikasi', 'ryokou_disewa', 'ryokou_diservis'];
    if (rowUnit === kodeUnit && blockingStatuses.includes(rowStatus)) {
      const bStartMs = new Date(row[startCol]).getTime() - bufferMs;
      const bEndMs = new Date(row[endCol]).getTime() + bufferMs;

      // Cek irisan rentang waktu
      if (startMs < bEndMs && endMs > bStartMs) {
        return {
          conflict: true,
          conflictingBookingId: bId,
          reason: 'Unit ' + kodeUnit + ' memiliki jadwal sewa/servis lain pada rentang tersebut (+ buffer 60 mnt)'
        };
      }
    }
  }

  return { conflict: false };
}

/**
 * Pembuatan booking baru (Wajib Online)
 */
function handleCreateBooking(bookingData, session, idempotencyKey) {
  if (!bookingData.kodeUnitFisik || !bookingData.jadwalMulai || !bookingData.jadwalSelesai) {
    return { success: false, error: 'VALIDATION_ERROR', message: 'Kode unit dan rentang jadwal sewa wajib diisi' };
  }

  // 1. Cek bentrok jadwal di server
  const conflictCheck = checkServerScheduleConflict(
    bookingData.kodeUnitFisik,
    bookingData.jadwalMulai,
    bookingData.jadwalSelesai,
    null
  );
  if (conflictCheck.conflict) {
    return {
      success: false,
      error: 'SCHEDULE_CONFLICT',
      message: conflictCheck.reason,
      details: conflictCheck
    };
  }

  // 2. Generate No Booking resmi di server (atomic counter)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bookingSheet = ss.getSheetByName(SHEETS.BOOKING);
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMdd');
  const nextSeq = bookingSheet.getLastRow(); // urutan baris
  const seqFormatted = ('0000' + nextSeq).slice(-4);
  const noBooking = 'RYO-' + dateStr + '-' + seqFormatted;

  const nowIso = now.toISOString();
  const newRow = [
    noBooking,
    bookingData.waktuPemesanan || nowIso,
    bookingData.statusSewa || 'ryokou_menunggu_verifikasi',
    bookingData.namaPenyewa || '',
    bookingData.nomorWa || '',
    bookingData.noDarurat || '',
    bookingData.alamatKtp || '',
    bookingData.jenisIdPendukung || '',
    bookingData.alamatSaatIni || '',
    bookingData.idSosmed || '',
    bookingData.modelMotor || '',
    bookingData.kodeUnitFisik,
    bookingData.jumlahHelm || 1,
    bookingData.durasiSewa || '1_hari',
    bookingData.jadwalMulai,
    bookingData.jadwalSelesai,
    bookingData.lokasiAntar || '',
    bookingData.lokasiJemput || '',
    bookingData.kurirPengantar || '',
    bookingData.totalEstimasiBiaya || 0,
    bookingData.dendaKeterlambatan || 0,
    bookingData.catatanKhusus || '',
    bookingData.statusReviewAdmin || 'PENDING_REVIEW',
    bookingData.opsiTindakLanjut || 'Siapkan Unit',
    bookingData.aksiTerakhirDisetujui || 'Booking dibuat via Web App',
    nowIso,
    nowIso,
    1
  ];

  bookingSheet.appendRow(newRow);

  recordAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'CREATE_BOOKING',
    entity: 'Booking',
    entityId: noBooking,
    idempotencyKey: idempotencyKey,
    status: 'SUCCESS',
    details: 'Booking ' + noBooking + ' berhasil dibuat oleh ' + session.username
  });

  return {
    success: true,
    noBooking: noBooking,
    message: 'Booking berhasil dibuat di server'
  };
}

/**
 * Persetujuan booking oleh Administrator, Owner, atau Admin (Wajib Online)
 */
function handleApproveBooking(data, session, idempotencyKey) {
  const allowedRoles = ['administrator', 'owner', 'admin'];
  if (!allowedRoles.includes(session.role)) {
    return { success: false, error: 'FORBIDDEN', message: 'Hanya Administrator, Owner, atau Admin yang dapat menyetujui booking' };
  }

  const noBooking = data.noBooking;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bookingSheet = ss.getSheetByName(SHEETS.BOOKING);
  const values = bookingSheet.getDataRange().getValues();
  const headers = values[0];
  const noBookingCol = headers.indexOf('noBooking');
  const reviewCol = headers.indexOf('statusReviewAdmin');
  const aksiCol = headers.indexOf('aksiTerakhirDisetujui');
  const updatedCol = headers.indexOf('updatedAt');

  for (let i = 1; i < values.length; i++) {
    if (values[i][noBookingCol] === noBooking) {
      const rowIdx = i + 1;
      const nowIso = new Date().toISOString();
      bookingSheet.getRange(rowIdx, reviewCol + 1).setValue('APPROVED');
      bookingSheet.getRange(rowIdx, aksiCol + 1).setValue('Disetujui Admin pada ' + nowIso);
      bookingSheet.getRange(rowIdx, updatedCol + 1).setValue(nowIso);

      recordAudit({
        actorId: session.userId,
        actorRole: session.role,
        action: 'APPROVE_BOOKING',
        entity: 'Booking',
        entityId: noBooking,
        idempotencyKey: idempotencyKey,
        status: 'SUCCESS',
        details: 'Booking ' + noBooking + ' disetujui'
      });

      return { success: true, message: 'Booking ' + noBooking + ' disetujui' };
    }
  }

  return { success: false, error: 'NOT_FOUND', message: 'Booking tidak ditemukan' };
}

/**
 * Update transisi status booking (Wajib Online)
 */
function handleUpdateStatus(data, session, idempotencyKey) {
  const noBooking = data.noBooking;
  const nextStatus = data.nextStatus;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bookingSheet = ss.getSheetByName(SHEETS.BOOKING);
  const values = bookingSheet.getDataRange().getValues();
  const headers = values[0];
  const noBookingCol = headers.indexOf('noBooking');
  const statusCol = headers.indexOf('statusSewa');
  const unitCol = headers.indexOf('kodeUnitFisik');
  const updatedCol = headers.indexOf('updatedAt');

  for (let i = 1; i < values.length; i++) {
    if (values[i][noBookingCol] === noBooking) {
      const rowIdx = i + 1;
      const currentStatus = values[i][statusCol];
      const unitCode = values[i][unitCol];
      const nowIso = new Date().toISOString();

      bookingSheet.getRange(rowIdx, statusCol + 1).setValue(nextStatus);
      bookingSheet.getRange(rowIdx, updatedCol + 1).setValue(nowIso);

      // Sinkronkan status unit di tabel Unit
      if (nextStatus === 'ryokou_disewa' || nextStatus === 'ryokou_selesai' || nextStatus === 'ryokou_dibatalkan') {
        const targetUnitStatus = nextStatus === 'ryokou_disewa' ? 'ryokou_disewa' : 'ryokou_tersedia';
        updateUnitPhysicalStatus(unitCode, targetUnitStatus);
      }

      recordAudit({
        actorId: session.userId,
        actorRole: session.role,
        action: 'UPDATE_STATUS',
        entity: 'Booking',
        entityId: noBooking,
        idempotencyKey: idempotencyKey,
        status: 'SUCCESS',
        details: 'Transisi status dari ' + currentStatus + ' ke ' + nextStatus
      });

      return { success: true, message: 'Status berhasil diubah ke ' + nextStatus };
    }
  }

  return { success: false, error: 'NOT_FOUND', message: 'Booking tidak ditemukan' };
}

/**
 * Pencatatan servis rutin (Diizinkan Offline via Outbox)
 */
function handleRecordService(data, session, idempotencyKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const serviceSheet = ss.getSheetByName(SHEETS.SERVIS);
  const now = new Date();
  const serviceId = data.id || 'SRV-' + Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMdd-HHmmss');

  const newRow = [
    serviceId,
    data.unitId || '',
    data.kodeUnit || '',
    data.kategoriServis || 'Servis Rutin',
    data.biaya || 0,
    data.odometer || 0,
    data.bengkel || '',
    data.catatan || '',
    data.tanggal || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd'),
    data.status || 'selesai',
    now.toISOString()
  ];

  serviceSheet.appendRow(newRow);

  // Jika servis sedang berlangsung, tandai unit sebagai ryokou_diservis
  if (data.status === 'dalam_pengerjaan' && data.kodeUnit) {
    updateUnitPhysicalStatus(data.kodeUnit, 'ryokou_diservis');
  }

  recordAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'RECORD_SERVICE',
    entity: 'Servis',
    entityId: serviceId,
    idempotencyKey: idempotencyKey,
    status: 'SUCCESS',
    details: 'Catatan servis dicatat untuk unit ' + data.kodeUnit
  });

  return { success: true, serviceId: serviceId, message: 'Catatan servis berhasil disimpan' };
}

/**
 * Pencatatan log operasional harian (Diizinkan Offline via Outbox)
 */
function handleRecordLog(data, session, idempotencyKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const now = new Date();
  const logId = data.id || 'LOG-' + Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMdd-HHmmss');

  const newRow = [
    logId,
    data.tanggal || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd'),
    data.waktu || Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm'),
    data.kategori || 'operasional',
    data.judul || '',
    data.deskripsi || '',
    data.prioritas || 'normal',
    data.namaPelapor || session.name,
    data.diselesaikan ? 'TRUE' : 'FALSE'
  ];

  logSheet.appendRow(newRow);

  recordAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'RECORD_LOG',
    entity: 'Log',
    entityId: logId,
    idempotencyKey: idempotencyKey,
    status: 'SUCCESS',
    details: 'Log operasional dicatat: ' + (data.judul || '')
  });

  return { success: true, logId: logId, message: 'Log operasional berhasil disimpan' };
}

/**
 * Pembaruan posisi pelacakan armada (Diizinkan Offline via Outbox)
 */
function handleUpdateTracking(data, session, idempotencyKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const trackSheet = ss.getSheetByName(SHEETS.TRACKING);
  const now = new Date();
  const trackId = data.id || 'TRK-' + Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMdd-HHmmss');

  const newRow = [
    trackId,
    data.unitId || '',
    data.kodeUnit || '',
    data.lokasi || 'Pool Dinoyo (Malang)',
    data.latitude || 0,
    data.longitude || 0,
    data.namaKurir || session.name,
    data.catatan || '',
    now.toISOString()
  ];

  trackSheet.appendRow(newRow);

  // Update lokasi fisik terakhir di tabel Unit
  if (data.kodeUnit && data.lokasi) {
    updateUnitLocation(data.kodeUnit, data.lokasi);
  }

  recordAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'UPDATE_TRACKING',
    entity: 'Tracking',
    entityId: trackId,
    idempotencyKey: idempotencyKey,
    status: 'SUCCESS',
    details: 'Posisi unit ' + data.kodeUnit + ' diperbarui ke ' + data.lokasi
  });

  return { success: true, trackId: trackId, message: 'Posisi unit berhasil diperbarui' };
}

/**
 * Pemrosesan antrean batch Outbox dari IndexedDB
 */
function handleSyncOutbox(items, session) {
  if (!items || !Array.isArray(items)) {
    return { success: false, error: 'INVALID_PAYLOAD', message: 'Daftar item outbox tidak valid' };
  }

  const results = [];
  items.forEach(item => {
    try {
      let res;
      if (item.action === 'RECORD_SERVICE') {
        res = handleRecordService(item.data, session, item.idempotencyKey);
      } else if (item.action === 'RECORD_LOG') {
        res = handleRecordLog(item.data, session, item.idempotencyKey);
      } else if (item.action === 'UPDATE_TRACKING') {
        res = handleUpdateTracking(item.data, session, item.idempotencyKey);
      } else {
        res = {
          success: false,
          error: 'RESTRICTED_OFFLINE_ACTION',
          message: 'Operasi ' + item.action + ' tidak diizinkan ditulis offline'
        };
      }
      results.push({
        idempotencyKey: item.idempotencyKey,
        success: res.success,
        response: res
      });
    } catch (err) {
      results.push({
        idempotencyKey: item.idempotencyKey,
        success: false,
        error: err.toString()
      });
    }
  });

  return { success: true, batchResults: results };
}

// ==========================================
// 7. HELPER SHEET & DATABASE INTERNAL
// ==========================================

function updateUnitPhysicalStatus(kodeUnit, targetStatus) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const unitSheet = ss.getSheetByName(SHEETS.UNIT);
  if (!unitSheet) return;

  const data = unitSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === kodeUnit) {
      const rowIdx = i + 1;
      unitSheet.getRange(rowIdx, 6).setValue(targetStatus); // Kolom 6: status
      unitSheet.getRange(rowIdx, 10).setValue(new Date().toISOString()); // Kolom 10: updatedAt
      break;
    }
  }
}

function updateUnitLocation(kodeUnit, lokasi) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const unitSheet = ss.getSheetByName(SHEETS.UNIT);
  if (!unitSheet) return;

  const data = unitSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === kodeUnit) {
      const rowIdx = i + 1;
      unitSheet.getRange(rowIdx, 9).setValue(lokasi); // Kolom 9: lokasiTerakhir
      unitSheet.getRange(rowIdx, 10).setValue(new Date().toISOString()); // Kolom 10: updatedAt
      break;
    }
  }
}

function checkIdempotency(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const auditSheet = ss.getSheetByName(SHEETS.AUDIT);
  if (!auditSheet || auditSheet.getLastRow() <= 1) return null;

  const data = auditSheet.getDataRange().getValues();
  const keyColIdx = 7; // kolom idempotencyKey (0-based)
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][keyColIdx] === key) {
      return {
        previousTimestamp: data[i][1],
        action: data[i][4],
        entityId: data[i][6],
        status: data[i][8]
      };
    }
  }
  return null;
}

function recordAudit(auditData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const auditSheet = ss.getSheetByName(SHEETS.AUDIT);
    if (!auditSheet) return;

    const auditId = 'AUD-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmssSSS');
    const newRow = [
      auditId,
      new Date().toISOString(),
      auditData.actorId || 'SYSTEM',
      auditData.actorRole || 'SYSTEM',
      auditData.action || 'MUTATION',
      auditData.entity || '',
      auditData.entityId || '',
      auditData.idempotencyKey || '',
      auditData.status || 'SUCCESS',
      auditData.details || ''
    ];

    auditSheet.appendRow(newRow);
  } catch (e) {
    // Audit failure should not break primary operation
    Logger.log('Gagal mencatat audit: ' + e.toString());
  }
}

function getServerVersion() {
  const props = PropertiesService.getScriptProperties();
  const v = props.getProperty('SERVER_VERSION');
  return v ? parseInt(v, 10) : 1;
}

function incrementServerVersion() {
  const props = PropertiesService.getScriptProperties();
  const current = getServerVersion();
  const next = current + 1;
  props.setProperty('SERVER_VERSION', next.toString());
  return next;
}

function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
