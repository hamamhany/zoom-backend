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

// ------------------- دالة توليد التوقيع (متوافقة مع Zoom SDK v4.0+) -------------------
function generateZoomSignature(meetingNumber, role = 0) {
    const sdkKey = process.env.ZOOM_CLIENT_ID || process.env.ZOOM_SDK_KEY;
    const sdkSecret = process.env.ZOOM_CLIENT_SECRET || process.env.ZOOM_SDK_SECRET;

    if (!sdkKey || !sdkSecret) {
        throw new Error('Missing Zoom credentials for signature generation');
    }

    const cleanMeetingNumber = String(meetingNumber || '').replace(/\D/g, '');
    if (!cleanMeetingNumber) {
        throw new Error('Invalid meeting number');
    }

    const iat = Math.round(Date.now() / 1000) - 30;
    const exp = iat + 60 * 60 * 2; // صلاحية ساعتين

    // ✅ هيكل Payload المطلوب في Zoom SDK v4.0+
    const payload = {
        sdkKey: sdkKey,           
        appKey: sdkKey,           
        mn: cleanMeetingNumber,   
        // ✅ تم تصحيح الأدوار: 1 = مضيف (المعلم), 0 = مشارك (الطالب)
        role: parseInt(role, 10) === 1 ? 1 : 0, 
        iat: iat,
        exp: exp,
        tokenExp: exp             
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const sHeader = JSON.stringify(header);
    const sPayload = JSON.stringify(payload);
    
    return KJUR.jws.JWS.sign("HS256", sHeader, sPayload, sdkSecret);
}

// ------------------- 1. توليد التوقيع فقط -------------------
app.post('/api/generate-signature', (req, res) => {
    try {
        const { meetingNumber, role } = req.body;
        const signature = generateZoomSignature(meetingNumber, role);

        res.status(200).json({
            signature: signature,
            sdkKey: process.env.ZOOM_CLIENT_ID || process.env.ZOOM_SDK_KEY,
            meetingNumber: String(meetingNumber).replace(/\D/g, '')
        });
    } catch (error) {
        console.error('❌ Error generating signature:', error);
        res.status(500).json({ error: error.message || 'Failed to generate signature' });
    }
});

// ------------------- 2. إنشاء اجتماع جديد -------------------
app.post('/api/create-meeting', async (req, res) => {
    try {
        const { topic, start_time, duration, classId, teacherId } = req.body;

        const accessToken = await getZoomAccessToken();

        const response = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic: topic || 'Read and Rise Meeting',
                type: 2,
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

        // ✅ تم إزالة توليد التوقيع من هنا (سيتم توليده في المتصفح لحظة الانضمام)

        res.status(200).json({
            ...meetingData,
            sdkKey: process.env.ZOOM_CLIENT_ID || process.env.ZOOM_SDK_KEY || '',
            meetingNumber: String(meetingData.id || '').replace(/\D/g, '')
        });

    } catch (error) {
        console.error('❌ Error creating meeting:', error.response?.data || error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || error.message || 'Failed to create meeting';
        res.status(status).json({ error: message });
    }
});

// ------------------- 3. جلب قائمة الاجتماعات (اختياري) -------------------
app.get('/api/get-meetings', async (req, res) => {
    try {
        const accessToken = await getZoomAccessToken();
        const response = await axios.get(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                params: {
                    page_size: 30,
                    type: 'scheduled'
                }
            }
        );

        const meetings = response.data.meetings.map(meeting => {
            return { ...meeting };
        });

        res.status(200).json({ meetings });
    } catch (error) {
        console.error('❌ Error fetching meetings:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch meetings' });
    }
});

// ------------------- 4. حذف اجتماع -------------------
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

        res.status(200).json({ success: true, message: 'Meeting deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting meeting:', error.response?.data || error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || error.message || 'Failed to delete meeting';
        res.status(status).json({ error: message });
    }
});

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
    console.log(`✅ Create meeting: POST http://localhost:${PORT}/api/create-meeting`);
    console.log(`✅ Generate signature: POST http://localhost:${PORT}/api/generate-signature`);
    console.log(`✅ Get meetings: GET http://localhost:${PORT}/api/get-meetings`);
    console.log(`✅ Delete meeting: DELETE http://localhost:${PORT}/api/delete-meeting/:meetingId`);
});
