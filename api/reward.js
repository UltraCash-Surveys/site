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
    const { user_id, reward, tx_id, status, tx_signature, survey_id } = req.query;

    // 1. SECURITY: Check the TheoremReach Signature
    const appSecret = process.env.TR_SECRET; 
    const checkString = `${tx_id}${user_id}${reward}${appSecret}`;
    const calculatedSignature = crypto.createHash('md5').update(checkString).digest('hex');

    if (calculatedSignature !== tx_signature) {
        console.error("SECURITY BLOCK: Signature Mismatch. User tried to manual-reward.");
        return res.status(401).send("Invalid Signature");
    }

    // 2. Data Validation
    if (!user_id || !reward) {
        return res.status(400).send("Missing parameters.");
    }

    // USER GETS 100% - No more admin profit logic
    const finalReward = Math.floor(Number(reward)); 

    try {
        const userRef = db.ref(`users/${user_id}/points`);
        const logRef = db.ref('admin_logs/earnings').push();
        const statsRef = db.ref('admin_logs/total_stats');

        // 3. Update User Points
        await userRef.transaction((currentPoints) => {
            return (currentPoints || 0) + finalReward;
        });

        // 4. Log the transaction (Admin profit is now 0)
        await logRef.set({
            userId: user_id,
            txId: tx_id || "test",
            surveyId: survey_id || "unknown",
            status: status || "1",
            grossAmount: finalReward,
            userReceived: finalReward,
            profitGenerated: 0, 
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // 5. Update Global Stats
        await statsRef.transaction((current) => {
            const stats = current || { lifetime_profit: 0, total_surveys: 0, paid_out: 0 };
            return {
                lifetime_profit: (stats.lifetime_profit || 0), // No profit added
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