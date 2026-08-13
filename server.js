import React, { useEffect, useRef, useState } from 'react';
import ZoomMtgEmbedded from '@zoom/meetingsdk/embedded';

const ZoomMeetingModal = ({ isOpen, onClose, meetingDetails, userName, userEmail }) => {
  const zoomContainerRef = useRef(null);
  const clientRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !meetingDetails) return;

    let isMounted = true;

    const initAndJoinZoom = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1. تنقية رقم الاجتماع تحسباً لوجود مسافات أو رموز
        const rawMeetingNumber = meetingDetails.meeting_number || meetingDetails.id || meetingDetails.meetingNumber;
        const cleanMeetingNumber = String(rawMeetingNumber || '').replace(/\D/g, '');

        if (!cleanMeetingNumber) {
          throw new Error('رقم الاجتماع غير صالح أو غير موجود.');
        }

        // 2. طلب التوقيع الرقمي من السيرفر (Backend)
        // قم بتعديل رابط الـ API بحسب بيئة تشغيل السيرفر لديك (مثلاً Vercel أو localhost)
        const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
        
        const response = await fetch(`${BACKEND_URL}/api/generate-signature`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            meetingNumber: cleanMeetingNumber,
            role: 0 // 0 للطلاب/المشاركين، 1 للمضيف/المعلم
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.signature) {
          throw new Error(data.error || 'لم يتم استلام توقيع صالح من الخادم');
        }

        if (!isMounted) return;

        // 3. تهيئة عميل Zoom Embedded SDK
        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;

        await client.init({
          zoomAppRoot: zoomContainerRef.current,
          language: 'ar-AR',
          patchJsMedia: true
        });

        // 4. الانضمام للاجتماع باستخدام التوقيع والـ Client ID
        const activeClientId = data.clientId || data.sdkKey || import.meta.env.VITE_ZOOM_SDK_KEY;

        await client.join({
          clientId: activeClientId,
          signature: data.signature,
          meetingNumber: cleanMeetingNumber,
          password: meetingDetails.password || "",
          userName: userName || "مستخدم",
          userEmail: userEmail || `${userName || 'user'}@readandrise.com`
        });

        console.log("تم الانضمام للاجتماع بنجاح!");
      } catch (err) {
        console.error("خطأ أثناء التهيئة أو الانضمام للاجتماع:", err);
        if (isMounted) {
          setError(err.message || 'حدث خطأ أثناء الاتصال باجتماع Zoom');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initAndJoinZoom();

    // تنظيف الموارد عند إغلاق المودال أو الخروج
    return () => {
      isMounted = false;
      if (clientRef.current) {
        try {
          clientRef.current.destroy();
        } catch (e) {
          console.warn("تنبيه أثناء إغلاق جلسة Zoom:", e);
        }
      }
    };
  }, [isOpen, meetingDetails, userName, userEmail]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
      <div className="relative w-full max-w-5xl h-[85vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* شريط العنوان والأزرار */}
        <div className="flex justify-between items-center px-6 py-4 bg-gray-900 text-white">
          <h3 className="text-lg font-bold">
            {meetingDetails?.topic || 'اجتماع Zoom Direct'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl font-bold transition-colors"
          >
            &times;
          </button>
        </div>

        {/* حاوية العرض وإرشادات التحميل والخطأ */}
        <div className="relative flex-1 w-full h-full bg-gray-100">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 z-10">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent"></div>
                <p className="mt-3 text-gray-700 font-medium">جاري الاتصال بقاعة الاجتماع...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-white p-6 z-10">
              <div className="text-center max-w-md">
                <div className="text-red-500 text-5xl mb-3">⚠️</div>
                <h4 className="text-lg font-bold text-gray-800 mb-2">فشل الانضمام للاجتماع</h4>
                <p className="text-sm text-gray-600 mb-4">{error}</p>
                <button
                  onClick={onClose}
                  className="px-5 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
                >
                  إغلاق
                </button>
              </div>
            </div>
          )}

          {/* الحاوية المخصصة لـ Zoom SDK */}
          <div ref={zoomContainerRef} className="w-full h-full" />
        </div>

      </div>
    </div>
  );
};

export default ZoomMeetingModal;
