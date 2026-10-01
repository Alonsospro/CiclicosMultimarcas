const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Mapping of friendly brand names for known SVG logos
const BRAND_NAMES = {
  'nibol.svg': 'NIBOL S.A.',
  'john-deere.svg': 'John Deere',
  'mack.svg': 'Mack Trucks',
  'volvo.svg': 'Volvo Construction',
  'foton.svg': 'Foton Motors',
  'ud-trucks.svg': 'UD Trucks',
  'wirtgen.svg': 'Wirtgen Group'
};

async function syncLogosFromDrive() {
  const folderId = config.driveLogoFolderId || '1ZECgK7i8DAqXH0K3quRqaIlcnbpF7nSe';
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  const res = await fetch(folderUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return { updated: 0, error: 'Could not access Drive folder' };

  const html = await res.text();
  const matches = [...html.matchAll(/aria-label=\"([^\"]+?\.(?:svg|png|jpg|webp))[^\"]*\"[^>]*?ssk=['\"][^'\"]*?:([a-zA-Z0-9_-]{25,})/gi)];

  const logosDir = path.join(__dirname, '..', '..', 'public', 'logos');
  const dataDir = path.join(__dirname, '..', '..', 'data', 'Logo');
  if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let updatedCount = 0;
  const processed = new Set();

  for (const m of matches) {
    const fileName = m[1].trim();
    const rawId = m[2].split('-')[0];
    if (processed.has(fileName)) continue;
    processed.add(fileName);

    try {
      const fileRes = await fetch(`https://drive.google.com/uc?export=download&id=${rawId}`);
      if (fileRes.ok) {
        const buffer = Buffer.from(await fileRes.arrayBuffer());
        fs.writeFileSync(path.join(logosDir, fileName), buffer);
        fs.writeFileSync(path.join(dataDir, fileName), buffer);
        updatedCount++;
      }
    } catch (e) {
      console.error(`Error syncing logo ${fileName}:`, e.message);
    }
  }

  return { updated: updatedCount };
}

router.post('/sync', async (req, res) => {
  try {
    const result = await syncLogosFromDrive();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    if (req.query.sync === 'true') {
      await syncLogosFromDrive();
    }

    const logosDir = path.join(__dirname, '..', '..', 'public', 'logos');
    const fallbackDir = path.join(__dirname, '..', '..', 'data', 'Logo');

    let dirToScan = logosDir;
    if (!fs.existsSync(dirToScan)) {
      dirToScan = fallbackDir;
    }

    let files = [];
    if (fs.existsSync(dirToScan)) {
      files = fs.readdirSync(dirToScan).filter(f => f.endsWith('.svg') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'));
    }

    // Default primary order: NIBOL first, then representative brands
    const order = ['nibol.svg', 'john-deere.svg', 'volvo.svg', 'mack.svg', 'foton.svg', 'ud-trucks.svg', 'wirtgen.svg'];
    files.sort((a, b) => {
      const idxA = order.indexOf(a);
      const idxB = order.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    const logos = files.map(file => {
      const baseName = path.basename(file, path.extname(file));
      const brandName = BRAND_NAMES[file] || baseName.replace(/[-_]/g, ' ').toUpperCase();
      return {
        id: baseName,
        file,
        name: brandName,
        url: `/logos/${file}`
      };
    });

    res.json({
      success: true,
      folderId: config.driveLogoFolderId,
      total: logos.length,
      logos
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
