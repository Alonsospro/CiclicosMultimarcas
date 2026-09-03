require('dotenv').config();
const path = require('path');

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'nibol_secret_jwt_key_2026_ciclicos_default',
  adminDeleteKey: process.env.ADMIN_DELETE_KEY || 'ADM26',

  // Google Apps Script integration endpoints
  integrations: {
    CICLICOS_URL: process.env.CICLICOS_URL || 'https://script.google.com/macros/s/AKfycbwpJ5klIWQmhhM4RNgxfG4QabqLOOb2KCVhLPhyIWvHeUsQ39wgHjMt3sHLJo9tH-9p/exec',
    BARRIDO_URL: process.env.BARRIDO_URL || 'https://script.google.com/macros/s/AKfycbysHHX9TYzpV3jDBvcDtcHmCAc0PO3vRpiivGqHz373qr4aB3mfmmcxjtWXhuemv3FyvQ/exec',
    MENSUALES_URL: process.env.MENSUALES_URL || 'https://script.google.com/macros/s/AKfycbyF903sRTv0jkn_nxAFEZogK0cY_sLSMkgJzViImuIgYMaBV_1MSI1hsINhmD43Gro4Cg/exec',
    SEMANALES_URL: process.env.SEMANALES_URL || 'https://script.google.com/macros/s/AKfycbxCEDud8PvY4nF31KusgUAa9HJvTwxTzJQsyrfBcPb1cXp4Gg9vJJh_Xo6hQ91DcgnwZw/exec'
  },

  // Base storage directory
  baseDataDir: path.join(__dirname, '..', '..', 'data'),
  referencePhotosDir: process.env.REFERENCE_PHOTOS_DIR || path.join(__dirname, '..', '..', 'data', 'fotosreferencias'),

  // Google Drive Folders Configuration (Official NIBOL Drive Structure)
  driveMainFolderUrl: process.env.DRIVE_MAIN_FOLDER_URL || 'https://drive.google.com/drive/folders/1TLSgggQF3yjePujdNQPAYDjnOS_14HS7?usp=sharing',
  driveMainFolderId: process.env.DRIVE_MAIN_FOLDER_ID || '1TLSgggQF3yjePujdNQPAYDjnOS_14HS7',

  driveLogoFolderUrl: process.env.DRIVE_LOGO_FOLDER_URL || 'https://drive.google.com/drive/folders/1ZECgK7i8DAqXH0K3quRqaIlcnbpF7nSe?usp=sharing',
  driveLogoFolderId: process.env.DRIVE_LOGO_FOLDER_ID || '1ZECgK7i8DAqXH0K3quRqaIlcnbpF7nSe',

  driveSnapshotsFolderUrl: process.env.DRIVE_SNAPSHOTS_FOLDER_URL || 'https://drive.google.com/drive/folders/1oLK2TWyhG4Pekqd2E6z_DbgQ_mcgdau7?usp=sharing',
  driveSnapshotsFolderId: process.env.DRIVE_SNAPSHOTS_FOLDER_ID || '1oLK2TWyhG4Pekqd2E6z_DbgQ_mcgdau7',

  driveBaseFilesFolderUrl: process.env.DRIVE_BASE_FILES_FOLDER_URL || 'https://drive.google.com/drive/folders/1eYg5xYTpWVhgBk_vLDJH3_ZxAMxGc-wY?usp=sharing',
  driveBaseFilesFolderId: process.env.DRIVE_BASE_FILES_FOLDER_ID || '1eYg5xYTpWVhgBk_vLDJH3_ZxAMxGc-wY',

  driveDamagedFolderUrl: process.env.DRIVE_DAMAGED_FOLDER_URL || 'https://drive.google.com/drive/folders/1q0rRvFpiFXDlXuX97odyz-bVcGZIxwEm?usp=sharing',
  driveDamagedFolderId: process.env.DRIVE_DAMAGED_FOLDER_ID || '1q0rRvFpiFXDlXuX97odyz-bVcGZIxwEm',

  driveJustifFolderUrl: process.env.DRIVE_JUSTIF_FOLDER_URL || 'https://drive.google.com/drive/folders/1tBlqX8MXyfD6SjQ6aLoViCDqYd_8MK54?usp=sharing',
  driveJustifFolderId: process.env.DRIVE_JUSTIF_FOLDER_ID || '1tBlqX8MXyfD6SjQ6aLoViCDqYd_8MK54',

  driveReferenceFolderUrl: process.env.DRIVE_REFERENCE_FOLDER_URL || 'https://drive.google.com/drive/folders/1dp0MUZ4HcCSpDejpF5JknWN_09ZCshU6?usp=drive_link',
  driveReferenceFolderId: process.env.DRIVE_REFERENCE_FOLDER_ID || '1dp0MUZ4HcCSpDejpF5JknWN_09ZCshU6',

  snapshotFolderPath: process.env.SNAPSHOT_FOLDER_PATH || 'Nibol/Ciclicosn',

  // Drive logical folders naming convention & IDs
  drive: {
    baseFolder: 'NIBOL',
    ciclicosFolder: 'NIBOL/CICLICOS',
    barridoFolder: 'NIBOL/BARRIDO',
    mensualesFolder: 'NIBOL/MENSUALES',
    semanalesFolder: 'NIBOL/SEMANALES',
    justificationsPhotosFolder: 'NIBOL/FOTOS/JUSTIFICACIONES',
    mainFolderId: '1TLSgggQF3yjePujdNQPAYDjnOS_14HS7',
    logoFolderId: '1ZECgK7i8DAqXH0K3quRqaIlcnbpF7nSe',
    snapshotsFolderId: '1oLK2TWyhG4Pekqd2E6z_DbgQ_mcgdau7',
    baseFilesFolderId: '1eYg5xYTpWVhgBk_vLDJH3_ZxAMxGc-wY',
    damagedFolderId: '1q0rRvFpiFXDlXuX97odyz-bVcGZIxwEm',
    justifFolderId: '1tBlqX8MXyfD6SjQ6aLoViCDqYd_8MK54',
    referenceFolderId: '1dp0MUZ4HcCSpDejpF5JknWN_09ZCshU6'
  },

  // Column contract definition (Cols A to Q)
  columns: [
    'SKU',                // A
    'Codigo_Barras',      // B
    'Descripcion',        // C
    'Ubicacion',          // D
    'Categoria',          // E
    'Clasificacion_ABC',  // F
    'Unidad',             // G
    'Costo_Unitario',     // H (Hidden in blind count)
    'Stock_Sistema',      // I (Hidden in blind count)
    'Stock_Fisico',       // J
    'Diferencia',         // K (Hidden in blind count)
    'Costo_Diferencia',   // L (Hidden in blind count)
    'Fecha_Ultimo_Conteo',// M
    'Responsable',        // N
    'Estado',             // O (Hidden in blind count)
    'Mal_estado',         // P (Mal estado col P)
    'Comentario'          // Q (Comentario col Q)
  ],

  // Hidden columns for blind count (Auxiliar role)
  blindCountHiddenCols: ['Costo_Unitario', 'Stock_Sistema', 'Diferencia', 'Costo_Diferencia', 'Estado'],

  // Allowed inventory types
  inventoryTypes: ['CICLICO', 'BARRIDO', 'MENSUAL', 'SEMANAL'],

  // Official Centers with Code and Name (15 centers)
  centersList: [
    { code: '1120', name: 'Volvo - Km 14', displayName: '1120 - Volvo - Km 14' },
    { code: '1160', name: 'Av. Banzer 3er anillo', displayName: '1160 - Av. Banzer 3er anillo' },
    { code: '1180', name: 'Foton - Km 10', displayName: '1180 - Foton - Km 10' },
    { code: '1300', name: 'John Deere - Km 10', displayName: '1300 - John Deere - Km 10' },
    { code: '1310', name: 'Sucursal Montero', displayName: '1310 - Sucursal Montero' },
    { code: '1340', name: 'Sucursal Cuatro Cañadas', displayName: '1340 - Sucursal Cuatro Cañadas' },
    { code: '1700', name: 'Av. Grigota 3er anillo', displayName: '1700 - Av. Grigota 3er anillo' },
    { code: '1800', name: 'Express San Julián', displayName: '1800 - Express San Julián' },
    { code: '1820', name: 'Express San Pedro', displayName: '1820 - Express San Pedro' },
    { code: '2100', name: 'Sucursal El Alto, La Paz', displayName: '2100 - Sucursal El Alto, La Paz' },
    { code: '2150', name: 'Centro Foton El Alto, La Paz', displayName: '2150 - Centro Foton El Alto, La Paz' },
    { code: '3100', name: 'Sucursal Cochabamba', displayName: '3100 - Sucursal Cochabamba' },
    { code: '3200', name: 'Centro Foton Blanco Galindo', displayName: '3200 - Centro Foton Blanco Galindo' },
    { code: '5100', name: 'Sucursal Tarija', displayName: '5100 - Sucursal Tarija' }
  ],

  // Allowed centers (codes and names for fast check)
  centers: [
    '1120', '1160', '1180', '1300', '1310', '1340', '1700', '1800', '1820', '2100', '2150', '3100', '3200', '5100',
    'Volvo - Km 14', 'Av. Banzer 3er anillo', 'Foton - Km 10', 'John Deere - Km 10',
    'Sucursal Montero', 'Sucursal Cuatro Cañadas', 'Av. Grigota 3er anillo',
    'Express San Julián', 'Express San Pedro', 'Sucursal El Alto, La Paz',
    'Centro Foton El Alto, La Paz', 'Sucursal Cochabamba', 'Centro Foton Blanco Galindo', 'Sucursal Tarija',
    'WARNES', 'CENTRAL', 'SANTA_CRUZ', 'GLOBAL'
  ],

  findCenter(val) {
    if (!val) return null;
    const clean = String(val).trim().toLowerCase();
    if (clean === 'warnes') return this.centersList[0];
    return this.centersList.find(c =>
      c.code.toLowerCase() === clean ||
      c.name.toLowerCase() === clean ||
      c.displayName.toLowerCase() === clean
    ) || null;
  },

  isSameCenter(centerA, centerB) {
    if (!centerA || !centerB) return false;
    const a = String(centerA).trim();
    const b = String(centerB).trim();
    if (a.toUpperCase() === 'GLOBAL' || b.toUpperCase() === 'GLOBAL') return true;
    if (a.toLowerCase() === b.toLowerCase()) return true;

    const codeA = this.getCenterCode(a);
    const codeB = this.getCenterCode(b);
    if (codeA && codeB && codeA.toLowerCase() === codeB.toLowerCase()) return true;

    const objA = this.findCenter(a);
    const objB = this.findCenter(b);

    if (objA && objB) {
      return objA.code === objB.code;
    }
    if (objA) {
      return objA.code.toLowerCase() === b.toLowerCase() ||
             objA.name.toLowerCase() === b.toLowerCase() ||
             objA.displayName.toLowerCase() === b.toLowerCase();
    }
    if (objB) {
      return objB.code.toLowerCase() === a.toLowerCase() ||
             objB.name.toLowerCase() === a.toLowerCase() ||
             objB.displayName.toLowerCase() === a.toLowerCase();
    }
    return false;
  },

  getCenterCode(val) {
    if (!val) return '1120';
    const clean = String(val).trim();
    if (/^\d{4}$/.test(clean)) return clean;
    const match = clean.match(/\b(\d{4})\b/);
    if (match) return match[1];
    const found = this.findCenter(val);
    if (found) return found.code;
    if (clean.toUpperCase() === 'WARNES') return '1120';
    if (clean.toUpperCase() === 'GLOBAL') return '1120';
    return clean;
  }
};

module.exports = config;

