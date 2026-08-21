const express = require('express');
const cors = require('cors');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
require('dotenv').config();

const app = express();

// ------------------- CORS Configuration -------------------
const corsOptions = {
    origin: [
        'https://read-and-rise-two.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ------------------- Health Check -------------------
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ------------------- توليد توكن Agora -------------------
// كل طالب/معلم لازم ياخذ توكن جديد كل ما يفتح الحصة (التوكن صالح لمدة محدودة لأسباب أمنية)
app.post('/api/generate-agora-token', (req, res) => {
    try {
        const appID = process.env.AGORA_APP_ID;
        const appCertificate = process.env.AGORA_APP_CERTIFICATE;

        if (!appID || !appCertificate) {
            throw new Error('Missing Agora credentials (AGORA_APP_ID or AGORA_APP_CERTIFICATE) on the server');
        }

        // channelName = اسم الغرفة اللي بيدخل عليها الكل (معلم وطلاب) بنفس الاسم بالضبط
        const { channelName } = req.body;
        if (!channelName || typeof channelName !== 'string') {
            return res.status(400).json({ error: 'channelName is required' });
        }

        // uid = رقم مستخدم عشوائي داخل الغرفة (بيولده السيرفر، ما إلو علاقة بحساب المستخدم بالتطبيق)
        const uid = Math.floor(Math.random() * 1000000) + 1;

        // كل المستخدمين (معلم وطلاب) بيقدروا يبثوا صوت وفيديو، زي حصة تفاعلية عادية
        const role = RtcRole.PUBLISHER;

        const expirationTimeInSeconds = 60 * 60 * 2; // صلاحية التوكن: ساعتين
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

        const token = RtcTokenBuilder.buildTokenWithUid(
            appID,
            appCertificate,
            channelName,
            uid,
            role,
            privilegeExpiredTs
        );

        res.status(200).json({
            token,
            appId: appID,
            channelName,
            uid
        });
    } catch (error) {
        console.error('❌ Error generating Agora token:', error);
        res.status(500).json({ error: error.message || 'Failed to generate Agora token' });
    }
});

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
    console.log(`✅ Generate Agora token: POST http://localhost:${PORT}/api/generate-agora-token`);
});
