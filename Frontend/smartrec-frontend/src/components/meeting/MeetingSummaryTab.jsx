import React from 'react';

export default function MeetingSummaryTab() {
  return (
    <div className="w-full flex flex-col gap-5 text-slate-300">
      <div className="pb-3 border-b border-[#1b2640]">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block"></span>
          Tóm tắt toàn bộ cuộc họp (AI Executive Summary)
        </h3>
        <p className="text-xs text-slate-400 mt-1 pl-3.5">
          Tạo tự động từ mô hình trí tuệ nhân tạo SmartRec AI
        </p>
      </div>

      <div className="bg-[#0d1526] border border-[#1b2742] rounded-2xl p-5 space-y-4 text-xs leading-relaxed">
        <h4 className="font-bold text-sm text-[#38bdf8]">1. Mục tiêu và Định hướng Quý 4</h4>
        <p className="text-slate-300">
          Cuộc họp tập trung thảo luận về lộ trình sản phẩm Q4 và chiến dịch Marketing chuẩn bị ra mắt.
          Nhóm kỹ thuật đang tái cấu trúc backend và cam kết hoàn thiện bản phát hành chính thức vào ngày 15/12.
        </p>

        <h4 className="font-bold text-sm text-[#38bdf8]">2. Tài chính & Doanh thu</h4>
        <p className="text-slate-300">
          Tổng doanh thu đạt mốc 2.4 triệu USD, tốc độ tăng trưởng hàng năm đạt 18%.
          Tỷ lệ khách hàng rời bỏ (churn rate) duy trì ở mức thấp 3.1%.
        </p>

        <h4 className="font-bold text-sm text-[#38bdf8]">3. Rủi ro & Giải pháp</h4>
        <p className="text-slate-300">
          Sarah cảnh báo về độ trễ hệ thống phát hiện trong đợt kiểm thử hiệu năng vừa qua. 
          Nhóm đã thống nhất phân bổ thêm 2 sprint để giải quyết dứt điểm vấn đề này trước khi đưa vào sản phẩm chính.
        </p>
      </div>
    </div>
  );
}
