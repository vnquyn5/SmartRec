-- Bảng link giữ hash token/passcode; không có cột chứa secret dạng plaintext.
CREATE TABLE IF NOT EXISTS public_share_links (
    id UUID PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    passcode_hash VARCHAR(100),
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_share_links_meeting_created
    ON public_share_links (meeting_id, created_at DESC);

-- Audit lưu loại thao tác và metadata không nhạy cảm để phục vụ lịch sử quản lý link.
CREATE TABLE IF NOT EXISTS share_link_audits (
    id UUID PRIMARY KEY,
    share_link_id UUID NOT NULL REFERENCES public_share_links(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(30) NOT NULL CHECK (action IN ('CREATE', 'UPDATE_EXPIRY', 'UPDATE_PASSCODE', 'REVOKE')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_share_link_audits_link_created
    ON share_link_audits (share_link_id, created_at);
