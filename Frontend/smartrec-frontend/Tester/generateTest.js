Promise.all([import("fs"), import("path")]).then(([fsMod, pathMod]) => {
  const fs = fsMod.default || fsMod;
  const path = pathMod.default || pathMod;

  const currentDir =
    typeof __dirname !== "undefined" ? __dirname : process.cwd();

  const pkgPath = path.join(currentDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: "smartrec-cypress-tester",
          version: "1.0.0",
          private: true,
          type: "commonjs",
        },
        null,
        2
      ),
      "utf8"
    );
  }

  const mockSummaryPath = path.resolve(
    currentDir,
    "..",
    "src",
    "mocks",
    "mock_summary.json"
  );
  const mockSummaryData = JSON.parse(fs.readFileSync(mockSummaryPath, "utf8"));

  const e2eDir = path.join(currentDir, "cypress", "e2e");
  fs.mkdirSync(e2eDir, { recursive: true });

  const targetSpec = path.join(e2eDir, "task_3_15_workspace.cy.js");

  const specContent = `describe("Task 3.15 - Kiểm thử E2E Summary Panel, Task Matrix Table & AI Badge", () => {
  const EXPECTED_MOCK_DATA = ${JSON.stringify(mockSummaryData, null, 2)};
  const MEETING_ID = "00000000-0000-4000-8000-000000000315";
  const uniqueSuffix = Date.now().toString().slice(-8);

  const REAL_USER = {
    fullName: "Nguyen Van Minh",
    phone: \`09\${uniqueSuffix}\`,
    email: \`minh.\${uniqueSuffix}@gmail.com\`,
    password: "SmartRec@2026",
  };

  let isAccountRegistered = false;

  const setupMeetingFixtureForWorkspace = () => {
    cy.intercept("POST", "**/api/auth/register").as("realRegisterApi");
    cy.intercept("POST", "**/api/auth/login").as("realLoginApi");
    cy.intercept("GET", "**/api/user/me").as("realUserMeApi");

    cy.intercept("GET", "**/meetings*", (req) => {
      if (req.url.includes(MEETING_ID)) return;
      req.reply({
        statusCode: 200,
        body: {
          content: [
            {
              id: MEETING_ID,
              title: "Hop_Chien_Luoc_Q4.mp4",
              fileName: "Hop_Chien_Luoc_Q4.mp4",
              status: "COMPLETED",
              fileType: "video",
              mimeType: "video/mp4",
              durationSeconds: 900,
              createdAt: new Date().toISOString(),
            },
          ],
          pageNumber: 0,
          pageSize: 10,
          totalElements: 1,
          totalPages: 1,
          first: true,
          last: true,
        },
      });
    }).as("getWorkspaceMeetings");

    cy.intercept("GET", \`**/meetings/\${MEETING_ID}\`, {
      statusCode: 200,
      body: {
        id: MEETING_ID,
        title: "Hop_Chien_Luoc_Q4.mp4",
        fileName: "Hop_Chien_Luoc_Q4.mp4",
        status: "COMPLETED",
        fileType: "video",
        mimeType: "video/mp4",
        durationSeconds: 900,
      },
    }).as("getMeetingDetail");

    cy.intercept("GET", \`**/meetings/\${MEETING_ID}/playback-url*\`, {
      statusCode: 200,
      body: {
        url: "https://www.w3schools.com/html/mov_bbb.mp4",
      },
    }).as("getPlaybackUrl");

    cy.intercept("GET", \`**/meetings/\${MEETING_ID}/speakers*\`, {
      statusCode: 200,
      body: [
        { speakerLabel: "Speaker 1", startTime: 10, endTime: 25 },
        { speakerLabel: "Speaker 2", startTime: 26, endTime: 50 },
      ],
    }).as("getSpeakers");
  };

  const registerAndLoginRealAccount = () => {
    if (!isAccountRegistered) {
      cy.visit("/register");
      cy.get("#register-name").clear().type(REAL_USER.fullName);
      cy.get("#register-phone").clear().type(REAL_USER.phone);
      cy.get("#register-email").clear().type(REAL_USER.email);
      cy.get("#register-password").clear().type(REAL_USER.password);
      cy.get("#register-confirm-password").clear().type(REAL_USER.password);
      cy.get('button[type="submit"]').click();

      cy.wait("@realRegisterApi").its("response.statusCode").should("eq", 201);
      cy.url().should("include", "/login");
      cy.contains("Đăng ký tài khoản thành công. Đăng nhập để tiếp tục.").should("be.visible");
      isAccountRegistered = true;
    } else {
      cy.visit("/login");
    }

    cy.get("#login-email").clear().type(REAL_USER.email);
    cy.get("#login-password").clear().type(REAL_USER.password);
    cy.get('button[type="submit"]').click();

    cy.wait("@realLoginApi").then((interception) => {
      expect(interception.response.statusCode).to.eq(200);
      expect(interception.response.body).to.have.property("accessToken").that.is.a("string").and.not.empty;
    });

    cy.url().should("not.include", "/login");
    cy.contains("a", "Không gian cuộc họp").should("be.visible").click();
    cy.url().should("include", "/workspace");

    cy.contains(".meeting-card", "Hop_Chien_Luoc_Q4.mp4")
      .should("be.visible")
      .within(() => {
        cy.contains("button", "Xem chi tiết").click();
      });

    cy.wait("@getMeetingDetail");
    cy.url().should("include", \`/meeting/\${MEETING_ID}\`);
  };

  beforeEach(() => {
    setupMeetingFixtureForWorkspace();
    registerAndLoginRealAccount();
  });

  context("3.15.1 - Component ExecutiveSummary.jsx (Kết luận cuộc họp, Mục tiêu & Quyết định)", () => {
    it("TC-3.15.1-01: Đối chiếu chính xác dữ liệu Mục tiêu, Quyết định, Kết luận và xử lý Sao chép Clipboard thật", () => {
      cy.contains("button", "AI Summary").click();

      cy.contains("h3", "Kết luận Cuộc họp & Tóm tắt điều hành (Executive Summary)").should("be.visible");

      const expectedBadges = [
        { label: "Mục tiêu", icon: "🎯", classToken: "text-blue-400" },
        { label: "Quyết định", icon: "💡", classToken: "text-emerald-400" },
        { label: "Kết luận", icon: "🏁", classToken: "text-purple-400" },
      ];

      EXPECTED_MOCK_DATA.summary.forEach((item, index) => {
        const badgeInfo = expectedBadges[index];
        cy.contains("h4", item.heading)
          .should("be.visible")
          .within(() => {
            cy.contains("span", badgeInfo.icon).should("be.visible");
          })
          .parent()
          .within(() => {
            cy.contains("span", badgeInfo.label)
              .should("be.visible")
              .and("have.class", badgeInfo.classToken);
          })
          .parent()
          .within(() => {
            cy.contains("p", item.content).should("be.visible");
          });
      });

      cy.window().then((win) => {
        cy.spy(win.navigator.clipboard, "writeText").as("clipboardSpy");
      });

      cy.contains("button", "Sao chép tóm tắt").click();
      cy.contains("button", "Đã sao chép").should("be.visible");

      const expectedClipboardText = EXPECTED_MOCK_DATA.summary
        .map((item) => \`\${item.heading}\\n\${item.content}\`)
        .join("\\n\\n");

      cy.get("@clipboardSpy").should("have.been.calledOnceWithExactly", expectedClipboardText);
    });
  });

  context("3.15.2 - Component TaskMatrixTable.jsx (Task, Assignee, Deadline, Priority)", () => {
    it("TC-3.15.2-01: Đối chiếu dữ liệu bảng Ma trận Công việc với mock_summary.json và kiểm tra cập nhật State/Style thực tế", () => {
      cy.contains("button", "Task")
        .should("be.visible")
        .within(() => {
          cy.contains("span", String(EXPECTED_MOCK_DATA.task.length)).should("be.visible");
        });
      cy.contains("button", "Task").click();

      cy.contains("h3", "Ma trận Công việc & Hành động (Task Matrix Table)").should("be.visible");

      const requiredHeaders = ["#", "Nhiệm vụ (Task)", "Thời gian", "Người thực hiện", "Người giám sát", "Hạn chót", "Do uu tien"];
      requiredHeaders.forEach((headerText) => {
        cy.contains("thead th", headerText).should("be.visible");
      });

      cy.get("tbody tr").should("have.length", EXPECTED_MOCK_DATA.task.length);

      EXPECTED_MOCK_DATA.task.forEach((taskItem, idx) => {
        cy.get("tbody tr").eq(idx).within(() => {
          cy.get("td").eq(0).should("have.text", String(taskItem.task_index));
          cy.get("td").eq(1).should("have.text", taskItem.content);
          cy.get("td").eq(2).find("button").should("contain.text", taskItem.timestamp);
          cy.get("td").eq(3).find("select").should("have.value", taskItem.assignee);
          cy.get("td").eq(4).should("have.text", taskItem.responsible || "Chưa xác định");
          cy.get("td").eq(5).find('input[type="date"]').should("have.value", taskItem.deadline);
          cy.get("td").eq(6).find("select").should("have.value", taskItem.priority || "Medium");
        });
      });

      cy.get("tbody tr").eq(2).within(() => {
        cy.get("td").eq(3).find("select")
          .should("have.class", "border-amber-500/60")
          .select("Sarah Lee")
          .should("have.value", "Sarah Lee")
          .and("not.have.class", "border-amber-500/60");

        cy.get("td").eq(5).find('input[type="date"]')
          .should("have.class", "border-amber-500/60")
          .type("2026-11-15")
          .should("have.value", "2026-11-15")
          .and("not.have.class", "border-amber-500/60");

        cy.get("td").eq(6).find("select")
          .should("have.class", "text-amber-300")
          .select("High")
          .should("have.value", "High")
          .and("have.class", "text-rose-300");
      });

      cy.get("tbody tr").eq(0).within(() => {
        cy.get("td").eq(6).find("select")
          .select("Low")
          .should("have.value", "Low")
          .and("have.class", "text-emerald-300");
      });
    });
  });

  context("3.15.3 - Component AiUsageBadge.jsx (Hiển thị Model Local Qwen / Gemini và Tokens)", () => {
    it("TC-3.15.3-01: Kiểm tra trạng thái đóng/mở Popover, tính đúng đắn của phép cộng Tokens và chuyển đổi Model", () => {
      cy.contains("AI Engine & Token Usage").should("not.exist");

      cy.contains("button", "Model:")
        .should("be.visible")
        .within(() => {
          cy.contains("span", "Local Qwen").should("be.visible");
          cy.contains("span", "1,850").should("be.visible");
        });

      cy.contains("button", "Model:").click();
      cy.contains("AI Engine & Token Usage").should("be.visible");
      cy.contains("Qwen 2.5 7B-Instruct").should("be.visible");
      cy.contains("100% Local Private").should("be.visible").and("have.class", "text-emerald-400");
      cy.contains("Prompt Tokens:").parent().should("contain.text", "1420");
      cy.contains("Completion Tokens:").parent().should("contain.text", "430");
      cy.contains("Tổng Tokens:").parent().should("contain.text", "1,850");

      cy.contains("button", "Đổi sang Gemini").click();

      cy.contains("AI Engine & Token Usage").should("be.visible");
      cy.contains("Gemini 1.5 Flash").should("be.visible");
      cy.contains("Google Cloud API").should("be.visible").and("have.class", "text-sky-400");
      cy.contains("Prompt Tokens:").parent().should("contain.text", "1600");
      cy.contains("Completion Tokens:").parent().should("contain.text", "500");
      cy.contains("Tổng Tokens:").parent().should("contain.text", "2,100");

      cy.contains("button", "Model:").within(() => {
        cy.contains("span", "Gemini").should("be.visible");
        cy.contains("span", "2,100").should("be.visible");
      });

      cy.get("body").trigger("mousedown", { force: true });
      cy.contains("AI Engine & Token Usage").should("not.exist");

      cy.contains("button", "AI Summary").click();
      cy.contains("button", "Model:").within(() => {
        cy.contains("span", "Gemini").should("be.visible");
        cy.contains("span", "2,100").should("be.visible");
      });
    });
  });
});
`;

  fs.writeFileSync(targetSpec, specContent, "utf8");
  console.log("Generated:", targetSpec);
});