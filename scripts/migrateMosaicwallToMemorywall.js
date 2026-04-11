/**
 * Migration: rename "mosaicwall" → "memorywall" in User.modulePermissions
 *
 * Run once:  node scripts/migrateMosaicwallToMemorywall.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const result = await mongoose.connection
    .collection("users")
    .updateMany(
      { modulePermissions: "mosaicwall" },
      { $set: { "modulePermissions.$[elem]": "memorywall" } },
      { arrayFilters: [{ elem: { $eq: "mosaicwall" } }] }
    );

  console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
