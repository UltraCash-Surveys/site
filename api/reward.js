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
    let { tr_user_id, tr_reward, tr_tx_id, hash, status, survey_id } = req.query;

    const clean = (val) => {
        if (!val) return "";
        const value = Array.isArray(val) ? val[val.length - 1] : val;
        return String(value).replace(/\[.*?\]/g, '').replace(/,/g, '').trim();
    };

    const cUserID = clean(tr_user_id);
    const cReward = clean(tr_reward);
    const cTxID = clean(tr_tx_id);
    const cHash = clean(hash);
    const cStatus = clean(status) || "1";
    const secret = process.env.TR_SECRET ? process.env.TR_SECRET.trim() : "";

    // Generate the 3 most likely hash versions
    const md5B64 = (str) => crypto.createHash('md5').update(str).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    
    const attempts = [
        md5B64(`${cTxID}${cUserID}${cReward}${secret}`),         // Order 1
        md5B64(`${cTxID}${cUserID}${cReward}${cStatus}${secret}`), // Order 2
        md5B64(`${secret}${cTxID}${cUserID}${cReward}`)          // Order 3
    ];

    const isAuthorized = attempts.includes(cHash);

    // DEBUG LOG
    console.log("Expected:", cHash);
    console.log("Calculated Attempts:", attempts);

    // --- SECURITY OVERRIDE ---
    // If you are tired of 401s and want to just test the database, 
    // you can change 'isAuthorized' to 'true' below temporarily.
    if (!isAuthorized) {
        console.error("Signature Mismatch. Check TR_SECRET in Vercel.");
        return res.status(401).send("Invalid Signature");
    }

    if (!cUserID || !cReward) return res.status(400).send("Missing Params");

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