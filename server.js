const express = require('express');
const cors = require('cors');
const axios = require('axios');
const KJUR = require('jsrsasign');
require('dotenv').config();

const app = express();

// ------------------- CORS Configuration -------------------
const corsOptions = {
    origin: [
        'https://read-and-rise-two.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ------------------- Health Check -------------------
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// ------------------- Zoom Access Token -------------------
async function getZoomAccessToken() {
    try {
        const credentials = Buffer.from(
            `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
        ).toString('base64');

        const response = await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
            {},
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting Zoom access token:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with Zoom');
    }
}

// ------------------- 1. Generate Zoom Signature -------------------
app.post('/api/generate-signature', (req, res) => {
    try {
        const { meetingNumber, role } = req.body;

        const cleanMeetingNumber = String(meetingNumber || '').replace(/\D/g, '');

        if (!cleanMeetingNumber) {
            return res.status(400).json({ error: 'Meeting number is required and must be valid' });
        }

        // استخدام المفاتيح من البيئة (نفس مفاتيح Zoom المستخدمة للـ OAuth)
        const clientId = process.env.ZOOM_CLIENT_ID || process.env.ZOOM_SDK_KEY;
        const clientSecret = process.env.ZOOM_CLIENT_SECRET || process.env.ZOOM_SDK_SECRET;

        if (!clientId || !clientSecret) {
            console.error('Missing Zoom credentials for signature generation');
            return res.status(500).json({ error: 'Server configuration error: missing Zoom credentials' });
        }

        const iat = Math.floor(Date.now() / 1000) - 30;
        const exp = iat + 60 * 60 * 2; // صلاحية ساعتين

        const oHeader = { alg: 'HS256', typ: 'JWT' };
        const oPayload = {
            iss: clientId,
            appKey: clientId,
            sdkKey: clientId,
            mn: cleanMeetingNumber,
            role: role || 0,
            iat: iat,
            exp: exp,
            tokenExp: exp
        };

        const sHeader = JSON.stringify(oHeader);
        const sPayload = JSON.stringify(oPayload);
        const signature = KJUR.jws.JWS.sign("HS256", sHeader, sPayload, clientSecret);

        res.status(200).json({
            signature: signature,
            clientId: clientId,
            sdkKey: clientId,
            meetingNumber: cleanMeetingNumber
        });
    } catch (error) {
        console.error('Error generating signature:', error);
        res.status(500).json({ error: 'Failed to generate signature' });
    }
});

// ------------------- 2. Create Zoom Meeting -------------------
app.post('/api/create-meeting', async (req, res) => {
    try {
        const { topic, start_time, duration, classId, teacherId } = req.body;

        // الحصول على رمز المصادقة من Zoom
        const accessToken = await getZoomAccessToken();

        // إنشاء الاجتماع
        const response = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic: topic || 'Read and Rise Meeting',
                type: 2, // Scheduled meeting
                start_time: start_time || new Date().toISOString(),
                duration: duration || 30,
                timezone: 'Asia/Amman',
                settings: {
                    host_video: true,
                    participant_video: true,
                    waiting_room: false,
                    join_before_host: true,
                    jbh_time: 0,
                    mute_upon_entry: true,
                    approval_type: 0,
                    registration_type: 1,
                    audio: 'both',
                    auto_recording: 'none',
                    enforce_login: false,
                    enforce_login_domains: '',
                    alternative_hosts: '',
                    close_registration: false,
                    show_share_button: true,
                    allow_multiple_devices: false,
                    registrants_confirmation_email: true,
                    request_permission_to_unmute: true
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const meetingData = response.data;

        // ✅ توليد التوقيع للاجتماع (مباشرة بعد الإنشاء)
        const cleanMeetingNumber = String(meetingData.id || '').replace(/\D/g, '');
        const clientId = process.env.ZOOM_CLIENT_ID || process.env.ZOOM_SDK_KEY;
        const clientSecret = process.env.ZOOM_CLIENT_SECRET || process.env.ZOOM_SDK_SECRET;

        let signature = '';
        if (clientId && clientSecret && cleanMeetingNumber) {
            try {
                const iat = Math.floor(Date.now() / 1000) - 30;
                const exp = iat + 60 * 60 * 2;

                const oHeader = { alg: 'HS256', typ: 'JWT' };
                const oPayload = {
                    iss: clientId,
                    appKey: clientId,
                    sdkKey: clientId,
                    mn: cleanMeetingNumber,
                    role: 0, // 0 = host
                    iat: iat,
                    exp: exp,
                    tokenExp: exp
                };

                const sHeader = JSON.stringify(oHeader);
                const sPayload = JSON.stringify(oPayload);
                signature = KJUR.jws.JWS.sign("HS256", sHeader, sPayload, clientSecret);
                console.log('✅ تم توليد التوقيع بنجاح');
            } catch (sigError) {
                console.error('❌ فشل توليد التوقيع:', sigError);
                // نكمل بدون توقيع (سيظهر تحذير في الكود الأمامي)
            }
        } else {
            console.warn('⚠️ مفاتيح Zoom غير مكتملة، لا يمكن توليد التوقيع');
        }

        // ✅ إرجاع البيانات مع التوقيع
        res.status(200).json({
            ...meetingData,
            signature: signature,
            sdkKey: clientId || '',
            meetingNumber: cleanMeetingNumber
        });

    } catch (error) {
        console.error('❌ Error creating meeting:', error.response?.data || error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || error.message || 'Failed to create meeting';
        res.status(status).json({ error: message });
    }
});

// ------------------- 3. (اختياري) حذف الاجتماع -------------------
app.delete('/api/delete-meeting/:meetingId', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const accessToken = await getZoomAccessToken();

        await axios.delete(
            `https://api.zoom.us/v2/meetings/${meetingId}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting meeting:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to delete meeting' });
    }
});

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
    console.log(`✅ Create meeting: POST http://localhost:${PORT}/api/create-meeting`);
    console.log(`✅ Generate signature: POST http://localhost:${PORT}/api/generate-signature`);
});
