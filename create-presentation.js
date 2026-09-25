#!/usr/bin/env node
/**
 * VPU Điểm Danh - Presentation Generator
 * Uses pptxgenjs to create a comprehensive PPTX presentation
 */

import PptxGenJs from 'pptxgenjs';

const pptxgen = PptxGenJs;

// Create presentation instance
const pres = new pptxgen();

// Set layout to widescreen
pres.layout = 'LAYOUT_16x9';

// Define color palette (using professional colors)
const colors = {
  primary: '1E2761',      // Navy blue
  secondary: 'F96167',    // Coral red
  accent: '2196F3',       // Bright blue
  dark: '212121',         // Dark gray
  light: 'F5F5F5',        // Light gray
  success: '4CAF50',      // Green
  warning: 'FF9800',      // Orange
  text: '333333',         // Dark text
  white: 'FFFFFF',        // White
  lightBlue: 'E3F2FD',    // Light blue bg
};

// Helper function to add a title slide
function addTitleSlide(title, subtitle, color = colors.primary) {
  const slide = pres.addSlide();
  slide.background = { color };

  // Title
  slide.addText(title, {
    x: 0.5, y: 2, w: 9, h: 1.2,
    fontSize: 54, bold: true, color: colors.white,
    fontFace: 'Cambria', align: 'left'
  });

  // Subtitle
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 3.3, w: 9, h: 0.8,
      fontSize: 28, color: colors.white,
      fontFace: 'Calibri', align: 'left', opacity: 0.9
    });
  }

  // Bottom accent bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 5.2, w: 10, h: 0.3,
    fill: { color: colors.secondary }
  });
}

// Helper function to add content slide
function addContentSlide(title, items, color = colors.primary) {
  const slide = pres.addSlide();

  // Header background
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 0.8,
    fill: { color }
  });

  // Title
  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.5,
    fontSize: 40, bold: true, color: colors.white,
    fontFace: 'Cambria'
  });

  // Content items
  let yPos = 1.2;
  const itemHeight = 0.65;

  items.forEach((item, idx) => {
    // Icon circle background
    slide.addShape(pres.ShapeType.ellipse, {
      x: 0.5, y: yPos + 0.08, w: 0.35, h: 0.35,
      fill: { color: colors.secondary }
    });

    // Number/icon
    slide.addText((idx + 1).toString(), {
      x: 0.5, y: yPos + 0.08, w: 0.35, h: 0.35,
      fontSize: 14, bold: true, color: colors.white, align: 'center', valign: 'middle',
      fontFace: 'Calibri'
    });

    // Item title
    slide.addText(item.title, {
      x: 1.1, y: yPos, w: 8.4, h: 0.35,
      fontSize: 16, bold: true, color: colors.primary,
      fontFace: 'Calibri'
    });

    // Item description
    if (item.desc) {
      slide.addText(item.desc, {
        x: 1.1, y: yPos + 0.35, w: 8.4, h: 0.3,
        fontSize: 13, color: colors.text,
        fontFace: 'Calibri'
      });
    }

    yPos += itemHeight + 0.3;
  });
}

// Helper function for two-column layout
function addTwoColumnSlide(title, leftTitle, leftItems, rightTitle, rightItems) {
  const slide = pres.addSlide();

  // Header
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 0.8,
    fill: { color: colors.primary }
  });

  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.5,
    fontSize: 40, bold: true, color: colors.white,
    fontFace: 'Cambria'
  });

  // Left column
  slide.addText(leftTitle, {
    x: 0.5, y: 1.1, w: 4.5, h: 0.4,
    fontSize: 18, bold: true, color: colors.primary,
    fontFace: 'Cambria'
  });

  let yPos = 1.6;
  leftItems.forEach(item => {
    slide.addText('• ' + item, {
      x: 0.7, y: yPos, w: 4.3, h: 0.4,
      fontSize: 13, color: colors.text,
      fontFace: 'Calibri'
    });
    yPos += 0.45;
  });

  // Right column
  slide.addText(rightTitle, {
    x: 5.3, y: 1.1, w: 4.5, h: 0.4,
    fontSize: 18, bold: true, color: colors.primary,
    fontFace: 'Cambria'
  });

  yPos = 1.6;
  rightItems.forEach(item => {
    slide.addText('• ' + item, {
      x: 5.5, y: yPos, w: 4.2, h: 0.4,
      fontSize: 13, color: colors.text,
      fontFace: 'Calibri'
    });
    yPos += 0.45;
  });
}

// Slide 1: Title Slide
addTitleSlide('VPU Điểm Danh', 'Hệ thống quản lý điểm danh thông minh');

// Slide 2: Overview
addContentSlide('Giới thiệu hệ thống', [
  { title: 'Điểm danh tự động', desc: 'Dùng mã QR + xác minh vị trí GPS' },
  { title: 'Quản lý centralized', desc: 'Tạo sự kiện, sinh mã QR, quản lý danh sách' },
  { title: 'Xuất dữ liệu', desc: 'Tải CSV hoặc lưu trực tiếp lên Google Drive' },
  { title: 'An toàn & chính xác', desc: 'Kiểm tra vị trí, thời gian, danh tính người dùng' }
]);

// Slide 3: System Architecture
const slide3 = pres.addSlide();
slide3.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide3.addText('Kiến trúc hệ thống', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

// Architecture boxes
const boxes = [
  { x: 0.8, y: 1.5, title: 'Frontend', color: colors.accent, items: ['React', 'TypeScript', 'UI Components'] },
  { x: 3.6, y: 1.5, title: 'Backend/Data', color: colors.secondary, items: ['Firebase', 'Realtime DB', 'File Storage'] },
  { x: 6.4, y: 1.5, title: 'Integration', color: colors.success, items: ['Google OAuth', 'Google Drive', 'GPS API'] }
];

boxes.forEach(box => {
  slide3.addShape(pres.ShapeType.roundRect, {
    x: box.x, y: box.y, w: 2.5, h: 2,
    fill: { color: box.color }, line: { color: colors.white, width: 2 }
  });

  slide3.addText(box.title, {
    x: box.x, y: box.y + 0.3, w: 2.5, h: 0.4,
    fontSize: 18, bold: true, color: colors.white, align: 'center',
    fontFace: 'Cambria'
  });

  let itemY = box.y + 0.9;
  box.items.forEach(item => {
    slide3.addText(item, {
      x: box.x + 0.2, y: itemY, w: 2.1, h: 0.35,
      fontSize: 11, color: colors.white, align: 'center',
      fontFace: 'Calibri'
    });
    itemY += 0.35;
  });
});

// Slide 4: Workflow
const slide4 = pres.addSlide();
slide4.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide4.addText('Quy trình làm việc', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

// Flow diagram
const steps = [
  { num: 1, text: 'Admin tạo\nsự kiện', x: 0.8 },
  { num: 2, text: 'Sinh mã QR\nchia sẻ', x: 2.8 },
  { num: 3, text: 'Người tham dự\nquét QR', x: 4.8 },
  { num: 4, text: 'Xác minh vị trí\nthời gian', x: 6.8 },
  { num: 5, text: 'Lưu kết quả\nđiểm danh', x: 8.8 }
];

steps.forEach((step, idx) => {
  // Circle with number
  slide4.addShape(pres.ShapeType.ellipse, {
    x: step.x, y: 2, w: 0.8, h: 0.8,
    fill: { color: colors.secondary }
  });

  slide4.addText(step.num.toString(), {
    x: step.x, y: 2, w: 0.8, h: 0.8,
    fontSize: 24, bold: true, color: colors.white, align: 'center', valign: 'middle',
    fontFace: 'Cambria'
  });

  // Arrow (except for last step)
  if (idx < steps.length - 1) {
    slide4.addShape(pres.ShapeType.triangle, {
      x: step.x + 0.85, y: 2.15, w: 0.35, h: 0.5,
      fill: { color: colors.secondary }
    });
  }

  // Text below
  slide4.addText(step.text, {
    x: step.x - 0.3, y: 3, w: 1.4, h: 0.8,
    fontSize: 12, color: colors.text, align: 'center',
    fontFace: 'Calibri'
  });
});

// Slide 5: Admin Features
addContentSlide('Tính năng Quản lý', [
  { title: 'Tạo sự kiện', desc: 'Nhập tên, địa điểm, thời gian, vị trí GPS, bán kính' },
  { title: 'Quản lý danh sách', desc: 'Xem/chỉnh sửa danh sách tham dự, email mời' },
  { title: 'Xuất dữ liệu', desc: 'Tải CSV hoặc lưu lên Google Drive tự động' },
  { title: 'Xoá sự kiện', desc: 'Xoá sự kiện và dọn dẹp dữ liệu liên quan' }
]);

// Slide 6: Check-in Features
addContentSlide('Tính năng Điểm danh', [
  { title: 'Quét QR', desc: 'Tự động tải thông tin sự kiện từ mã QR' },
  { title: 'Xác minh vị trí', desc: 'GPS + bản đồ interactif, kiểm tra bán kính' },
  { title: 'Kiểm tra thời gian', desc: 'Điểm danh chỉ có hiệu lực trong khung giờ qui định' },
  { title: 'Xác nhận kết quả', desc: 'Thông báo thành công/thất bại với lý do' }
]);

// Slide 7: Admin Guide
const slide7 = pres.addSlide();
slide7.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide7.addText('Hướng dẫn Quản lý (Bước 1-3)', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

const adminSteps = [
  { num: 'Bước 1', title: 'Đăng nhập', desc: 'Truy cập /admin bằng tài khoản có quyền quản lý (@tbd.edu.vn)' },
  { num: 'Bước 2', title: 'Tạo sự kiện', desc: 'Nhập tên, địa điểm, thời gian bắt đầu/kết thúc, vị trí GPS, bán kính kiểm tra' },
  { num: 'Bước 3', title: 'Quản lý danh sách', desc: 'Thêm email tham dự, xem danh sách điểm danh khi có kết quả' }
];

let yPos = 1.3;
adminSteps.forEach(step => {
  slide7.addText(step.num, {
    x: 0.8, y: yPos, w: 1.2, h: 0.35,
    fontSize: 14, bold: true, color: colors.secondary,
    fontFace: 'Calibri'
  });

  slide7.addText(step.title, {
    x: 2.1, y: yPos, w: 7.4, h: 0.35,
    fontSize: 14, bold: true, color: colors.primary,
    fontFace: 'Calibri'
  });

  slide7.addText(step.desc, {
    x: 2.1, y: yPos + 0.35, w: 7.4, h: 0.4,
    fontSize: 12, color: colors.text,
    fontFace: 'Calibri'
  });

  yPos += 1.15;
});

// Slide 8: Admin Guide Continued
const slide8 = pres.addSlide();
slide8.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide8.addText('Hướng dẫn Quản lý (Bước 4-5)', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

const adminSteps2 = [
  { num: 'Bước 4', title: 'Sinh mã QR', desc: 'Hệ thống tự động sinh mã QR cho sự kiện, chia sẻ cho tham dự' },
  { num: 'Bước 5', title: 'Xuất dữ liệu', desc: 'Tải danh sách điểm danh CSV hoặc lưu trực tiếp lên Google Drive' }
];

yPos = 1.5;
adminSteps2.forEach(step => {
  slide8.addText(step.num, {
    x: 0.8, y: yPos, w: 1.2, h: 0.35,
    fontSize: 14, bold: true, color: colors.secondary,
    fontFace: 'Calibri'
  });

  slide8.addText(step.title, {
    x: 2.1, y: yPos, w: 7.4, h: 0.35,
    fontSize: 14, bold: true, color: colors.primary,
    fontFace: 'Calibri'
  });

  slide8.addText(step.desc, {
    x: 2.1, y: yPos + 0.35, w: 7.4, h: 0.4,
    fontSize: 12, color: colors.text,
    fontFace: 'Calibri'
  });

  yPos += 1.2;
});

// Slide 9: Attendee Guide
const slide9 = pres.addSlide();
slide9.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide9.addText('Hướng dẫn Điểm danh', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

const attendeeSteps = [
  { num: '1', title: 'Quét mã QR hoặc truy cập link', desc: 'Sử dụng điện thoại để quét QR code từ admin' },
  { num: '2', title: 'Cấp quyền GPS', desc: 'Cho phép ứng dụng truy cập vị trí của bạn' },
  { num: '3', title: 'Xác minh vị trí', desc: 'Đứng trong phòm, bật Wi-Fi (nếu cần) để cải thiện tín hiệu' },
  { num: '4', title: 'Nhấn Điểm danh', desc: 'Hệ thống kiểm tra vị trí và thời gian, lưu kết quả' }
];

yPos = 1.3;
attendeeSteps.forEach(step => {
  slide9.addText(step.num, {
    x: 0.8, y: yPos + 0.08, w: 0.3, h: 0.3,
    fontSize: 14, bold: true, color: colors.white, align: 'center', valign: 'middle',
    fill: { color: colors.secondary },
    fontFace: 'Calibri'
  });

  slide9.addText(step.title, {
    x: 1.3, y: yPos, w: 8.2, h: 0.35,
    fontSize: 13, bold: true, color: colors.primary,
    fontFace: 'Calibri'
  });

  slide9.addText(step.desc, {
    x: 1.3, y: yPos + 0.35, w: 8.2, h: 0.35,
    fontSize: 12, color: colors.text,
    fontFace: 'Calibri'
  });

  yPos += 1.0;
});

// Slide 10: Technical Requirements
addTwoColumnSlide(
  'Yêu cầu kỹ thuật',
  'Server',
  [
    'Node.js v18+',
    'npm hoặc pnpm',
    'Docker (nếu dùng)',
    'PostgreSQL hoặc SQLite'
  ],
  'Client (Trình duyệt)',
  [
    'Hỗ trợ Geolocation API',
    'HTTPS connection',
    'JavaScript enabled',
    'Cho phép GPS permission'
  ]
);

// Slide 11: Deployment Options
addContentSlide('Tùy chọn Triển khai', [
  { title: 'Docker (Khuyên dùng)', desc: 'Cài Docker + docker-compose, chạy: docker-compose up' },
  { title: 'Node.js Manual', desc: 'npm install, npm run build, npm run preview' },
  { title: 'Production Server', desc: 'Sử dụng Nginx/Apache, HTTPS, database riêng' },
  { title: 'Cloud Hosting', desc: 'Vercel, Netlify, Heroku hoặc tương tự' }
]);

// Slide 12: Database Options
addTwoColumnSlide(
  'Lựa chọn Cơ sở dữ liệu',
  'In-memory / SQLite',
  [
    'Dễ cài đặt',
    'Phù hợp testing',
    'SQLite cho small deployment',
    'Không cần server riêng'
  ],
  'PostgreSQL',
  [
    'Scalable & robust',
    'Hỗ trợ multi-user',
    'Khuyên cho production',
    'Backup dễ dàng'
  ]
);

// Slide 13: Security Considerations
addContentSlide('An toàn & Bảo mật', [
  { title: 'HTTPS Only', desc: 'Sử dụng SSL certificate (Let\'s Encrypt) trong production' },
  { title: 'Authentication', desc: 'Đăng nhập OAuth2, password mạnh cho admin' },
  { title: 'Data Privacy', desc: 'Mã hóa dữ liệu nhạy cảm, tuân thủ GDPR' },
  { title: 'Rate Limiting', desc: 'Chống brute force, giới hạn API endpoints' }
]);

// Slide 14: Performance Tips
const slide14 = pres.addSlide();
slide14.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide14.addText('Tối ưu hóa Hiệu suất', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

const perfTips = [
  { icon: '⚡', title: 'Caching', desc: 'Bật Redis cache, set cache headers' },
  { icon: '📊', title: 'Database', desc: 'Index quan trọng, cleanup event cũ' },
  { icon: '🌐', title: 'CDN', desc: 'Dùng CDN cho static assets' },
  { icon: '📈', title: 'Monitoring', desc: 'Health checks, disk space alerts' }
];

let tipX = 0.5;
perfTips.forEach(tip => {
  // Background card
  slide14.addShape(pres.ShapeType.roundRect, {
    x: tipX, y: 1.3, w: 2.3, h: 3.5,
    fill: { color: colors.lightBlue }
  });

  // Icon
  slide14.addText(tip.icon, {
    x: tipX, y: 1.5, w: 2.3, h: 0.5,
    fontSize: 32, align: 'center',
    fontFace: 'Calibri'
  });

  // Title
  slide14.addText(tip.title, {
    x: tipX + 0.1, y: 2.1, w: 2.1, h: 0.4,
    fontSize: 14, bold: true, color: colors.primary, align: 'center',
    fontFace: 'Cambria'
  });

  // Description
  slide14.addText(tip.desc, {
    x: tipX + 0.2, y: 2.6, w: 1.9, h: 2,
    fontSize: 11, color: colors.text, align: 'center', valign: 'top',
    fontFace: 'Calibri'
  });

  tipX += 2.4;
});

// Slide 15: Troubleshooting
addTwoColumnSlide(
  'Khắc phục sự cố',
  'Vấn đề thường gặp',
  [
    'Port đang dùng: kill process hoặc đổi PORT',
    'GPS không hoạt động: bật HTTPS, clear site data',
    'Database error: kiểm tra connection string',
    'QR code lỗi: verify base URL, encode format'
  ],
  'Giải pháp',
  [
    'Dùng lsof -i :PORT để tìm process',
    'Cho phép location permission trong browser',
    'Kiểm tra firewall, xác nhận user/password',
    'Test QR code từ mobile device'
  ]
);

// Slide 16: Support & Contact
const slide16 = pres.addSlide();
slide16.addShape(pres.ShapeType.rect, {
  x: 0, y: 0, w: 10, h: 0.8,
  fill: { color: colors.primary }
});
slide16.addText('Hỗ trợ & Liên hệ', {
  x: 0.5, y: 0.15, w: 9, h: 0.5,
  fontSize: 40, bold: true, color: colors.white,
  fontFace: 'Cambria'
});

const contacts = [
  { icon: '📧', label: 'Email', value: 'son.pt@tbd.edu.vn' },
  { icon: '📚', label: 'Documentation', value: 'INSTALLATION.md' },
  { icon: '💻', label: 'Source Code', value: 'GitHub Repository' },
  { icon: '🐛', label: 'Issues', value: 'Report bugs với details' }
];

yPos = 1.5;
contacts.forEach(contact => {
  slide16.addText(contact.icon, {
    x: 0.8, y: yPos, w: 0.6, h: 0.4,
    fontSize: 20, align: 'center', valign: 'middle',
    fontFace: 'Calibri'
  });

  slide16.addText(contact.label, {
    x: 1.6, y: yPos, w: 1.5, h: 0.4,
    fontSize: 13, bold: true, color: colors.primary,
    fontFace: 'Cambria'
  });

  slide16.addText(contact.value, {
    x: 3.2, y: yPos, w: 6.3, h: 0.4,
    fontSize: 13, color: colors.text,
    fontFace: 'Calibri'
  });

  yPos += 0.65;
});

// Slide 17: Closing Slide
addTitleSlide('Cảm ơn', 'Chúc bạn thành công với VPU Điểm Danh', colors.secondary);

// Save presentation
pres.writeFile({ fileName: '/home/claude/vpu-checkin/VPU_Diem_Danh_Presentation.pptx' });
console.log('✅ Presentation created: VPU_Diem_Danh_Presentation.pptx');
