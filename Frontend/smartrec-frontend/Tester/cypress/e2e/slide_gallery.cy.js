describe('Task 3.11: Keyframe Slide Gallery & OCR Drawer', { testIsolation: false }, () => {
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

    // 1. Tự động ĐĂNG KÝ tài khoản trên giao diện UI
    cy.visit('/register');
    cy.get('input[name="fullName"]').type('Tester Testcase');
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

    // 4. Mở trang cuộc họp và chuyển sang tab Slide Keyframes & OCR
    cy.visit('/meeting/1');
    cy.contains('button', 'Slide Keyframes & OCR', { timeout: 10000 }).should('be.visible').click();
  });

  beforeEach(() => {
    setupIntercepts();
  });

  context('Subtask 3.11.1: Hien thi danh sach Thumbnail Keyframe Slide (SlideGallery.jsx)', () => {
    it('TC_3.11.1_01: Hien thi Header, mo ta va so luong slide tu mock data', () => {
      cy.contains('h3', 'Slide Keyframes & OCR Gallery').should('be.visible');
      cy.contains('3 slides phát hiện').should('be.visible');
      cy.contains('Nhấp vào thumbnail để nhảy đến video hoặc xem chi tiết OCR').should('be.visible');
    });

    it('TC_3.11.1_02: Hien thi day du cac Keyframe Slide tu mock data theo moc thoi gian', () => {
      cy.contains('05:12').should('be.visible');
      cy.contains('Q4 Product Roadmap').should('be.visible');
      cy.contains('08:47').should('be.visible');
      cy.contains('Q4 Revenue Breakdown').should('be.visible');
      cy.contains('12:30').should('be.visible');
      cy.contains('Project Timeline Overview').should('be.visible');
    });

    it('TC_3.11.1_03: Moi card slide hien thi day du so thu tu Slide #X va nut Xem OCR', () => {
      cy.contains('Slide #1').should('be.visible');
      cy.contains('Slide #2').should('be.visible');
      cy.contains('Slide #3').should('be.visible');
      cy.get('button').filter(':contains("Xem OCR")').should('have.length', 3);
    });

    it('TC_3.11.1_04: Hien thi day du cac the Tags va Metrics phat hien tren moi card', () => {
      cy.contains('MILESTONE 3').should('be.visible');
      cy.contains('TARGET Dec 15').should('be.visible');
      cy.contains('REVENUE $2.4M').should('be.visible');
      cy.contains('YOY +18%').should('be.visible');
      cy.contains('CHURN 3.1%').should('be.visible');
      cy.contains('DURATION 16 wks').should('be.visible');
      cy.contains('GA DATE Feb 28').should('be.visible');
    });

    it('TC_3.11.1_05: Thumbnail co tooltip chi dan nhap de nhay moc thoi gian', () => {
      cy.get('div[title="Nhấp để nhảy đến mốc thời gian này trong video"]').should('have.length', 3);
    });
  });

  context('Subtask 3.11.2: Drap Drawer UI xem anh Slide phong to ket hop van ban OCR ben canh', () => {
    it('TC_3.11.2_01: Nhaps nut Xem OCR mo Drawer chi tiet cua Slide #1', () => {
      cy.contains('.rounded-2xl', 'Q4 Product Roadmap').within(() => {
        cy.contains('button', 'Xem OCR').click();
      });
      cy.contains('h3', 'Chi tiết Keyframe Slide & OCR').should('be.visible');
    });

    it('TC_3.11.2_02: Drawer hien thi thong tin anh phong to, moc thoi gian va nut tua video', () => {
      cy.contains('Mốc thời gian: 05:12').should('be.visible');
      cy.contains('h2', 'Q4 Product Roadmap').should('be.visible');
      cy.contains('Keyframe snapshot trích xuất tự động từ video').should('be.visible');
      cy.contains('button', 'Tua video đến slide này (05:12)').should('be.visible');
    });

    it('TC_3.11.2_03: Drawer hien thi chinh xac van ban nhan dang OCR Raw Text', () => {
      cy.contains('h4', 'Văn bản nhận dạng (OCR Raw Text)').should('be.visible');
      cy.contains('Backend Refactor: Sprint 3-4 | New API: Sprint 5 | Launch: Dec 15').should('be.visible');
    });

    it('TC_3.11.2_04: Drawer hien thi danh sach tu khoa va metrics phat hien', () => {
      cy.contains('h4', 'Từ khóa & Metrics phát hiện').should('be.visible');
      cy.contains('.border', 'MILESTONE 3').should('be.visible');
      cy.contains('.border', 'TARGET Dec 15').should('be.visible');
    });

    it('TC_3.11.2_05: Tuong tac nut Sao chep van ban trong Drawer phan hoi trang thai thanh cong', () => {
      cy.contains('button', 'Sao chép văn bản').click();
      cy.contains('✓ Đã sao chép').should('be.visible');
    });

    it('TC_3.11.2_06: Dong Drawer bang nut X', () => {
      cy.contains('button', '✕').click();
      cy.contains('Chi tiết Keyframe Slide & OCR').should('not.exist');
    });

    it('TC_3.11.2_07: Dong Drawer bang cach nhap vao vung backdrop ben ngoai', () => {
      cy.contains('.rounded-2xl', 'Q4 Product Roadmap').within(() => {
        cy.contains('button', 'Xem OCR').click();
      });
      cy.contains('Chi tiết Keyframe Slide & OCR').should('be.visible');
      cy.get('.fixed.inset-0').click(10, 10, { force: true });
      cy.contains('Chi tiết Keyframe Slide & OCR').should('not.exist');
    });

    it('TC_3.11.2_08: Mo Drawer kiem tra du lieu cua Slide #2', () => {
      cy.contains('.rounded-2xl', 'Q4 Revenue Breakdown').within(() => {
        cy.contains('button', 'Xem OCR').click();
      });
      cy.contains('Mốc thời gian: 08:47').should('be.visible');
      cy.contains('h2', 'Q4 Revenue Breakdown').should('be.visible');
      cy.contains('Total_Revenue: $2.4M | YoY Growth: +18% | Churn: 3.1%').should('be.visible');
      cy.contains('.border', 'REVENUE $2.4M').should('be.visible');
      cy.contains('.border', 'YOY +18%').should('be.visible');
      cy.contains('.border', 'CHURN 3.1%').should('be.visible');
      cy.contains('button', '✕').click();
      cy.contains('Chi tiết Keyframe Slide & OCR').should('not.exist');
    });
  });

  context('Subtask 3.11.3: Tinh nang nhap Slide Thumbnail -> Nhay moc thoi gian dien thuyet', () => {
    it('TC_3.11.3_01: Nhap vao Thumbnail Slide #1 kich hoat su kien tua video', () => {
      cy.contains('.rounded-2xl', 'Q4 Product Roadmap').within(() => {
        cy.get('div[title="Nhấp để nhảy đến mốc thời gian này trong video"]').click();
      });
    });

    it('TC_3.11.3_02: Nhap vao Thumbnail Slide #2 kich hoat su kien tua video', () => {
      cy.contains('.rounded-2xl', 'Q4 Revenue Breakdown').within(() => {
        cy.get('div[title="Nhấp để nhảy đến mốc thời gian này trong video"]').click();
      });
    });

    it('TC_3.11.3_03: Nhap vao nut Tua video ben trong Drawer', () => {
      cy.contains('.rounded-2xl', 'Q4 Product Roadmap').within(() => {
        cy.contains('button', 'Xem OCR').click();
      });
      cy.contains('button', 'Tua video đến slide này (05:12)').click();
      cy.contains('button', '✕').click();
    });
  });
});
