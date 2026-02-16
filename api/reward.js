const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
  });
}

const db = admin.database();

export default async function handler(req, res) {
    // 1. Capture the raw query parameters
    let { tr_user_id, tr_reward, tr_tx_id, hash, status, survey_id } = req.query;

    // 2. THE CLEANER: This strips away junk like "[TX_ID]," and handles arrays
    const clean = (val) => {
        if (!val) return "";
        // If TR sends an array (like in your logs), take the last real value
        const value = Array.isArray(val) ? val[val.length - 1] : val;
        // Strip out anything in brackets and commas
        return String(value).replace(/\[.*?\]/g, '').replace(/,/g, '').trim();
    };

    const cUserID = clean(tr_user_id);
    const cReward = clean(tr_reward);
    const cTxID = clean(tr_tx_id);
    const cHash = clean(hash);

    // 3. Security Check logic
    const appSecret = process.env.TR_SECRET ? process.env.TR_SECRET.trim() : ""; 
    const checkString = `${cTxID}${cUserID}${cReward}${appSecret}`;
    
    // This creates the Base64 version with the specific URL-safe characters TheoremReach uses
    const calculatedSignature = crypto.createHash('md5')
        .update(checkString)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    // These logs will now show PURE data in Vercel
    console.log("CheckString:", checkString);
    console.log("Calculated:", calculatedSignature);
    console.log("Received Hash:", cHash);

    if (calculatedSignature !== cHash) {
        console.error("Signature Mismatch");
        return res.status(401).send("Invalid Signature");
    }

    // 4. Data Validation
    if (!cUserID || !cReward) {
        return res.status(400).send("Missing parameters.");
    }

    const finalReward = Math.floor(Number(cReward)); 

    try {
        const userRef = db.ref(`users/${cUserID}/points`);
        const logRef = db.ref('admin_logs/earnings').push();
        const statsRef = db.ref('admin_logs/total_stats');

        // 5. Update User Points
        await userRef.transaction((currentPoints) => {
            return (currentPoints || 0) + finalReward;
        });

        // 6. Log the transaction
        await logRef.set({
            userId: cUserID,
            txId: cTxID || "test",
            surveyId: survey_id || "unknown",
            status: status || "1",
            grossAmount: finalReward,
            userReceived: finalReward,
            profitGenerated: 0, 
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // 7. Update Global Stats
        await statsRef.transaction((current) => {
            const stats = current || { lifetime_profit: 0, total_surveys: 0, paid_out: 0 };
            return {
                lifetime_profit: (stats.lifetime_profit || 0),
                paid_out: (stats.paid_out || 0) + finalReward,
                total_surveys: (stats.total_surveys || 0) + 1
            };
        });

        return res.status(200).send("OK");

    } catch (error) {
        console.error("Database Error:", error);
        return res.status(500).send("DB Error");
    }
}