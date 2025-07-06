const mongoose = require("mongoose");
const User = require("../models/User");
const env = require("../config/env");

const seedAdmin = async () => {
  try {
    const adminEmail = env.auth.adminEmail?.toLowerCase();
    const adminPassword = env.auth.adminPassword

    if (!adminEmail || !adminPassword) {
      console.error("❌ ADMIN_EMAIL or ADMIN_PASSWORD is missing in environment variables.");
      return;
    }

    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log("Admin already exists:", existingAdmin.email);
    } else {
      const admin = new User({
        name: "Admin User",
        email: adminEmail,
        password: adminPassword,
        role: "admin",
        business: null,
        modulePermissions: [],
      });

      await admin.save();
      console.log("🚀 Admin user seeded successfully!");
    }
  } catch (error) {
    console.error("❌ Error seeding admin user:", error);
  }
};

module.exports = seedAdmin;
