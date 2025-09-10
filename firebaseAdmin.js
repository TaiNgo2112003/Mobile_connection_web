// firebaseAdmin.js
const admin = require('firebase-admin');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON!", err);
    process.exit(1);
  }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  } catch (err) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT_PATH is not valid JSON!", err);
    process.exit(1);
  }
} else {
  try {
    serviceAccount = require('./serviceAccountKey.json'); 
  } catch {
    console.error("❌ No Firebase service account provided!");
    process.exit(1);
  }
}

// ✅ Chỉ init một lần
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = admin;
