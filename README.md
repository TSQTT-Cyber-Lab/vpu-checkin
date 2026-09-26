# VPU Điểm Danh

Ứng dụng web điểm danh sự kiện/họp bằng mã QR kết hợp xác minh vị trí GPS, có phân quyền quản trị viên / người quản lý / người tham dự.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./Dockerfile)

## Mục lục

- [Giới thiệu](#giới-thiệu)
- [Tính năng chính](#tính-năng-chính)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cài đặt nhanh](#cài-đặt-nhanh)
  - [Chạy bằng Docker (khuyến nghị)](#chạy-bằng-docker-khuyến-nghị)
  - [Chạy ở môi trường phát triển](#chạy-ở-môi-trường-phát-triển)
- [Cấu hình biến môi trường](#cấu-hình-biến-môi-trường)
- [Vai trò và phân quyền](#vai-trò-và-phân-quyền)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Script có sẵn](#script-có-sẵn)
- [Triển khai lên môi trường thật](#triển-khai-lên-môi-trường-thật)
- [Sao lưu và phục hồi dữ liệu](#sao-lưu-và-phục-hồi-dữ-liệu)
- [Đóng góp](#đóng-góp)
- [Giấy phép](#giấy-phép)
- [Tác giả](#tác-giả)

## Giới thiệu

**VPU Điểm Danh** giúp người quản lý tạo sự kiện, sinh mã QR kèm danh sách mời (theo email); người tham dự quét mã, đăng nhập bằng Google, và tự điểm danh nếu email của họ có trong danh sách mời **và** vị trí GPS nằm trong bán kính cho phép quanh địa điểm sự kiện. Toàn bộ dữ liệu (sự kiện, danh sách mời, lượt điểm danh, vai trò) được lưu trong PostgreSQL; ứng dụng chạy dưới dạng container Docker, có thể triển khai trên VPS, NAS có Container Manager, hoặc bất kỳ máy chủ nào hỗ trợ Docker.

## Tính năng chính

- Đăng nhập bằng Google (Google Identity Services, luồng ID-token — không cần Client Secret).
- Tạo sự kiện kèm thời gian, địa điểm, toạ độ GPS, bán kính và sai số cho phép.
- Sinh mã QR và liên kết điểm danh riêng cho từng sự kiện.
- Xác minh vị trí bằng Geolocation API của trình duyệt trước khi ghi nhận điểm danh.
- Xuất danh sách điểm danh ra CSV.
- Phân quyền theo ba vai trò: **quản trị viên**, **người quản lý**, **người tham dự** (chi tiết bên dưới).
- Sửa sự kiện trong khi sự kiện chưa bắt đầu; xoá sự kiện tự động dọn dẹp toàn bộ danh sách mời và lượt điểm danh liên quan (cascade delete ở tầng cơ sở dữ liệu).
- Danh sách email mời được xác minh bằng mã băm SHA-256, không lưu ở dạng chữ rõ trong tài liệu sự kiện — vì tài liệu này có thể bị bất kỳ ai quét mã QR đọc được.

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Radix UI |
| Backend | Node.js 22, Express 4 |
| Cơ sở dữ liệu | PostgreSQL 15 |
| Xác thực | Google Identity Services (ID-token) |
| Đóng gói / triển khai | Docker, Docker Compose |
| Kiểm tra kiểu dữ liệu | TypeScript (`tsc -b`) |
| Linting | Oxlint |

## Yêu cầu hệ thống

- **Chạy bằng Docker (khuyến nghị):** Docker Engine ≥ 24, Docker Compose v2.
- **Chạy thủ công (phát triển):** Node.js ≥ 22, PostgreSQL ≥ 15 (hoặc dùng container `db` riêng lẻ).
- RAM tối thiểu 1 GB (khuyến nghị 2 GB trở lên), 2 GB dung lượng đĩa trống.

## Cài đặt nhanh

### Chạy bằng Docker (khuyến nghị)

```bash
git clone <repository-url> vpu-checkin
cd vpu-checkin

# Tạo file cấu hình thật từ mẫu
cp .env.example .env

# Sinh khoá bí mật ngẫu nhiên cho AUTH_SECRET và điền vào .env
openssl rand -base64 32

# Build và khởi động
docker compose up -d --build app db
```

Mở trình duyệt tới `http://localhost:3000`. Xem hướng dẫn triển khai đầy đủ (bao gồm HTTPS, sao lưu, và triển khai lên Synology NAS) tại [`DOCKER-DEPLOYMENT.md`](./DOCKER-DEPLOYMENT.md).

### Chạy ở môi trường phát triển

```bash
npm install
cp .env.example .env   # rồi chỉnh DATABASE_URL trỏ tới PostgreSQL local của bạn

npm run dev            # frontend (Vite dev server, hot reload)
npm run start          # backend (Express, cổng mặc định 3000)
```

Chạy `npm run build` trước khi đóng gói để đảm bảo không có lỗi TypeScript (`tsc -b && vite build`).

## Cấu hình biến môi trường

Sao chép [`​.env.example`](./.env.example) thành `.env`. Chỉ năm biến sau thực sự được server đọc (`server/index.js`, `server/db.js`, `server/auth.js`) — các biến khác trong `.env.example` là chỗ dành sẵn cho tính năng tương lai:

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `PORT` | Không (mặc định `3000`) | Cổng ứng dụng lắng nghe |
| `AUTH_SECRET` | **Có** | Khoá ký session, tối thiểu 32 ký tự ngẫu nhiên. Server từ chối khởi động nếu để giá trị mẫu |
| `DATABASE_URL` | **Có** | Chuỗi kết nối PostgreSQL, dạng `postgresql://user:pass@host:5432/ten_csdl` |
| `BOOTSTRAP_ADMIN_EMAIL` | **Có** | Địa chỉ Google email luôn được cấp quyền quản trị viên ở tầng server |
| `GOOGLE_CLIENT_ID` | Có, nếu dùng đăng nhập Google | OAuth Client ID loại "Web application", tạo tại [Google Cloud Console](https://console.cloud.google.com/) |

> **Không commit file `.env` thật lên Git.** File này đã có trong `.gitignore`.

## Vai trò và phân quyền

| Vai trò | Quyền hạn |
|---|---|
| **Quản trị viên** | Toàn quyền: thêm/sửa/xoá người quản lý, thêm/sửa/xoá mọi sự kiện bất kể ai tạo. |
| **Người quản lý** | Tạo sự kiện; sửa sự kiện do mình tạo (chỉ trước khi sự kiện bắt đầu); xoá sự kiện do mình tạo. Với sự kiện do người quản lý khác tạo, chỉ được xem và tự điểm danh nếu có tên trong danh sách mời — không có quyền sửa/xoá. |
| **Người tham dự** | Chỉ tự điểm danh cho sự kiện mình được mời, sau khi đăng nhập Google và xác minh vị trí GPS. |

Quy tắc phân quyền được thực thi ở tầng server (`server/authorize.js`) — đây là nguồn xác thực duy nhất, độc lập với giao diện người dùng, nên vẫn đúng ngay cả khi gọi API trực tiếp.

## Cấu trúc thư mục

```
vpu-checkin/
├── Dockerfile                # Build đa giai đoạn: build frontend rồi đóng gói runtime
├── docker-compose.yml        # Điều phối dịch vụ app, db (và nginx/pgadmin tuỳ chọn)
├── init-db.sql               # Schema PostgreSQL khởi tạo (bảng documents, users)
├── .env.example               # Mẫu cấu hình biến môi trường
├── server/                   # Backend Express
│   ├── index.js              #   Khởi động server, route /health
│   ├── routes.js             #   API tài liệu / collection (REST)
│   ├── authorize.js          #   Quy tắc phân quyền (nguồn xác thực duy nhất)
│   ├── roles.js               #   Xác định vai trò từ email đăng nhập
│   ├── auth.js                #   Xác thực Google ID-token
│   └── db.js                  #   Truy vấn PostgreSQL
├── src/                      # Frontend React + TypeScript
│   ├── components/            #   Giao diện: EventForm, AdminView, ManagersView, ...
│   └── lib/                   #   auth.ts, domain.ts, platform.ts
├── public/                   # Tài nguyên tĩnh
├── DOCKER-DEPLOYMENT.md      # Hướng dẫn triển khai Docker chi tiết
└── DEPLOYMENT-CHECKLIST.md   # Checklist triển khai sản xuất
```

## Script có sẵn

| Lệnh | Chức năng |
|---|---|
| `npm run dev` | Chạy frontend ở chế độ phát triển (Vite, hot reload) |
| `npm run build` | Kiểm tra kiểu dữ liệu (`tsc -b`) và đóng gói frontend cho production |
| `npm run preview` | Xem thử bản build production của frontend |
| `npm run start` | Chạy backend Express (`server/index.js`) |
| `npm run lint` | Kiểm tra mã nguồn bằng Oxlint |

## Triển khai lên môi trường thật

Xem hướng dẫn chi tiết (biến môi trường, HTTPS/reverse proxy, triển khai trên Synology NAS Container Manager, giám sát và bảo trì) tại [`DOCKER-DEPLOYMENT.md`](./DOCKER-DEPLOYMENT.md) và checklist đầy đủ tại [`DEPLOYMENT-CHECKLIST.md`](./DEPLOYMENT-CHECKLIST.md).

## Sao lưu và phục hồi dữ liệu

```bash
# Sao lưu (nén gzip)
docker compose exec db pg_dump -U vpu_admin vpu_checkin | gzip > backup-$(date +%Y%m%d).sql.gz

# Phục hồi
gunzip -c backup-20260925.sql.gz | docker compose exec -T db psql -U vpu_admin vpu_checkin
```

## Đóng góp

Đóng góp luôn được hoan nghênh:

1. Fork repository này.
2. Tạo nhánh tính năng: `git checkout -b feature/ten-tinh-nang`.
3. Commit thay đổi với message rõ ràng.
4. Đảm bảo `npm run build` và `npm run lint` chạy sạch trước khi mở Pull Request.
5. Mở Pull Request mô tả rõ thay đổi và lý do.

Vui lòng báo lỗi (issue) kèm bước tái hiện, log liên quan và phiên bản Docker/Node đang dùng.

## Giấy phép

Dự án được phát hành theo giấy phép **MIT** — xem toàn văn tại [`LICENSE`](./LICENSE). Bạn được tự do sử dụng, sao chép, chỉnh sửa, hợp nhất, xuất bản, phân phối và bán các bản sao của phần mềm, miễn là giữ nguyên thông báo bản quyền và giấy phép gốc trong mọi bản sao.

## Tác giả

**TS. Phan Thanh Sơn**
Khoa Công nghệ thông tin và Bán dẫn — Victoria Pacific University
ORCID: [0009-0000-6110-2586](https://orcid.org/0009-0000-6110-2586)
