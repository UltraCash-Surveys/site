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

    const data = req.method === "POST" ? req.body : req.query;

    let { tr_user_id, tr_reward, tr_tx_id, hash } = data;

    const cUserID = Array.isArray(tr_user_id) ? tr_user_id.at(-1) : tr_user_id;
    const cTxID   = Array.isArray(tr_tx_id)   ? tr_tx_id.at(-1)   : tr_tx_id;
    const cReward = Array.isArray(tr_reward)  ? tr_reward.at(-1)  : tr_reward;
    const cHash   = Array.isArray(hash)       ? hash.at(-1)       : hash;

    const secret = process.env.TR_SECRET;

    // 1️⃣ Generate MD5 HEX first
    const md5Hex = crypto
    .createHash('md5')
    .update(`${cUserID}${cReward}${cTxID}${secret}`, 'utf8')
    .digest('hex');

    // 2️⃣ Convert HEX to binary buffer
    const buffer = Buffer.from(md5Hex, 'hex');

    // 3️⃣ Convert to base64url
    const expected = buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

    console.log("String used:", `${cUserID}${cReward}${cTxID}${secret}`);
    console.log("MD5 Hex:", md5Hex);
    console.log("Received:", cHash);
    console.log("Calculated:", expected);

    if (expected !== cHash) {
    return res.status(401).send("Invalid Signature");
    }

    const finalReward = Math.floor(Number(cReward)); 

    try {
        const userRef = db.ref(`users/${cUserID}/points`);
        const logRef = db.ref('admin_logs/earnings').push();
        const statsRef = db.ref('admin_logs/total_stats');

        // Update User
        await userRef.transaction((curr) => (curr || 0) + finalReward);

        // Log it
        await logRef.set({
            userId: cUserID,
            txId: cTxID,
            surveyId: survey_id || "unknown",
            status: cStatus,
            userReceived: finalReward,
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // Update Global Stats
        await statsRef.transaction((curr) => {
            const s = curr || { lifetime_profit: 0, total_surveys: 0, paid_out: 0 };
            return {
                ...s,
                paid_out: (s.paid_out || 0) + finalReward,
                total_surveys: (s.total_surveys || 0) + 1
            };
        });

        return res.status(200).send("OK");

    } catch (error) {
        console.error("DB Error:", error);
        return res.status(500).send("DB Error");
    }
}