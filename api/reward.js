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
        return String(value).trim();
    };

    const cUserID = clean(tr_user_id);
    const cReward = clean(tr_reward);   // IMPORTANT: use raw string for hashing
    const cTxID = clean(tr_tx_id);
    const cHash = clean(hash);
    const cStatus = clean(status) || "1";
    const secret = process.env.TR_SECRET ? process.env.TR_SECRET.trim() : "";

    /* 
    Correct hash format for TheoremReach:
    MD5 -> Base64 -> URL safe -> remove =
    */

    const rawHash = Array.isArray(hash) ? hash[hash.length - 1] : hash;

    const md5Base64Url = (str) =>
        crypto
            .createHash('md5')
            .update(str, 'utf8')
            .digest('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

    const stringToHash = `${cTxID}${cUserID}${cReward}TESTSECRET`;

    console.log("String used:", stringToHash);
    console.log("Received:", rawHash);

    const expected = md5Base64Url(stringToHash);

    console.log("Calculated:", expected);

    if (expected !== rawHash) {
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