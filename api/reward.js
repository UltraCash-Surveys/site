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
    // 1. Get the parameters exactly as TR sends them
    const { tr_user_id, tr_reward, tr_tx_id, hash, status, survey_id } = req.query;

    const appSecret = process.env.TR_SECRET ? process.env.TR_SECRET.trim() : ""; 
    const checkString = `${tr_tx_id}${tr_user_id}${tr_reward}${appSecret}`;
    const calculatedSignature = crypto.createHash('md5').update(checkString).digest('hex');

    // 2. Security Check (The only one you need)
    if (calculatedSignature !== hash) {
        console.error("Signature Mismatch");
        return res.status(401).send("Invalid Signature");
    }

    // 3. Data Validation (Using the correct names)
    if (!tr_user_id || !tr_reward) {
        return res.status(400).send("Missing parameters.");
    }

    const finalReward = Math.floor(Number(tr_reward)); 

    try {
        const userRef = db.ref(`users/${tr_user_id}/points`);
        const logRef = db.ref('admin_logs/earnings').push();
        const statsRef = db.ref('admin_logs/total_stats');

        // 4. Update User Points
        await userRef.transaction((currentPoints) => {
            return (currentPoints || 0) + finalReward;
        });

        // 5. Log the transaction
        await logRef.set({
            userId: tr_user_id,
            txId: tr_tx_id || "test",
            surveyId: survey_id || "unknown",
            status: status || "1",
            grossAmount: finalReward,
            userReceived: finalReward,
            profitGenerated: 0, 
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // 6. Update Global Stats
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