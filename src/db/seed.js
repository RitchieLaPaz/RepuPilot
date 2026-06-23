/**
 * Seed script — inserts sample folders + listings into PostgreSQL
 * Run once: node src/db/seed.js
 */
const db = require('./index');

const folders = [
  { name: 'Eaze' },
  { name: 'Green Dragon' },
  { name: 'Fluent' },
];

const listings = [
  // Eaze
  { brand: 'Eaze', name: 'Eaze West Hollywood',     address: '8560 Sunset Blvd',       city: 'West Hollywood, CA', phone: '(323) 555-0181', category: 'Cannabis Dispensary' },
  { brand: 'Eaze', name: 'Eaze SOMA',               address: '340 7th St',             city: 'San Francisco, CA',  phone: '(415) 555-0294', category: 'Cannabis Dispensary' },
  { brand: 'Eaze', name: 'Eaze Mission Valley',     address: '1640 Camino Del Rio N',  city: 'San Diego, CA',      phone: '(619) 555-0376', category: 'Cannabis Dispensary' },
  { brand: 'Eaze', name: 'Eaze Sacramento Midtown', address: '2228 K St',              city: 'Sacramento, CA',     phone: '(916) 555-0417', category: 'Cannabis Dispensary' },
  // Green Dragon
  { brand: 'Green Dragon', name: 'Green Dragon Cherry Creek', address: '244 Fillmore St',      city: 'Denver, CO',  phone: '(303) 555-0522', category: 'Cannabis Dispensary' },
  { brand: 'Green Dragon', name: 'Green Dragon Aurora',       address: '13700 E Colfax Ave',   city: 'Aurora, CO',  phone: '(720) 555-0638', category: 'Cannabis Dispensary' },
  { brand: 'Green Dragon', name: 'Green Dragon Boulder',      address: '1795 Folsom St',       city: 'Boulder, CO', phone: '(303) 555-0741', category: 'Cannabis Dispensary' },
  // Fluent
  { brand: 'Fluent', name: 'Fluent Brickell',          address: '1200 Brickell Ave',    city: 'Miami, FL',           phone: '(305) 555-0852', category: 'Cannabis Dispensary' },
  { brand: 'Fluent', name: 'Fluent Fort Lauderdale',   address: '2300 N Federal Hwy',   city: 'Fort Lauderdale, FL', phone: '(754) 555-0963', category: 'Cannabis Dispensary' },
  { brand: 'Fluent', name: 'Fluent Tampa Westshore',   address: '4701 W Kennedy Blvd',  city: 'Tampa, FL',           phone: '(813) 555-0174', category: 'Cannabis Dispensary' },
];

async function seed() {
  // Check if already seeded
  const { rows: existing } = await db.query('SELECT COUNT(*) FROM folders');
  if (parseInt(existing[0].count) > 0) {
    console.log('DB already has folders — skipping seed. To re-seed, run: DELETE FROM locations; DELETE FROM folders;');
    process.exit(0);
  }

  // Insert folders
  const folderMap = {};
  for (const f of folders) {
    const { rows } = await db.query(
      `INSERT INTO folders (name, type) VALUES ($1, 'brand') RETURNING id, name`,
      [f.name]
    );
    folderMap[f.name] = rows[0].id;
    console.log(`✓ Folder: ${f.name} (${rows[0].id})`);
  }

  // Insert listings
  for (const l of listings) {
    const folderId = folderMap[l.brand];
    const { rows } = await db.query(
      `INSERT INTO locations (name, address, city, phone, category, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [l.name, l.address, l.city, l.phone, l.category, folderId]
    );
    console.log(`  ✓ Listing: ${l.name} (${rows[0].id})`);
  }

  console.log('\n✅ Seed complete — 3 folders, 10 listings');
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
