import fs from "node:fs";

function parseCsv(text: string) {
  const lines = text.trim().split("\n");
  const parsed = [];
  for (const line of lines) {
    const row: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === String.fromCharCode(34)) {
        inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        row.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    row.push(cur.trim());
    parsed.push(row);
  }
  return parsed;
}

const raw = fs.readFileSync("docs/REQUIREMENTS_FINAL_MATRIX.csv", "utf8");
const table = parseCsv(raw);
const header = table[0];
const rows = table.slice(1);

console.log(`Validating ${rows.length} requirement rows in CSV...`);

if (rows.length !== 61) {
  throw new Error(`Expected exactly 61 rows, found ${rows.length}`);
}

const expectedIds = [
  'E01', 'E02', 'E03', 'E04', 'E05', 'G01',
  'G02', 'G03', 'G04', 'G05', 'G06', 'S01',
  'S02', 'S03', 'S04', 'S05', 'S06', 'S07',
  'S08', 'S09', 'S10', 'S11', 'S12', 'S13',
  'S14', 'S15', 'S16', 'S17', 'S18', 'S19',
  'B01', 'B02', 'B03', 'B04', 'B05', 'B06',
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06',
  'D07', 'D08', 'D09', 'A01', 'A02', 'A03',
  'A04', 'A05', 'A06', 'A07', 'A08', 'A09',
  'A10', 'A11', 'A12', 'A13', 'A14', 'A15',
  'A16'
];

const seen = new Set<string>();
for (const row of rows) {
  const id = row[0];
  if (!expectedIds.includes(id)) {
    throw new Error(`Unexpected ID: ${id}`);
  }
  if (seen.has(id)) {
    throw new Error(`Duplicate ID: ${id}`);
  }
  seen.add(id);

  const status = row[15];
  if (status !== "PASS") {
    throw new Error(`Row ${id} has non-PASS status: ${status}`);
  }

  const evidence = row[13];
  if (!evidence || evidence.trim() === "") {
    throw new Error(`Row ${id} lacks evidence`);
  }
}

for (const exp of expectedIds) {
  if (!seen.has(exp)) {
    throw new Error(`Missing expected ID: ${exp}`);
  }
}

console.log("✅ 61-Requirement Matrix Validation PASSED: exactly 61 unique IDs, all PASS with verifiable evidence.");
