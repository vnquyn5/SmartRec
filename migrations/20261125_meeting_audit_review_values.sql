BEGIN;

-- Chạy sau migration 20261124_meeting_audit_prompt_registry.sql, nơi tạo bảng này.
-- Mỗi sự kiện HUMAN_REVIEW_SAVE lưu một dòng cho mỗi trường thực sự thay đổi.
-- Các cột mới cho phép NULL để giữ tương thích với những bản ghi audit cũ.
ALTER TABLE meeting_audit_logs
    -- Loại và UUID của bản ghi được sửa. Loại là SUMMARY hoặc ACTION_ITEM.
    ADD COLUMN IF NOT EXISTS entity_type TEXT,
    ADD COLUMN IF NOT EXISTS entity_id UUID,
    -- Tên trường trong Review-Save, ví dụ title tương ứng với action_items.task_name.
    ADD COLUMN IF NOT EXISTS field_name TEXT,
    -- Giá trị đọc từ database trước và sau khi lưu. SQL NULL biểu thị trường chưa có giá trị.
    ADD COLUMN IF NOT EXISTS old_value TEXT,
    ADD COLUMN IF NOT EXISTS new_value TEXT,
    -- UUID của người dùng đã xác thực thực hiện thao tác lưu.
    ADD COLUMN IF NOT EXISTS actor_id UUID;

COMMIT;
