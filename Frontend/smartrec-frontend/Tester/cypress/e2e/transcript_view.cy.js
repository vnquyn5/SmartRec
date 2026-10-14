describe('Transcript View & Speaker Filter', { testIsolation: false }, () => {
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
    cy.get('input[name="fullName"]').type('Nguyen Van Tester');
    cy.get('input[name="phone"]').type(testPhone);
    cy.get('input[name="email"]').type(testEmail);
    cy.get('input[name="password"]').type('Admin@1234');
    cy.get('input[name="confirmPassword"]').type('Admin@1234');
    cy.get('button[type="submit"]').click();

    // 2. Chờ thông báo thành công và chuyển sang giao diện ĐĂNG NHẬP
    cy.url({ timeout: 10000 }).should('include', '/login');
    cy.contains('Đăng ký tài khoản thành công').should('be.visible');

    // 3. Tự động ĐĂNG NHẬP trên giao diện UI
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

    it('TC_3.7.1_02: Hien thi du 4 cau thoai theo thu tu thoi gian tang dan', () => {
      cy.contains('00:00:00 - 00:00:15').should('be.visible');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('be.visible');
      cy.contains('00:00:32 - 00:00:48').should('be.visible');
      cy.contains('First, I would like to know more about your product offerings and the features they include.').should('be.visible');
      cy.contains('00:01:10 - 00:01:25').should('be.visible');
      cy.contains('Certainly! Our products are designed to meet a variety of needs. We offer a range of features including real-time analytics, customizable dashboards, and seamless integration with existing systems.').should('be.visible');
      cy.contains('00:12:45 - 00:13:00').should('be.visible');
      cy.contains('That\'s great to hear. Can you provide some examples of how your clients have benefited from using your products?').should('be.visible');
    });

    it('TC_3.7.1_03: The cau thoai hien thi day du Avatar, ten ID, Badge thoi gian va Noi dung', () => {
      cy.contains('[data-testid="transcript-card"]', 'John Doe').within(() => {
        cy.contains('J').should('be.visible');
        cy.contains('spk_1').should('be.visible');
      });
      cy.contains('[data-testid="transcript-card"]', 'Alex Smith').within(() => {
        cy.contains('A').should('be.visible');
        cy.contains('spk_1').should('be.visible');
      });
      cy.contains('[data-testid="transcript-card"]', 'Jane Doe').within(() => {
        cy.contains('J').should('be.visible');
        cy.contains('spk_2').should('be.visible');
      });
      cy.contains('[data-testid="transcript-card"]', 'Michael Johnson').within(() => {
        cy.contains('M').should('be.visible');
        cy.contains('spk_3').should('be.visible');
      });
    });

    it('TC_3.7.1_04: Tim kiem cau thoai bang o Search', () => {
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').type('analytics');
      cy.contains('Certainly! Our products are designed to meet a variety of needs').should('be.visible');
      cy.get('mark').should('contain.text', 'analytics');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('not.exist');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').clear();
    });
  });

  context('Subtask 3.7.2: Bo loc Dropdown theo Speaker ID', () => {
    it('TC_3.7.2_01: Dropdown Speaker ID mac dinh la All', () => {
      cy.contains('span', 'Người nói:').should('be.visible');
      cy.get('select').should('be.visible').and('have.value', 'All');
    });

    it('TC_3.7.2_02: Loc theo Speaker ID "spk_1"', () => {
      cy.get('select').select('spk_1');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('be.visible');
      cy.contains('First, I would like to know more about your product offerings and the features they include.').should('be.visible');
      cy.contains('Certainly! Our products are designed to meet a variety of needs. We offer a range of features including real-time analytics, customizable dashboards, and seamless integration with existing systems.').should('not.exist');
      cy.contains('That\'s great to hear. Can you provide some examples of how your clients have benefited from using your products?').should('not.exist');
    });

    it('TC_3.7.2_03: Loc theo Speaker ID "spk_2"', () => {
      cy.get('select').select('spk_2');
      cy.contains('Certainly! Our products are designed to meet a variety of needs. We offer a range of features including real-time analytics, customizable dashboards, and seamless integration with existing systems.').should('be.visible');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('not.exist');
      cy.contains('First, I would like to know more about your product offerings and the features they include.').should('not.exist');
      cy.contains('That\'s great to hear. Can you provide some examples of how your clients have benefited from using your products?').should('not.exist');
    });

    it('TC_3.7.2_04: Loc theo Speaker ID "spk_3"', () => {
      cy.get('select').select('spk_3');
      cy.contains('That\'s great to hear. Can you provide some examples of how your clients have benefited from using your products?').should('be.visible');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('not.exist');
      cy.contains('First, I would like to know more about your product offerings and the features they include.').should('not.exist');
      cy.contains('Certainly! Our products are designed to meet a variety of needs. We offer a range of features including real-time analytics, customizable dashboards, and seamless integration with existing systems.').should('not.exist');
    });

    it('TC_3.7.2_05: Khoi phuc danh sach cau thoai khi chon lai All', () => {
      cy.get('select').select('spk_1');
      cy.get('select').select('All');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('be.visible');
      cy.contains('First, I would like to know more about your product offerings and the features they include.').should('be.visible');
      cy.contains('Certainly! Our products are designed to meet a variety of needs. We offer a range of features including real-time analytics, customizable dashboards, and seamless integration with existing systems.').should('be.visible');
      cy.contains('That\'s great to hear. Can you provide some examples of how your clients have benefited from using your products?').should('be.visible');
    });

    it('TC_3.7.2_06: Ket hop loc Speaker ID va o tim kiem', () => {
      cy.get('select').select('spk_1');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').type('product');
      cy.contains('First, I would like to know more about your product offerings').should('be.visible');
      cy.contains('Hello, welcome to our service. How can I assist you today?').should('not.exist');
      cy.get('input[placeholder="Tìm kiếm nội dung hội thoại..."]').clear();
      cy.get('select').select('All');
    });
  });

  context('Subtask 3.7.3: Hieu ung to sang Highlight va Auto-scroll', () => {
    it('TC_3.7.3_01: Cau thoai dau tien mac dinh duoc to sang', () => {
      cy.contains('Hello, welcome to our service. How can I assist you today?')
        .parents('[data-testid="transcript-card"]')
        .should('have.class', 'border-[#38bdf8]');
    });

    it('TC_3.7.3_02: Click vao cau thoai khac -> Cau moi duoc to sang, cau cu mat to sang', () => {
      const targetText = 'Certainly! Our products are designed to meet a variety of needs. We offer a range of features including real-time analytics, customizable dashboards, and seamless integration with existing systems.';
      const firstText = 'Hello, welcome to our service. How can I assist you today?';

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
