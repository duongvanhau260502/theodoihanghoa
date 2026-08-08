# VLINK — Hệ thống Quản lý Vật tư Thi công

Ứng dụng web hoàn chỉnh (React + Vite + Netlify Functions + Netlify Blobs),
được đóng gói sẵn để chạy thử ngay trên máy hoặc triển khai lên Internet
cho cả nhóm cùng dùng.

## Kiến trúc

```
vlink-app/
├─ src/
│  ├─ App.jsx          — toàn bộ giao diện & logic nghiệp vụ (9 module)
│  ├─ main.jsx          — điểm khởi chạy React
│  └─ index.css         — Tailwind CSS
├─ netlify/functions/
│  └─ data.mts           — API lưu/đọc dữ liệu dự án (Netlify Blobs)
├─ index.html
├─ package.json
├─ vite.config.js
├─ tailwind.config.js / postcss.config.js
└─ netlify.toml
```

**Cách dữ liệu hoạt động:** toàn bộ dữ liệu dự án (BoQ, đặt hàng, nhận
hàng, workdone, NCC, NTP, hoá đơn...) được lưu trong **một bản ghi JSON**
trên Netlify Blobs, thông qua API `/api/data` (GET để đọc, PUT để ghi).
Vì vậy nhiều người mở trang cùng lúc sẽ thấy **chung một dữ liệu**
(trang tự làm mới mỗi 8 giây). Đây là kiểu lưu trữ "last-write-wins" —
phù hợp cho một nhóm nhỏ dùng chung, không có khoá tranh chấp ghi đè.

## Chạy thử trên máy (local)

Cần cài **Node.js ≥ 18**.

```bash
cd vlink-app
npm install
npm install -g netlify-cli    # nếu chưa có Netlify CLI
netlify dev
```

`netlify dev` sẽ chạy cả frontend (Vite) lẫn API `/api/data` (giả lập
Netlify Blobs cục bộ), mở tại `http://localhost:8888`.

Nếu chỉ muốn xem giao diện nhanh mà không cần API (dữ liệu sẽ không lưu
được, chỉ tồn tại trong phiên trình duyệt):

```bash
npm run dev:vite
```

## Triển khai lên Internet (miễn phí, dùng chung cho cả nhóm)

1. Tạo tài khoản tại https://app.netlify.com (miễn phí).
2. Cài Netlify CLI và đăng nhập:
   ```bash
   npm install -g netlify-cli
   netlify login
   ```
3. Trong thư mục `vlink-app`, khởi tạo site:
   ```bash
   netlify init
   ```
   Chọn "Create & configure a new site", theo hướng dẫn trên màn hình.
4. Deploy bản chính thức:
   ```bash
   netlify deploy --prod
   ```
5. Netlify trả về một địa chỉ dạng `https://<ten-site>.netlify.app` —
   gửi link này cho cả nhóm là dùng được ngay, không cần cài đặt gì thêm.

Không nhất thiết phải dùng Netlify — vì phần giao diện là Vite/React
thuần và phần lưu trữ chỉ cần một API đọc/ghi JSON, bạn có thể thay
`netlify/functions/data.mts` bằng bất kỳ backend nào khác (Node/Express,
Supabase, Firebase...) miễn là giữ nguyên 2 endpoint `GET /api/data` và
`PUT /api/data`.

## Vai trò & phân quyền — lưu ý quan trọng

Màn hình đăng nhập hiện chỉ yêu cầu **chọn tên + vai trò**, không có
mật khẩu — đây là cơ chế phân quyền ở mức giao diện (ẩn/hiện nút bấm),
**không phải xác thực bảo mật thật**. Nếu triển khai cho nhiều người
ngoài nhóm tin cậy, nên bổ sung:
- Netlify Identity / Auth0 / Supabase Auth để xác thực đăng nhập thật.
- Kiểm tra quyền ở phía server (trong `data.mts`) chứ không chỉ ở giao
  diện, vì hiện tại API đang chấp nhận ghi từ bất kỳ ai gọi được URL.
- Bật "Xác thực bằng mật khẩu" của Netlify (Visitor Access Controls) để
  chặn người ngoài truy cập trang nếu chưa muốn công khai.

## Các module đã có sẵn

Dashboard · BoQ & Longlead · Tổng hợp (bảng tự tính) · Cập nhật (nhập
liệu + khớp mờ AI-lite) · Chờ xác nhận (duyệt) · Nhà cung cấp (kèm đối
chiếu hoá đơn) · Nhà thầu phụ (kèm biên bản) · Dữ liệu & Cài đặt ·
Xuất Excel · Xuất/In PDF · Đăng nhập phân quyền 3 cấp.

## Tuỳ biến tiếp theo (gợi ý)

- Thêm xác thực thật (mục trên).
- Chuyển từ "một bản ghi JSON" sang các bảng riêng (BoQ, Entries,
  Invoices...) trong một database thật (Postgres/Supabase) khi dữ liệu
  lớn dần — tránh việc cả trang phải ghi đè toàn bộ JSON mỗi lần lưu.
- Thêm audit log (ai sửa gì, khi nào) — hiện chưa có.
- Thay thăm dò 8 giây bằng WebSocket/Realtime để đồng bộ tức thời hơn.
