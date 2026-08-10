require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// ===== المتغيرات البيئية =====
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZOOM_SDK_KEY = process.env.ZOOM_SDK_KEY;
const ZOOM_SDK_SECRET = process.env.ZOOM_SDK_SECRET;

// ===== توليد Access Token (Server-to-Server OAuth) =====
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
        return cachedToken;
    }

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
        tokenExpiry = now + (response.data.expires_in * 1000) - 60000; // هامش أمان دقيقة
        return cachedToken;
    } catch (error) {
        console.error('❌ فشل الحصول على Access Token:', error.response?.data || error.message);
        throw new Error('فشل الحصول على توكن المصادقة');
    }
}

// ===== توليد توقيع Meeting SDK (للاستخدام في الانضمام) =====
function generateSignature(meetingNumber, role = 1) {
    const iat = Math.floor(Date.now() / 1000) - 7200;
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 2;

    const payload = {
        sdkKey: ZOOM_SDK_KEY,
        mn: meetingNumber,
        role: role,
        iat: iat,
        exp: exp,
        tokenExp: exp
    };

    return jwt.sign(payload, ZOOM_SDK_SECRET, { algorithm: 'HS256' });
}

// ===== نقطة النهاية: إنشاء اجتماع جديد =====
app.post('/api/create-meeting', async (req, res) => {
    try {
        const { topic, startTime, duration = 60, classId, teacherId } = req.body;

        if (!topic || !startTime) {
            return res.status(400).json({ error: 'topic و startTime مطلوبان' });
        }

        const accessToken = await getAccessToken();

        const meetingResponse = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic: topic,
                type: 2, // مجدول
                start_time: startTime,
                duration: duration,
                timezone: 'Asia/Amman',
                settings: {
                    join_before_host: true,
                    mute_upon_entry: true,
                    waiting_room: false,
                    auto_recording: 'none'
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const meeting = meetingResponse.data;
        const signature = generateSignature(meeting.id.toString(), 0); // 0 = مشارك

        res.json({
            success: true,
            meeting_number: meeting.id.toString(),
            join_url: meeting.join_url,
            password: meeting.password || '',
            signature: signature,
            start_time: meeting.start_time,
            topic: meeting.topic
        });

    } catch (error) {
        console.error('❌ فشل إنشاء الاجتماع:', error.response?.data || error.message);
        res.status(500).json({
            error: 'فشل إنشاء الاجتماع',
            details: error.response?.data?.message || error.message
        });
    }
});

// ===== نقطة النهاية: توليد توقيع فقط (للانضمام) =====
app.post('/api/signature', async (req, res) => {
    try {
        const { meetingNumber, role = 0 } = req.body;
        if (!meetingNumber) {
            return res.status(400).json({ error: 'meetingNumber مطلوب' });
        }
        const signature = generateSignature(meetingNumber, role);
        res.json({ signature });
    } catch (error) {
        console.error('❌ فشل توليد التوقيع:', error.message);
        res.status(500).json({ error: 'فشل توليد التوقيع' });
    }
});

// ===== نقطة الصحة (للاختبار) =====
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== تشغيل الخادم =====
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
});