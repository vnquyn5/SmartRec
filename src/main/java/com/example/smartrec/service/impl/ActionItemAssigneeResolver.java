package com.example.smartrec.service.impl;

import java.util.regex.Pattern;

/** Conservative, evidence-gated recognition of explicit first-person task commitments. */
public final class ActionItemAssigneeResolver {
    private static final Pattern FIRST_PERSON_COMMITMENT = Pattern.compile(
            "(?iu)\\b(?:mình|tôi|em|anh|chị|chúng tôi|tụi mình)\\s+(?:sẽ\\s+(?:hoàn thành|thực hiện|phát triển|kiểm thử|kiểm tra|báo cáo|kết nối|thiết kế|xử lý|chuẩn bị|hoàn thiện|triển khai|upload|test)\\b|nhận\\s+nhiệm\\s+vụ\\b|phụ\\s+trách\\b|đảm\\s+nhận\\b|cam\\s+kết\\b)");

    private ActionItemAssigneeResolver() {}

    public static boolean hasExplicitFirstPersonCommitment(String transcriptText) {
        return transcriptText != null && FIRST_PERSON_COMMITMENT.matcher(transcriptText).find();
    }
}
