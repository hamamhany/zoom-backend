require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();

// ===== إعدادات CORS المحدثة =====
const corsOptions = {
    origin: ['https://read-and-rise-two.vercel.app', 'http://localhost:5173'], // أضف نطاق موقعك هنا
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // تفعيل الطلبات المسبقة (Pre-flight)
app.use(express.json());

// ===== المتغيرات البيئية =====
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZOOM_SDK_KEY = process.env.ZOOM_SDK_KEY;
const ZOOM_SDK_SECRET = process.env.ZOOM_SDK_SECRET;

// ===== توليد Access Token =====
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken;

    try {
        const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
        const response = await axios.post(
            'https://zoom.us/oauth/token',
            'grant_type=account_credentials',
            {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        cachedToken = response.data.access_token;
        tokenExpiry = now + (response.data.expires_in * 1000) - 60000;
        return cachedToken;
    } catch (error) {
        throw new Error('فشل الحصول على توكن المصادقة');
    }
}

// ===== توليد توقيع SDK =====
function generateSignature(meetingNumber, role = 0) {
    const iat = Math.floor(Date.now() / 1000) - 30;
    const exp = iat + 60 * 60 * 2;
    const payload = { sdkKey: ZOOM_SDK_KEY, mn: meetingNumber, role: role, iat, exp, tokenExp: exp };
    return jwt.sign(payload, ZOOM_SDK_SECRET, { algorithm: 'HS256' });
}

// ===== المسارات (Routes) =====
app.post('/api/create-meeting', async (req, res) => {
    try {
        const { topic, startTime, duration = 60 } = req.body;
        const accessToken = await getAccessToken();

        const meetingResponse = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            { topic, type: 2, start_time: startTime, duration, timezone: 'Asia/Amman', settings: { join_before_host: true, waiting_room: false } },
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );

        const meeting = meetingResponse.data;
        res.json({
            success: true,
            meeting_number: meeting.id.toString(),
            join_url: meeting.join_url,
            password: meeting.password,
            signature: generateSignature(meeting.id.toString(), 0)
        });
    } catch (error) {
        res.status(500).json({ error: 'فشل إنشاء الاجتماع', details: error.message });
    }
});

app.post('/api/signature', async (req, res) => {
    const { meetingNumber, role = 0 } = req.body;
    res.json({ signature: generateSignature(meetingNumber, role) });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`));