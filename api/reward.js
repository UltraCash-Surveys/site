const admin = require('firebase-admin');
const crypto = require('crypto'); // Built-in Node module

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
    // TheoremReach uses these specific keys
    const { user_id, reward, tx_id, status, tx_signature, survey_id } = req.query;

    // 1. SECURITY CHECK: Verify the Signature
    const appSecret = process.env.TR_SECRET; 
    
    // TR Logic: MD5 of (tx_id + user_id + reward + secret)
    const checkString = `${tx_id}${user_id}${reward}${appSecret}`;
    const calculatedSignature = crypto.createHash('md5').update(checkString).digest('hex');

    if (calculatedSignature !== tx_signature) {
        console.error("ALERT: Unauthorized Postback Attempt (Signature Mismatch)");
        return res.status(401).send("Invalid Signature");
    }

    // 2. Data Validation
    if (!user_id || !reward) {
        return res.status(400).send("Missing parameters.");
    }

    const userShare = 0.70; 
    const finalReward = Math.floor(Number(reward) * userShare); 
    const adminProfit = Number(reward) - finalReward;

    try {
        const userRef = db.ref(`users/${user_id}/points`);
        const logRef = db.ref('admin_logs/earnings').push();
        const statsRef = db.ref('admin_logs/total_stats');

        // 3. Update User Points
        await userRef.transaction((currentPoints) => {
            return (currentPoints || 0) + finalReward;
        });

        // 4. Log the transaction
        await logRef.set({
            userId: user_id,
            txId: tx_id || "test",
            surveyId: survey_id || "unknown",
            status: status || "1",
            grossAmount: Number(reward),
            userReceived: finalReward,
            profitGenerated: adminProfit,
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // 5. Update Global Stats
        await statsRef.transaction((current) => {
            const stats = current || { lifetime_profit: 0, total_surveys: 0, paid_out: 0 };
            return {
                lifetime_profit: (stats.lifetime_profit || 0) + adminProfit,
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