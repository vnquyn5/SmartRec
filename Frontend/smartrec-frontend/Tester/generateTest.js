const fs = require('fs');
const path = require('path');

const mockDataPath = path.join(__dirname, '../src/mocks/mock_stt.json');
const outputTestDir = path.join(__dirname, 'cypress/e2e');
const outputTestFile = path.join(outputTestDir, 'transcript_view.cy.js');

if (!fs.existsSync(mockDataPath)) {
  console.error('Khong tim thay file mock_stt.json tai:', mockDataPath);
  process.exit(1);
}

const sttList = JSON.parse(fs.readFileSync(mockDataPath, 'utf-8'));
const uniqueSpeakers = [...new Set(sttList.map((item) => item.speaker_id))];

if (!fs.existsSync(outputTestDir)) {
  fs.mkdirSync(outputTestDir, { recursive: true });
}

let testContent = `describe('Transcript View & Speaker Filter', { testIsolation: false }, () => {
  const testEmail = 'tester_' + Date.now() + '@gmail.com';
  const testPhone = '098' + String(Date.now()).slice(-7);

  const setupIntercepts = () => {
    cy.intercept('GET', '**/meetings/**', {
      statusCode: 200,
      body: { id: '1', title: 'Cuoc hop Demo Sprint 3', status: 'COMPLETED', fileType: 'video', durationSeconds: 780 },
    }).as('getMeeting');
    cy.intercept('GET', '**/jobs/**', { statusCode: 200, body: { status: 'COMPLETED' } });
  };

  before(() => {
    setupIntercepts();

    // 1. Tự động ĐĂNG KÝ tài khoản trên giao diện UI (định dạng chuẩn @gmail.com)
    cy.visit('/register');
    cy.get('input[name="fullName"]').type('Nguyen Van Tester');
    cy.get('input[name="phone"]').type(testPhone);
    cy.get('input[name="email"]').type(testEmail);
    cy.get('input[name="password"]').type('Admin@1234');
    cy.get('input[name="confirmPassword"]').type('Admin@1234');
    cy.get('button[type="submit"]').click();

    // 2. Chờ thông báo thành công và chuyển sang giao diện ĐĂNG NHẬP
    cy.url({ timeout: 10000 }).should('include', '/login');
    cy.contains('Đăng ký tài khoản thành công').should('be.visible');

    // 3. Tự động ĐĂNG NHẬP trên giao diện UI với tài khoản @gmail.com vừa tạo
    cy.get('input[name="emailOrPhone"]').type(testEmail);
    cy.get('input[name="password"]').type('Admin@1234');
    cy.get('button[type="submit"]').click();

    // Chờ đăng nhập thành công và điều hướng ra khỏi /login
    cy.url({ timeout: 10000 }).should('not.include', '/login');

    // 4. Mở trang cuộc họp và chuyển sang tab Transcript
    cy.visit('/meeting/1');
    cy.contains('button', 'Transcript', { timeout: 10000 }).should('be.visible').click();
  });

  beforeEach(() => {
    setupIntercepts();
  });

  context('Subtask 3.7.1: Hien thi danh sach cau thoai theo thoi gian', () => {
    it('TC_3.7.1_01: Hien thi Header, o tim kiem va cac nut dieu khien', () => {
      cy.contains('h3', 'Transcript Viewer (ASR Speech-to-Text)').should('be.visible');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').should('be.visible');
      cy.contains('label', 'Auto-scroll').should('be.visible');
      cy.contains('button', 'Sao chép tất cả').should('be.visible');
    });

    it('TC_3.7.1_02: Hien thi du ${sttList.length} cau thoai theo thu tu thoi gian tang dan', () => {
`;

sttList.forEach((item) => {
  const timeRange = `${item.timestamp_start} - ${item.timestamp_end}`;
  const text = item.text.replace(/'/g, "\\'");
  testContent += `      cy.contains('${timeRange}').should('be.visible');\n`;
  testContent += `      cy.contains('${text}').should('be.visible');\n`;
});

testContent += `    });

    it('TC_3.7.1_03: The cau thoai hien thi day du Avatar, ten ID, Badge thoi gian va Noi dung', () => {
`;

sttList.forEach((item) => {
  const name = item.speaker_name_temp || item.speaker_id;
  testContent += `      cy.contains('[data-testid="transcript-card"]', '${name}').within(() => {
        cy.contains('${name.charAt(0)}').should('be.visible');
        cy.contains('${item.speaker_id}').should('be.visible');
      });\n`;
});

testContent += `    });

    it('TC_3.7.1_04: Tim kiem cau thoai bang o Search', () => {
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').type('analytics');
      cy.contains('Certainly! Our products are designed to meet a variety of needs').should('be.visible');
      cy.get('mark').should('contain.text', 'analytics');
      cy.contains('${sttList[0].text.replace(/'/g, "\\'")}').should('not.exist');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').clear();
    });
  });

  context('Subtask 3.7.2: Bo loc Dropdown theo Speaker ID', () => {
    it('TC_3.7.2_01: Dropdown Speaker ID mac dinh la All', () => {
      cy.contains('span', 'Người nói:').should('be.visible');
      cy.get('select').should('be.visible').and('have.value', 'All');
    });
`;

uniqueSpeakers.forEach((speakerId, idx) => {
  const tcNum = String(idx + 2).padStart(2, '0');
  const visible = sttList.filter((i) => i.speaker_id === speakerId);
  const hidden = sttList.filter((i) => i.speaker_id !== speakerId);

  testContent += `
    it('TC_3.7.2_${tcNum}: Loc theo Speaker ID "${speakerId}"', () => {
      cy.get('select').select('${speakerId}');
`;
  visible.forEach((v) => {
    testContent += `      cy.contains('${v.text.replace(/'/g, "\\'")}').should('be.visible');\n`;
  });
  hidden.forEach((h) => {
    testContent += `      cy.contains('${h.text.replace(/'/g, "\\'")}').should('not.exist');\n`;
  });
  testContent += `    });\n`;
});

testContent += `
    it('TC_3.7.2_05: Khoi phuc danh sach cau thoai khi chon lai All', () => {
      cy.get('select').select('${uniqueSpeakers[0]}');
      cy.get('select').select('All');
`;
sttList.forEach((item) => {
  testContent += `      cy.contains('${item.text.replace(/'/g, "\\'")}').should('be.visible');\n`;
});

testContent += `    });

    it('TC_3.7.2_06: Ket hop loc Speaker ID va o tim kiem', () => {
      cy.get('select').select('${uniqueSpeakers[0]}');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').type('product');
      cy.contains('First, I would like to know more about your product offerings').should('be.visible');
      cy.contains('${sttList[0].text.replace(/'/g, "\\'")}').should('not.exist');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').clear();
      cy.get('select').select('All');
    });
  });

  context('Subtask 3.7.3: Hieu ung to sang Highlight va Auto-scroll', () => {
    it('TC_3.7.3_01: Cau thoai dau tien mac dinh duoc to sang', () => {
      cy.contains('${sttList[0].text.replace(/'/g, "\\'")}')
        .parents('[data-testid="transcript-card"]')
        .should('have.class', 'border-[#38bdf8]');
    });

    it('TC_3.7.3_02: Click vao cau thoai khac -> Cau moi duoc to sang, cau cu mat to sang', () => {
      const targetText = '${sttList[2].text.replace(/'/g, "\\'")}';
      const firstText = '${sttList[0].text.replace(/'/g, "\\'")}';

      cy.contains(targetText).click();
      cy.contains(targetText).parents('[data-testid="transcript-card"]').should('have.class', 'border-[#38bdf8]');
      cy.contains(firstText).parents('[data-testid="transcript-card"]').should('not.have.class', 'border-[#38bdf8]');
    });

    it('TC_3.7.3_03: Bat / Tat checkbox Auto-scroll', () => {
      const checkbox = cy.get('input[type="checkbox"]');
      checkbox.should('be.checked');
      checkbox.uncheck().should('not.be.checked');
      checkbox.check().should('be.checked');
    });

    it('TC_3.7.3_04: Nut sao chep tat ca phan hoi trang thai khi click', () => {
      cy.contains('button', 'Sao chép tất cả').click();
      cy.contains('✓ Đã sao chép').should('be.visible');
    });
  });
});
`;

fs.writeFileSync(outputTestFile, testContent, 'utf-8');
console.log(`Da sinh thanh cong 14 testcase vao: ${outputTestFile}`);