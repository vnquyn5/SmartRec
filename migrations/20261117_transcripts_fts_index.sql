-- Tạo GIN index cho Transcript sau khi xác nhận bảng và cấu hình tìm kiếm tồn tại.
-- Định nghĩa index được báo cáo trước đó chưa được kiểm tra lại trực tiếp vì PostgreSQL hiện không truy cập được.
-- Rollback, chỉ chạy sau khi xác nhận migration này đã tạo index: DROP INDEX IF EXISTS public.idx_transcripts_fts;
DO $$ -- Kiểm tra điều kiện và tránh thay thế hoặc tạo trùng index tìm kiếm hiện có.
DECLARE -- Khai báo biến dùng để kiểm tra catalog của bảng và index trong schema public.
    transcript_relation REGCLASS; -- Lưu định danh bảng transcript sau khi tìm thấy trong database.
    named_index_exists BOOLEAN; -- Ghi nhận tên index dự kiến đã được sử dụng hay chưa.
    named_index_matches BOOLEAN; -- Ghi nhận index cùng tên có đúng biểu thức GIN và đang hợp lệ hay không.
    equivalent_index_exists BOOLEAN; -- Ghi nhận index GIN cùng biểu thức dù tên index khác.
    equivalent_index_valid BOOLEAN; -- Ghi nhận index tương đương có sẵn sàng phục vụ truy vấn hay không.
BEGIN -- Bắt đầu xác minh điều kiện trước khi thực hiện lệnh tạo index.
    transcript_relation := to_regclass('public.transcripts'); -- Tìm bảng transcript trong schema public.
    IF transcript_relation IS NULL THEN -- Dừng nếu bảng không tồn tại thay vì đoán cấu trúc database.
        RAISE EXCEPTION 'Required table public.transcripts does not exist'; -- Báo điều kiện schema bắt buộc chưa được đáp ứng.
    END IF; -- Kết thúc kiểm tra sự tồn tại của bảng.
    IF to_regconfig('simple') IS NULL THEN -- Xác nhận cấu hình simple được dùng trong biểu thức index.
        RAISE EXCEPTION 'Required text search configuration simple does not exist'; -- Không tự chọn cấu hình khác khi simple không có.
    END IF; -- Kết thúc kiểm tra cấu hình tìm kiếm.
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = transcript_relation AND attname = 'text_content' AND attnum > 0 AND NOT attisdropped AND atttypid = 'text'::regtype AND attnotnull) THEN -- Xác nhận cột nội dung có đúng kiểu TEXT và NOT NULL như khai báo source.
        RAISE EXCEPTION 'Expected public.transcripts.text_content to be TEXT NOT NULL'; -- Dừng nếu schema thật khác với mapping trong source.
    END IF; -- Kết thúc kiểm tra cột nội dung.
    SELECT to_regclass('public.idx_transcripts_fts') IS NOT NULL INTO named_index_exists; -- Kiểm tra tên index dự kiến đã tồn tại trong schema public chưa.
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_am am ON am.oid = idx.relam WHERE idx.oid = to_regclass('public.idx_transcripts_fts') AND i.indrelid = transcript_relation AND am.amname = 'gin' AND i.indnatts = 1 AND i.indnkeyatts = 1 AND i.indpred IS NULL AND pg_get_expr(i.indexprs, i.indrelid) = 'to_tsvector(''simple''::regconfig, text_content)' AND i.indisvalid AND i.indisready) INTO named_index_matches; -- Kiểm tra định nghĩa và trạng thái index thay vì chỉ dựa vào tên.
    IF named_index_exists AND NOT named_index_matches THEN -- Bảo vệ đối tượng đã tồn tại nhưng có định nghĩa hoặc trạng thái khác.
        RAISE EXCEPTION 'public.idx_transcripts_fts exists but is not the expected valid GIN expression index'; -- Yêu cầu xem xét thủ công thay vì thay thế index.
    END IF; -- Kết thúc kiểm tra an toàn cho index cùng tên.
    IF named_index_matches THEN -- Giữ nguyên index cùng tên nếu đã đúng và đang hoạt động.
        RAISE NOTICE 'Valid public.idx_transcripts_fts already exists; leaving it unchanged'; -- Thông báo migration không cần tạo lại index.
    ELSE -- Tìm index tương đương dưới tên khác trước khi tạo mới.
        SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_am am ON am.oid = idx.relam WHERE i.indrelid = transcript_relation AND am.amname = 'gin' AND i.indnatts = 1 AND i.indnkeyatts = 1 AND i.indpred IS NULL AND pg_get_expr(i.indexprs, i.indrelid) = 'to_tsvector(''simple''::regconfig, text_content)') INTO equivalent_index_exists; -- Phát hiện index biểu thức bị trùng dù khác tên.
        SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_am am ON am.oid = idx.relam WHERE i.indrelid = transcript_relation AND am.amname = 'gin' AND i.indnatts = 1 AND i.indnkeyatts = 1 AND i.indpred IS NULL AND pg_get_expr(i.indexprs, i.indrelid) = 'to_tsvector(''simple''::regconfig, text_content)' AND i.indisvalid AND i.indisready) INTO equivalent_index_valid; -- Kiểm tra index tương đương có thể phục vụ truy vấn hay không.
        IF equivalent_index_exists AND NOT equivalent_index_valid THEN -- Dừng nếu index trùng biểu thức đang lỗi để tránh tạo thêm index trùng.
            RAISE EXCEPTION 'An equivalent transcript GIN index exists but is not valid and ready'; -- Không tự sửa index lỗi khi chưa được đánh giá.
        ELSIF equivalent_index_valid THEN -- Giữ index tương đương đang hoạt động dù nó có tên khác.
            RAISE NOTICE 'An equivalent valid transcript GIN index already exists; leaving it unchanged'; -- Tránh tạo index trùng lặp.
        ELSE -- Chỉ tạo index sau khi các kiểm tra schema và trùng lặp đều đạt.
            EXECUTE 'CREATE INDEX idx_transcripts_fts ON public.transcripts USING GIN (to_tsvector(''simple''::regconfig, text_content))'; -- Tạo expression index được báo cáo mà không sửa code ứng dụng.
        END IF; -- Kết thúc xử lý index tương đương.
    END IF; -- Kết thúc bước giữ nguyên hoặc tạo index.
END $$; -- Kết thúc khối migration PostgreSQL có kiểm tra điều kiện.
