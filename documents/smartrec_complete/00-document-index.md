# SmartRec - Document Index

**Trạng thái:** Bản hợp nhất dự thảo từ source code, Proposal, URD và Interface Design  
**Đối tượng:** Khách hàng, Product Owner, người dùng, đội phát triển, QA và vận hành

> Bộ tài liệu mô tả hiện trạng code và kế hoạch yêu cầu. Trước khi phát hành khách hàng, cần thay thông tin Draft bằng version/revision đã duyệt, xác nhận các mục TBD, triển khai kiểm tra UI/runtime và loại bỏ thông tin nội bộ không phù hợp.

## Danh mục

Hai bộ nguồn được giữ nguyên: [AI-generated source set](../documents_ai_generated/00-document-index.md) và [manual source documents](../document_myself/). Cấu trúc tài liệu gốc: [Software Project Documentation Structure](../../Software_Project_Documentation_Structure.md). Báo cáo khảo sát source ban đầu: [sumary.md](../../sumary.md). Bản đối chiếu nguồn, mâu thuẫn và quyết định cần chốt: [Source Reconciliation](./appendices/source-reconciliation.md).

| ID | Tài liệu | Đối tượng | Mục đích |
|---|---|---|---|
| 00 | [Document Index](./00-document-index.md) | Tất cả | Mục lục, trạng thái, hướng dẫn đọc |
| 01 | [Product Overview](./01-product-overview.md) | Khách hàng, PO | Phạm vi và định vị sản phẩm |
| 02 | [User Guide](./02-user-guide.md) | End user | Thao tác sử dụng, giới hạn hiện tại |
| 03 | [Functional Requirements](./03-functional-requirements.md) | PO, dev, QA | Chức năng và quy tắc nghiệp vụ |
| 04 | [Non-Functional Requirements](./04-non-functional-requirements.md) | PO, architect, ops | Chất lượng và chỉ tiêu cần thống nhất |
| 05 | [User Workflows](./05-user-workflows.md) | Khách hàng, PO, QA | Hành trình người dùng |
| 06 | [System Architecture](./06-system-architecture.md) | Kỹ thuật, khách hàng kỹ thuật | Thành phần và kết nối |
| 07 | [Data Model](./07-data-model.md) | Dev, DBA, QA | Logical model và dictionary |
| 08 | [Security and Privacy](./08-security-and-privacy.md) | Security, ops, PO | Hiện trạng và yêu cầu cần chốt |
| 09 | [API Reference](./09-api-reference.md) | Dev, tích hợp, QA | API contracts đã thấy trong source |
| 10 | [API Workflows](./10-api-workflows.md) | Dev, QA | Chuỗi API theo business flow |
| 11 | [Developer Guide](./11-developer-guide.md) | Developers | Setup local và cấu trúc code |
| 12 | [Test Strategy](./12-test-strategy.md) | QA, dev, PO | Chiến lược và bằng chứng test |
| 13 | [Test Cases and UAT](./13-test-cases-and-uat.md) | QA, khách hàng | Bộ test đề xuất, chưa phải kết quả chạy |
| 14 | [Deployment and Operations](./14-deployment-and-operations.md) | DevOps, ops | Local deployment và checklist production |

### Phụ lục

- [Traceability Matrix](./appendices/traceability-matrix.md)
- [Glossary](./appendices/glossary.md)
- [Changelog](./appendices/changelog.md)
- [Source Reconciliation](./appendices/source-reconciliation.md)

## Quy ước mức độ hiện thực

- **Backend implemented:** logic hoặc endpoint có trong backend source.
- **Frontend wired in source:** page/service có gọi API trong source; chưa thay thế kiểm thử runtime.
- **Frontend integration unverified:** API có nhưng chưa xác minh màn hình hiện gọi API thật.
- **Mock/demo:** UI logic mô phỏng, không hoàn thành request backend.
- **Target requirement:** được nêu trong Proposal/URD, chưa đồng nghĩa đã triển khai.
- **UI design only:** có trong Interface Design nhưng chưa xác nhận là luồng sản phẩm đã hoàn thiện.
- **Planned / not integrated:** module/ý tưởng chưa hình thành luồng sản phẩm end-to-end.
- **TBD:** cần khách hàng/Product Owner/đội triển khai xác nhận.
- **Verified at runtime:** chỉ dùng sau khi đã kiểm thử ở môi trường mục tiêu và lưu evidence.

## Thứ tự ưu tiên và nguyên tắc đối chiếu

Proposal/URD xác định ý định và phạm vi mục tiêu; Interface Design là nguồn thiết kế giao diện; repository là bằng chứng cho hiện trạng code. Khi các nguồn khác nhau, tài liệu này giữ cả hai trạng thái và ghi quyết định cần xác nhận, không tự biến mục tiêu thành capability hiện hành. Chi tiết và các xung đột quan trọng nằm trong phụ lục Source Reconciliation.

## Hướng dẫn đọc

Khách hàng nên bắt đầu với 01–05 và phụ lục Source Reconciliation. Đội tích hợp đọc 06–10. Đội kỹ thuật và vận hành đọc 11–14. Mọi tiêu chí nghiệm thu trong 13 cần liên kết requirement ở 03 và giá trị NFR đã được chốt ở 04.

## Giới hạn của bản hiện tại

Tài liệu được hợp nhất từ source repository và ba tài liệu manual, không thay thế xác nhận product scope, kiểm thử runtime, thiết kế production, security assessment hay thỏa thuận SLA. Backend base path được cấu hình là `/api/v1`; controller mappings có thể tự chứa `/api`, do đó phải xác minh full URL từ runtime/OpenAPI trước khi tích hợp. Những chỉ tiêu AI/NFR từ URD là mục tiêu đề xuất trong nguồn, chưa phải cam kết đã đo.
