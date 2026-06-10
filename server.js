const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parsing (using larger limit for CSV text uploads)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static HTML/JS files from the root directory
app.use(express.static(__dirname));

// Initialize PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Supabase/hosted databases usually
  }
});

// Handle pool errors so the server doesn't crash on idle connection losses
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client:', err.message);
});

// Default Mock Database Seeding Data for Enrollments
const defaultMockRecords = [
  {
    name: "Ahmad K. P.",
    mobile: "9847123456",
    organization: "Kerala Muslim Jama'ath",
    level: "District",
    district: "Kozhikode",
    zone: null,
    circle: null,
    position: "President",
    role: "Coordinator"
  },
  {
    name: "Muhammad Shafi",
    mobile: "8594234567",
    organization: "SYS",
    level: "Zone",
    district: "Malappuram",
    zone: "Malappuram East",
    circle: null,
    position: "General Secretary",
    role: "Coordinator"
  },
  {
    name: "Faisal Rahman",
    mobile: "7012345678",
    organization: "SSF",
    level: "Circle",
    district: "Kozhikode",
    zone: "Kozhikode North",
    circle: "City",
    position: "Member",
    role: "Member"
  },
  {
    name: "Zainudheen C.",
    mobile: "9946456789",
    organization: "Kerala Muslim Jama'ath",
    level: "Zone",
    district: "Kozhikode",
    zone: "Kozhikode South",
    circle: null,
    position: "Finance Secretary",
    role: "Coordinator"
  },
  {
    name: "Anas V. H.",
    mobile: "9048567890",
    organization: "SSF",
    level: "Circle",
    district: "Malappuram",
    zone: "Malappuram West",
    circle: "Tirur",
    position: "President",
    role: "Member"
  }
];

// Default Seeding Data for Locations Hierarchy
const defaultLocations = [
  { district: "Kozhikode", zone: "Kozhikode North", circle: "City" },
  { district: "Kozhikode", zone: "Kozhikode North", circle: "Chevayur" },
  { district: "Kozhikode", zone: "Kozhikode South", circle: "Feroke" },
  { district: "Kozhikode", zone: "Kozhikode South", circle: "Pantheerankavu" },
  { district: "Kozhikode", zone: "Vadakara", circle: "Vadakara Town" },
  { district: "Kozhikode", zone: "Vadakara", circle: "Orkkatteri" },
  { district: "Malappuram", zone: "Malappuram East", circle: "Malappuram Town" },
  { district: "Malappuram", zone: "Malappuram East", circle: "Manjeri" },
  { district: "Malappuram", zone: "Malappuram West", circle: "Tirur" },
  { district: "Malappuram", zone: "Malappuram West", circle: "Kottakkal" }
];

// Helper to seed the database with mock records
async function seedDatabase() {
  try {
    const res = await pool.query('SELECT COUNT(*) FROM enrollments');
    const count = parseInt(res.rows[0].count, 10);
    
    if (count === 0) {
      console.log('Database table is empty. Seeding mock records...');
      const insertQuery = `
        INSERT INTO enrollments (name, mobile, organization, level, district, zone, circle, position, role)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      for (const rec of defaultMockRecords) {
        await pool.query(insertQuery, [
          rec.name,
          rec.mobile,
          rec.organization,
          rec.level,
          rec.district,
          rec.zone,
          rec.circle,
          rec.position,
          rec.role
        ]);
      }
      console.log('Mock records seeded successfully.');
    } else {
      console.log(`Database already contains ${count} records. Skipping seeding.`);
    }
  } catch (err) {
    console.error('Error seeding database:', err.message);
  }
}

// Helper to seed locations table
async function seedLocations() {
  try {
    const res = await pool.query('SELECT COUNT(*) FROM locations');
    const count = parseInt(res.rows[0].count, 10);
    
    if (count === 0) {
      console.log('Locations table is empty. Seeding default location hierarchy...');
      const insertQuery = `
        INSERT INTO locations (district, zone, circle)
        VALUES ($1, $2, $3)
      `;
      for (const loc of defaultLocations) {
        await pool.query(insertQuery, [loc.district, loc.zone, loc.circle]);
      }
      console.log('Default location hierarchy seeded successfully.');
    } else {
      console.log(`Locations table already contains ${count} records. Skipping seeding.`);
    }
  } catch (err) {
    console.error('Error seeding locations:', err.message);
  }
}

// Database schema migration/initialization with retry logic
async function initDB(retries = 5, delay = 5000) {
  const createEnrollmentsTable = `
    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      mobile VARCHAR(15) NOT NULL,
      organization VARCHAR(100) NOT NULL,
      level VARCHAR(50) NOT NULL,
      district VARCHAR(100) NOT NULL,
      zone VARCHAR(100),
      circle VARCHAR(100),
      position VARCHAR(100) NOT NULL,
      role VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const createLocationsTable = `
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      district VARCHAR(255) NOT NULL,
      zone VARCHAR(255) NOT NULL,
      circle VARCHAR(255) NOT NULL
    );
  `;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Database initialization attempt ${attempt} of ${retries}...`);
      await pool.query(createEnrollmentsTable);
      console.log('Table "enrollments" verified.');
      await pool.query(createLocationsTable);
      console.log('Table "locations" verified.');
      await seedLocations();
      console.log('Database initialization completed successfully.');
      return; // Exit function on success
    } catch (err) {
      console.error(`Database connection or initialization error (attempt ${attempt}):`, err.message);
      if (attempt < retries) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('All database initialization attempts failed. Server remains running without active database connection.');
      }
    }
  }
}

// Helper to parse CSV text
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !lines[0].trim()) {
    throw new Error('CSV file is empty.');
  }

  // Parse header line (case-insensitive, strip quotes)
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  
  const districtIdx = headers.indexOf('district');
  const zoneIdx = headers.indexOf('zone');
  const circleIdx = headers.indexOf('circle');
  
  if (districtIdx === -1 || zoneIdx === -1 || circleIdx === -1) {
    throw new Error('CSV must contain "District", "Zone", and "Circle" columns.');
  }
  
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Split line by commas, respecting double quotes
    let cols = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.trim().replace(/^"|"$/g, ''));

    if (cols.length < headers.length) continue;
    
    const district = cols[districtIdx];
    const zone = cols[zoneIdx];
    const circle = cols[circleIdx];

    if (!district || !zone || !circle) {
      throw new Error(`Row ${i + 1} contains empty values. District, Zone, and Circle are all required.`);
    }
    
    records.push({ district, zone, circle });
  }
  
  if (records.length === 0) {
    throw new Error('CSV contains no data rows.');
  }
  return records;
}

// REST API: GET structured location hierarchy
app.get('/api/locations', async (req, res) => {
  try {
    const result = await pool.query('SELECT district, zone, circle FROM locations ORDER BY district ASC, zone ASC, circle ASC');
    const hierarchy = {};
    
    result.rows.forEach(row => {
      const dist = row.district;
      const zone = row.zone;
      const circ = row.circle;
      
      if (!hierarchy[dist]) {
        hierarchy[dist] = {};
      }
      if (!hierarchy[dist][zone]) {
        hierarchy[dist][zone] = [];
      }
      if (!hierarchy[dist][zone].includes(circ)) {
        hierarchy[dist][zone].push(circ);
      }
    });
    
    res.json(hierarchy);
  } catch (err) {
    console.error('GET /api/locations error:', err.message);
    res.status(500).json({ error: 'Server error retrieving locations.' });
  }
});

// REST API: POST upload locations CSV
app.post('/api/locations/upload', async (req, res) => {
  const { csvText } = req.body;
  if (!csvText) {
    return res.status(400).json({ error: 'No CSV content provided.' });
  }
  
  let records;
  try {
    records = parseCSV(csvText);
  } catch (parseErr) {
    return res.status(400).json({ error: parseErr.message });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE locations RESTART IDENTITY');
    
    const insertQuery = 'INSERT INTO locations (district, zone, circle) VALUES ($1, $2, $3)';
    for (const rec of records) {
      await client.query(insertQuery, [rec.district, rec.zone, rec.circle]);
    }
    
    await client.query('COMMIT');
    res.json({ message: `Successfully imported ${records.length} locations.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/locations/upload database error:', err.message);
    res.status(500).json({ error: 'Database transaction failed. Locations not updated.' });
  } finally {
    client.release();
  }
});

// REST API: GET all enrollments
app.get('/api/enrollments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM enrollments ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/enrollments error:', err.message);
    res.status(500).json({ error: 'Server error retrieving records.' });
  }
});

// REST API: POST a new enrollment with validation
app.post('/api/enrollments', async (req, res) => {
  const { name, mobile, organization, level, district, zone, circle, position, role } = req.body;

  // Server-side validation
  const errors = {};

  if (!name || name.trim().length < 3) {
    errors.name = 'Name must be at least 3 characters.';
  }
  
  const mobileRegex = /^[6-9]\d{9}$/;
  if (!mobile || !mobileRegex.test(mobile.trim())) {
    errors.mobile = 'Enter a valid 10-digit mobile number.';
  }

  if (!organization) {
    errors.organization = 'Please select an organization.';
  }

  const validLevels = ['District', 'Zone', 'Circle'];
  if (!level || !validLevels.includes(level)) {
    errors.level = 'Level is required.';
  }

  if (!district) {
    errors.district = 'District is required.';
  }

  if ((level === 'Zone' || level === 'Circle') && !zone) {
    errors.zone = 'Zone is required.';
  }

  if (level === 'Circle' && !circle) {
    errors.circle = 'Circle is required.';
  }

  if (!position) {
    errors.position = 'Position is required.';
  }

  if (!role) {
    errors.role = 'Please select a role.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const insertQuery = `
      INSERT INTO enrollments (name, mobile, organization, level, district, zone, circle, position, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const values = [
      name.trim(),
      mobile.trim(),
      organization,
      level,
      district,
      (level === 'Zone' || level === 'Circle') ? zone : null,
      (level === 'Circle') ? circle : null,
      position,
      role
    ];

    const result = await pool.query(insertQuery, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/enrollments error:', err.message);
    res.status(500).json({ error: 'Server error saving record.' });
  }
});

// REST API: POST reset/clear database (remove all submissions)
app.post('/api/enrollments/reset', async (req, res) => {
  try {
    // Delete all records and restart identity sequence
    await pool.query('TRUNCATE TABLE enrollments RESTART IDENTITY');
    console.log('Database truncated (cleared) by admin request.');
    res.json({ message: 'Database cleared successfully.' });
  } catch (err) {
    console.error('POST /api/enrollments/reset error:', err.message);
    res.status(500).json({ error: 'Server error clearing database.' });
  }
});

// Catch-all route to serve index.html for undefined routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Express Server immediately and initialize DB in background
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  initDB(); // Non-blocking background execution
});
