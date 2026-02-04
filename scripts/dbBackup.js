/**
 * DB Backup Script - Saves EventPassSuite-db snapshot to S3
 * Runs every 30 min. Retains ~7 days; deletes the oldest backup beyond 7 days on each run.
 * S3 path: EventPassDB-Backup/<timestamp>/EventPassSuite-db.archive
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const AWS = require("aws-sdk");

const S3_PREFIX = "EventPassDB-Backup"; 
const DB_NAME = "EventPassSuite-db";
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const RETENTION_DAYS = 7;

function getTimestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function runMongodump(uri, outPath) {
  const cleanUri = (uri || "").trim();
  return new Promise((resolve, reject) => {
    const child = spawn("mongodump", [`--uri=${cleanUri}`, `--archive=${outPath}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongodump exited ${code}: ${stderr}`));
    });
    child.on("error", reject);
  });
}

async function uploadToS3(filePath, s3Key) {
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("AWS env vars (AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) required");
  }

  AWS.config.update({ region, accessKeyId, secretAccessKey });
  const s3 = new AWS.S3();
  const body = await fs.readFile(filePath);

  await s3
    .upload({
      Bucket: bucket,
      Key: s3Key,
      Body: body,
      ContentType: "application/octet-stream",
    })
    .promise();
}

async function getS3Client() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) return null;

  AWS.config.update({ region, accessKeyId, secretAccessKey });
  return { s3: new AWS.S3(), bucket };
}

function parseTimestampFromKey(key) {
  const match = key.match(/EventPassDB-Backup\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\//);
  if (!match) return null;
  const s = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
  return new Date(s);
}

async function deleteOldestBackupOlderThan(retentionDays) {
  const client = await getS3Client();
  if (!client) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const list = await client.s3
    .listObjectsV2({
      Bucket: client.bucket,
      Prefix: `${S3_PREFIX}/`,
      Delimiter: "/",
    })
    .promise();

  const prefixes = list.CommonPrefixes || [];
  const toDelete = prefixes
    .map((p) => {
      const key = p.Prefix + `${DB_NAME}.archive`;
      const parsed = parseTimestampFromKey(key);
      return { key, date: parsed };
    })
    .filter((x) => x.date && x.date.getTime() < cutoff)
    .sort((a, b) => a.date - b.date);

  if (toDelete.length === 0) return;

  const { key } = toDelete[0];
  try {
    await client.s3.deleteObject({ Bucket: client.bucket, Key: key }).promise();
    console.log(`[${new Date().toISOString()}] Deleted backup older than ${retentionDays} days: ${key}`);
  } catch (err) {
    if (err.code !== "NoSuchKey") console.warn("Failed to delete old backup:", err.message);
  }
}

async function runBackup() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI env var required");
  }

  const timestamp = getTimestamp();
  const tempDir = path.join(__dirname, "..", "tmp", "db-backup");
  const archivePath = path.join(tempDir, `${DB_NAME}.archive`);

  await fs.mkdir(tempDir, { recursive: true });

  try {
    console.log(`[${new Date().toISOString()}] Starting backup...`);
    await runMongodump(mongoUri, archivePath);

    const s3Key = `${S3_PREFIX}/${timestamp}/${DB_NAME}.archive`;
    await uploadToS3(archivePath, s3Key);

    console.log(`[${new Date().toISOString()}] Backup uploaded to S3: ${s3Key}`);

    await deleteOldestBackupOlderThan(RETENTION_DAYS);
  } finally {
    try {
      await fs.unlink(archivePath);
    } catch (_) { }
  }
}

async function main() {
  const isDaemon = process.argv.includes("--daemon");

  if (isDaemon) {
    console.log("DB backup daemon: running every 30 minutes, retaining 7 days");
    await runBackup();
    setInterval(runBackup, BACKUP_INTERVAL_MS);
  } else {
    await runBackup();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Backup failed:", err.message);
  process.exit(1);
});
