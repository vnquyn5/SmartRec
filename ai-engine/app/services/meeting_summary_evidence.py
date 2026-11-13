"""Conservative evidence checks for assignments, dates, proposals, and decisions."""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Any, Iterable


_ASSIGNMENT_CUES = re.compile(
    r"\b(?:se phai|phu trach|chiu trach nhiem|co trach nhiem|duoc giao|phan cong|"
    r"ho tro|assigned to|is responsible for|was assigned|takes responsibility)\b"
)
_COMMITMENT_VERB = (
    r"(?:hoan thanh|hoan tat|thuc hien|kiem thu|kiem tra|bao cao|ket noi|"
    r"phat trien|thiet ke|xu ly|sua|xay dung|upload|complete|finish|test|"
    r"report|connect|develop)"
)
_FIRST_PERSON_COMMITMENT = re.compile(
    rf"\b(?:minh|toi|em|i)\s+(?:se|will)\s+{_COMMITMENT_VERB}\b"
)
_FIRST_PERSON_TASK_ACCEPTANCE = re.compile(r"\b(?:minh|toi|em|i)\s+nhan\s+nhiem\s+vu\b")
_FIRST_PERSON_RESPONSIBILITY_CLAIM = re.compile(
    # ASR may render “chịu” as “chứa”; _is_negated distinguishes that
    # corrupted responsibility phrase from the actual negation “chưa”.
    r"\b(?:minh|toi|em)\s+chua\s+trach\s+nhiem\b"
)
_NAMED_TASK_ACCEPTANCE = re.compile(
    r"\b([A-ZÀ-ỸĐ][\wÀ-ỹĐđ-]*)\s+(?:nhận|nhan)\s+(?:nhiệm\s+vụ|nhiem\s+vu)\b"
)
_TASK_VERB = (
    r"(?:hoàn\s+thành|hoan\s+thanh|hoàn\s+tất|hoan\s+tat|thực\s+hiện|thuc\s+hien|"
    r"kiểm\s+thử|kiem\s+thu|kiểm\s+tra|kiem\s+tra|báo\s+cáo|bao\s+cao|kết\s+nối|ket\s+noi|"
    r"phát\s+triển|phat\s+trien|thiết\s+kế|thiet\s+ke|xử\s+lý|xu\s+ly|sửa|sua|"
    r"xây\s+dựng|xay\s+dung|upload|complete|finish|test|report|connect|develop)"
)
_TASK_DISCOURSE_MARKERS = {"vậy", "thì", "còn", "như", "như vậy"}
_DIRECT_ASSIGNMENT_CUE = re.compile(
    r"\b(?:sẽ\s+phải|se\s+phai|phải|phai|phụ\s+trách|phu\s+trach|"
    r"chịu\s+trách\s+nhiệm|chứa\s+trách\s+nhiệm|chiu\s+trach\s+nhiem|chua\s+trach\s+nhiem|"
    r"có\s+trách\s+nhiệm|co\s+trach\s+nhiem|được\s+giao|duoc\s+giao|"
    r"nhận\s+nhiệm\s+vụ|nhan\s+nhiem\s+vu|hỗ\s+trợ|ho\s+tro|"
    r"is\s+responsible\s+for|was\s+assigned|must)\b",
    re.IGNORECASE,
)
_FIRST_PERSON_TASK_CUE = re.compile(
    rf"\b(?P<subject>mình|tôi|em|i)\s+(?:sẽ|se|will)\s+(?P<verb>{_TASK_VERB})\b",
    re.IGNORECASE,
)
_FIRST_PERSON_ACCEPTANCE_CUE = re.compile(
    r"\b(?P<subject>mình|tôi|em)\s+(?P<cue>nhận\s+nhiệm\s+vụ|nhan\s+nhiem\s+vu)\b",
    re.IGNORECASE,
)
_FIRST_PERSON_RESPONSIBILITY_CUE = re.compile(
    r"\b(?P<subject>mình|tôi|em)\s+(?P<cue>chịu\s+trách\s+nhiệm|chứa\s+trách\s+nhiệm|"
    r"chiu\s+trach\s+nhiem|chua\s+trach\s+nhiem)\b",
    re.IGNORECASE,
)
_GROUP_TASK_CUE = re.compile(
    rf"\b(?P<subject>hai\s+bạn)\s+"
    rf"(?:(?:sẽ|se|will)\s+)?(?P<verb>{_TASK_VERB})\b",
    re.IGNORECASE,
)
_BARE_NAMED_OBLIGATION_CUE = re.compile(
    rf"\b(?P<subject>[A-ZÀ-ỸĐ][\wÀ-ỹĐđ-]*|[Mm]ình|[Tt]ôi|[Ee]m|[Ii])\s+"
    rf"(?:[Pp]hải|[Pp]hai)\s+(?P<verb>(?i:{_TASK_VERB}))\b"
)
_ASSIGNMENT_SUBJECT_CUE = re.compile(
    r"\b(?:sẽ\s+phải|se\s+phai|phải|phai|phụ\s+trách|phu\s+trach|"
    r"chịu\s+trách\s+nhiệm|chứa\s+trách\s+nhiệm|chiu\s+trach\s+nhiem|chua\s+trach\s+nhiem|"
    r"có\s+trách\s+nhiệm|co\s+trach\s+nhiem|"
    r"được\s+giao|duoc\s+giao|"
    r"nhận\s+nhiệm\s+vụ|nhan\s+nhiem\s+vu|"
    r"hỗ\s+trợ|ho\s+tro|"
    rf"sẽ\s+{_COMMITMENT_VERB}|se\s+{_COMMITMENT_VERB}|"
    r"is responsible for|was assigned|must)\b",
    re.IGNORECASE,
)
_RELATIVE_DEADLINE = re.compile(
    r"\b(?:truoc|den|vao|by|before)\b.{0,30}\b(?:thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|"
    r"hom nay|ngay mai|tuan toi|next week|tomorrow|today)\b"
    r"|\bthu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)\b"
)
_DEADLINE_CONTEXT = re.compile(
    r"\b(?:han|hoan thanh|deadline|due|truoc|before|by|bao cao|report|nop|giao nop)\b"
)
_ADJACENT_DEADLINE_CUE = re.compile(
    r"\b(?:han(?:\s+(?:hoan thanh|chot))?|thoi han|deadline|due date)\b"
)
_POSITIVE_DECISION = re.compile(
    r"\b(?:thong nhat|quyet dinh|da chot|chot|approved|agreed to|agreed on|decided to)\b"
)
_CONFIRMATION_CLAIM = re.compile(
    r"\b(?:thong nhat|quyet dinh|da chot|chot|approved|agreed to|agreed on|decided to)\b",
    re.IGNORECASE,
)
_DECISION_INTENT_PREFIX = re.compile(
    r"\b(?:de|se|can|nen|muon|co the|phai|du kien|ke hoach la)"
    r"(?:\s+\w+){0,4}\s*$"
)
_PROPOSAL_CUE = re.compile(
    r"\b(?:de xuat|kien nghi|de nghi|propose(?:d|s)?|suggest(?:ed|s|ion)?|recommend(?:ed|s|ation)?)\b"
)
_NEGATION = re.compile(r"\b(?:chua|khong|khong the|not|never|no)\b")
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_VI_DATE = re.compile(r"\b(?:ngay\s*)?(\d{1,2})\s+thang\s+(\d{1,2})\s+nam\s+(\d{4})\b")
_NUMERIC_DATE = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b")
_NON_PERSON_SUBJECTS = {
    "mình", "tôi", "ta", "chúng tôi", "chúng ta", "mọi người", "cả nhóm",
    "nhóm", "đã", "chưa", "không", "sẽ", "we", "i", "us", "the team", "team",
}
_SUMMARY_STOPWORDS = {
    "a", "an", "and", "are", "at", "by", "cua", "da", "de", "duoc", "for", "from",
    "in", "is", "la", "nhom", "of", "on", "se", "the", "to", "trong", "va", "voi",
}
_PROJECT_TERMS = re.compile(r"\b(?:du an|project|entire project|toan bo du an)\b")
_COMPLETION_TERMS = re.compile(r"\b(?:hoan thanh|ket thuc|finish(?:ed)?|complete(?:d)?|completion)\b")
_ASSIGNEE_AFTER_CUE = re.compile(
    r"\b(?:assigned\s+to|giao\s+cho|phan\s+cong\s+cho)\s+"
    r"([A-ZÀ-ỸĐ][\wÀ-ỹĐđ-]*)",
    re.IGNORECASE,
)
_UNCERTAINTY_MARKERS = re.compile(
    r"\b(?:chua ro|chua xac dinh ro|khong ro|khong xac dinh ro|unclear|uncertain|not clear)\b",
    re.IGNORECASE,
)


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value.casefold())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    # Vietnamese đ does not decompose under NFD, while the cue patterns use
    # unaccented Latin spellings (e.g. "duoc giao", "de xuat").
    return value.replace("đ", "d")


def _normalize_identity(value: str) -> str:
    # Preserve Vietnamese diacritics: “Mình” is not the name “Minh”.
    return unicodedata.normalize("NFC", value.casefold())


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _source_ref(item: Any) -> str:
    ref = _value(item, "source_ref")
    if ref:
        return str(ref)
    source_type = _value(item, "source_type")
    source_id = _value(item, "source_id")
    return f"{source_type}:{source_id}"


def _explicit_deadline_dates(text: str) -> set[str]:
    normalized = _normalize(text)
    dates: set[str] = set()
    matches = [
        (match, int(match.group(1)), int(match.group(2)), int(match.group(3)))
        for match in _ISO_DATE.finditer(normalized)
    ]
    matches.extend(
        (match, int(match.group(3)), int(match.group(2)), int(match.group(1)))
        for match in _VI_DATE.finditer(normalized)
    )
    matches.extend(
        (match, int(match.group(3)), int(match.group(2)), int(match.group(1)))
        for match in _NUMERIC_DATE.finditer(normalized)
    )
    for match, year, month, day in matches:
        # A calendar date in the cited sentence must be used as a deadline,
        # not merely mentioned near an assignment.
        context = normalized[max(0, match.start() - 80):min(len(normalized), match.end() + 30)]
        if not _DEADLINE_CONTEXT.search(context):
            continue
        try:
            dates.add(date(year, month, day).isoformat())
        except ValueError:
            continue
    return dates


def _is_negated(text: str, cue_start: int, original_text: str | None = None) -> bool:
    preceding = text[max(0, cue_start - 32):cue_start]
    for match in _NEGATION.finditer(preceding):
        if match.group(0) == "chua" and original_text is not None:
            # Diacritic folding makes Vietnamese “chứa” (contains) collide
            # with “chưa” (not yet). Offsets are preserved by _normalize for
            # Vietnamese text, so inspect the original token before treating
            # it as a negation. Plain ASCII “chua” remains supported for ASR.
            start = max(0, cue_start - 32) + match.start()
            original_token = original_text[start:start + len(match.group(0))].casefold()
            if original_token != "chưa" and any(
                unicodedata.category(char) == "Mn"
                for char in unicodedata.normalize("NFD", original_token)
            ):
                continue
        return True
    return False


def _has_assignment_cue(text: str) -> bool:
    normalized = _normalize(text)
    if any(
        not _is_negated(normalized, match.start(), text)
        for match in _ASSIGNMENT_CUES.finditer(normalized)
    ):
        return True
    if any(
        not _is_negated(normalized, match.start(), text)
        for match in _FIRST_PERSON_COMMITMENT.finditer(normalized)
    ) or any(
        not _is_negated(normalized, match.start(), text)
        for match in _FIRST_PERSON_TASK_ACCEPTANCE.finditer(normalized)
    ):
        return True
    for match in _FIRST_PERSON_RESPONSIBILITY_CLAIM.finditer(normalized):
        cue_start = match.start() + match.group().rfind("trach nhiem")
        if not _is_negated(normalized, cue_start, text):
            return True
    if any(
        not _is_negated(normalized, match.start(), text)
        and _normalize_identity(match.group("subject")) not in {
            "nhóm", "cả nhóm", "mọi người", "team", "the team",
        }
        for match in _BARE_NAMED_OBLIGATION_CUE.finditer(text)
    ):
        return True
    return any(
        _normalize_identity(match.group(1)) not in _NON_PERSON_SUBJECTS
        for match in _NAMED_TASK_ACCEPTANCE.finditer(text)
    ) or any(
        not _is_negated(normalized, match.start(), text)
        for match in _GROUP_TASK_CUE.finditer(text)
    )


def extract_explicit_assignment_facts(text: str, source_ref: str) -> list[dict[str, Any]]:
    """Extract tasks with explicit assignment cues and source-grounded titles.

    Coverage checks use ``_has_assignment_cue`` and normalization uses this
    extractor. Unknown, collective, and ambiguous subjects stay unassigned.
    """
    if not text or not _has_assignment_cue(text):
        return []

    facts: list[dict[str, Any]] = []
    normalized_text = _normalize(text)
    segments = [part for part in re.split(r"(?<=[.!?;])\s+|\n+", text) if part.strip()]

    def add(task: str, assignee: str | None, evidence_text: str) -> None:
        title = task.strip(" \t\r\n,.;:()[]{}\"'“”‘’")
        if not title or not re.search(r"[\wÀ-ỹĐđ]", title):
            return
        key = (_normalize(title), _normalize_identity(assignee or ""))
        if any(
            (_normalize(item["title"]), _normalize_identity(item["assignee"] or "")) == key
            for item in facts
        ):
            return
        facts.append({
            "title": title,
            "assignee": assignee,
            "source_refs": [source_ref],
            "_evidence_text": evidence_text,
        })

    for segment in segments:
        normalized_segment = _normalize(segment)
        for match in _FIRST_PERSON_TASK_CUE.finditer(segment):
            if _is_negated(normalized_segment, match.start(), segment):
                continue
            add(segment[match.start("verb"):], None, segment)
        for match in _FIRST_PERSON_ACCEPTANCE_CUE.finditer(segment):
            if _is_negated(normalized_segment, match.start(), segment):
                continue
            add(segment[match.end():], None, segment)
        for match in _FIRST_PERSON_RESPONSIBILITY_CUE.finditer(segment):
            if _is_negated(normalized_segment, match.start(), segment):
                continue
            add(segment[match.end():], None, segment)
        for match in _GROUP_TASK_CUE.finditer(segment):
            if _is_negated(normalized_segment, match.start(), segment):
                continue
            add(segment[match.start("verb"):], None, segment)
        for cue in _DIRECT_ASSIGNMENT_CUE.finditer(segment):
            if _is_negated(normalized_segment, cue.start(), segment):
                continue
            prefix = segment[:cue.start()].rsplit(",", 1)[-1].strip().rstrip(":")
            tokens = prefix.split()
            while tokens and _normalize_identity(tokens[0].strip(",:;")) in _TASK_DISCOURSE_MARKERS:
                tokens.pop(0)
            if len(tokens) > 1:
                continue
            subject = tokens[0].strip("\"'“”‘’(){}.,:;") if tokens else ""
            if _normalize_identity(subject) in _NON_PERSON_SUBJECTS:
                assignee = None
            elif subject and subject[0].isupper():
                assignee = subject
            else:
                # Lower-case ASR tokens can state the task but cannot safely
                # establish the person's identity.
                assignee = None
            add(segment[cue.end():], assignee, segment)

    # A generic, immediately following “finish the work/task” commitment is a
    # completion condition for the single preceding assignment, not a second
    # independently scoped task. Keep its explicit deadline with that task.
    if len(facts) == 2 and re.match(
        r"\s*(?:hoàn\s+thành|hoàn\s+tất|hoan\s+thanh|hoan\s+tat|complete|finish)\s+"
        r"(?:công\s+việc|cong\s+viec|nhiệm\s+vụ|nhiem\s+vu|the\s+work|the\s+task)\b",
        facts[1]["title"],
        re.IGNORECASE,
    ):
        facts[0]["_evidence_text"] = (
            f"{facts[0]['_evidence_text']} {facts[1]['_evidence_text']}"
        )
        facts.pop()

    # A separate, explicit deadline sentence immediately after one assignment
    # in the same evidence row can be linked safely. Generic nearby dates are
    # not enough; the sentence must contain deadline wording parsed below.
    if len(facts) == 1:
        fact_segment = facts[0]["_evidence_text"]
        try:
            segment_index = segments.index(fact_segment)
        except ValueError:
            segment_index = -1
        if 0 <= segment_index < len(segments) - 1:
            following = segments[segment_index + 1]
            if not _has_assignment_cue(following) and (
                _has_relative_deadline(following)
                or _explicit_deadline_dates(following)
            ):
                facts[0]["_evidence_text"] = f"{fact_segment} {following}"

    return facts


def _named_assignment(text: str, assignee: str) -> bool:
    normalized_text = _normalize_identity(text)
    normalized_name = _normalize_identity(assignee).strip()
    if not normalized_name or normalized_name in _NON_PERSON_SUBJECTS:
        return False
    name = rf"(?<!\w){re.escape(normalized_name)}(?!\w)"
    for match in re.finditer(name, normalized_text):
        suffix = _normalize(normalized_text[match.end():match.end() + 80])
        prefix = _normalize(normalized_text[max(0, match.start() - 80):match.start()])
        if re.match(
            rf"\s+(?:se\s+)?(?:phai|phu trach|chiu trach nhiem|co trach nhiem|duoc giao|dam nhan|"
            rf"nhan nhiem vu|ho tro|{_COMMITMENT_VERB}|"
            r"is responsible for|was assigned|must)\b",
            suffix,
        ):
            return True
        if re.search(r"(?:giao cho|phan cong cho)\s+$", prefix):
            return True
        if re.match(r"\s+to\b", suffix) and re.search(r"\bassigned\s+$", prefix):
            return True
    return False


def _explicit_single_token_assignee(text: str) -> str | None:
    """Read a clearly named, single-token subject before an assignment cue.

    This deliberately leaves multiword subjects and collective/pronoun subjects
    unresolved instead of guessing an identity.
    """
    for cue in _ASSIGNMENT_SUBJECT_CUE.finditer(text):
        prefix = re.split(r"[.!?;:\n]", text[:cue.start()])[-1].strip().rstrip(",:")
        tokens = prefix.rsplit(",", 1)[-1].split()
        while tokens and _normalize_identity(tokens[0].strip(",:;")) in _TASK_DISCOURSE_MARKERS:
            tokens.pop(0)
        if len(tokens) != 1:
            continue
        candidate = tokens[0].strip("\"'“”‘’()[]{}")
        if not candidate or not candidate[0].isupper():
            continue
        if _normalize_identity(candidate) in _NON_PERSON_SUBJECTS:
            continue
        return candidate
    return None


def _has_relative_deadline(text: str) -> bool:
    normalized = _normalize(text)
    matches = list(_RELATIVE_DEADLINE.finditer(normalized))
    if not matches:
        return False
    # A weekday by itself is not necessarily a deadline. A deadline cue in
    # the same evidence span or an explicit before/by phrase is required.
    return any(
        _DEADLINE_CONTEXT.search(normalized)
        or re.search(r"\b(?:truoc|den|vao|by|before)\b", normalized[max(0, match.start() - 30):match.start()])
        for match in matches
    )


def _contains_phrase(text: str, phrase: str) -> bool:
    return bool(phrase.strip()) and _normalize(phrase).strip() in _normalize(text)


def _content_tokens(text: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]+", _normalize(text))
        if token not in _SUMMARY_STOPWORDS
    }


def _claim_support_ratio(claim: str, source_texts: Iterable[str]) -> float:
    terms = _content_tokens(claim)
    if not terms:
        return 1.0
    source_terms = set().union(*(_content_tokens(text) for text in source_texts))
    return len(terms & source_terms) / len(terms)


def _deadline_signatures(text: str) -> set[str]:
    signatures = {f"date:{value}" for value in _explicit_deadline_dates(text)}
    normalized = _normalize(text)
    if _has_relative_deadline(text):
        signatures.update(
            f"relative:{match.group(0)}"
            for match in _RELATIVE_DEADLINE.finditer(normalized)
        )
    return signatures


def _action_deadline_signatures(item: Any) -> set[str]:
    signatures = set()
    deadline = _value(item, "deadline")
    if deadline:
        signatures.add(f"date:{deadline}")
    raw = _value(item, "deadline_raw")
    if raw:
        # The structured field already declares this phrase to be a deadline;
        # provide that context when the verbatim value is only “thứ Sáu”.
        signatures.update(_deadline_signatures(f"hạn {raw}"))
    return signatures


def _claim_assignee_names(text: str) -> set[str]:
    names = set()
    if (subject := _explicit_single_token_assignee(text)):
        names.add(subject)
    names.update(match.group(1).strip(".,:;()[]{}\"'“”‘’") for match in _ASSIGNEE_AFTER_CUE.finditer(text))
    return {name for name in names if name and _normalize_identity(name) not in _NON_PERSON_SUBJECTS}


def _claim_is_project_deadline(text: str) -> bool:
    normalized = _normalize(text)
    return bool(
        _PROJECT_TERMS.search(normalized)
        and _COMPLETION_TERMS.search(normalized)
        and _deadline_signatures(text)
    )


def _source_directly_supports_project_deadline(text: str, deadline_signatures: set[str]) -> bool:
    if not _claim_is_project_deadline(text):
        return False
    return bool(deadline_signatures & _deadline_signatures(text))


def _is_supported_adjacent_date_uncertainty(
    text: str,
    refs: list[str],
    by_ref: dict[str, Any],
    transcript_order: list[str],
    action_items: list[Any],
) -> bool:
    """Allow an explicit uncertainty note for a nearby but unlinked date."""
    if not _UNCERTAINTY_MARKERS.search(_normalize(text)):
        return False
    cited = [by_ref[ref] for ref in refs if ref in by_ref]
    date_sources = [
        item for item in cited
        if _value(item, "source_type") == "TRANSCRIPT"
        and _explicit_deadline_dates(str(_value(item, "text", "")))
    ]
    assignment_sources = [
        item for item in cited
        if _value(item, "source_type") == "TRANSCRIPT"
        and _has_assignment_cue(str(_value(item, "text", "")))
    ]
    for assignment_source in assignment_sources:
        assignment_ref = _source_ref(assignment_source)
        for date_source in date_sources:
            date_ref = _source_ref(date_source)
            try:
                if transcript_order.index(date_ref) != transcript_order.index(assignment_ref) + 1:
                    continue
            except ValueError:
                continue
            if _has_assignment_cue(str(_value(date_source, "text", ""))):
                continue
            if _deadline_refs_are_linked(date_ref, {assignment_ref}, by_ref, transcript_order):
                continue
            assignment_start = int(_value(assignment_source, "start_time_ms", 0) or 0)
            assignment_end = int(_value(assignment_source, "end_time_ms", assignment_start) or assignment_start)
            date_start = int(_value(date_source, "start_time_ms", 0) or 0)
            date_end = int(_value(date_source, "end_time_ms", date_start) or date_start)
            gap_ms = max(0, max(date_start, assignment_start) - min(date_end, assignment_end))
            if gap_ms > 5000:
                continue
            date_signatures = _deadline_signatures(str(_value(date_source, "text", "")))
            if not (date_signatures & _deadline_signatures(text)):
                continue
            for action in action_items:
                if assignment_ref not in _value(action, "source_refs", ()):
                    continue
                title = str(_value(action, "title", ""))
                if (
                    _claim_support_ratio(title, [str(_value(assignment_source, "text", ""))]) >= 0.75
                    and _claim_support_ratio(title, [text]) >= 0.75
                ):
                    return True
    return False


def cross_field_consistency_issues(summary: Any, evidence: Iterable[Any]) -> tuple[dict, ...]:
    """Reject summaries that move task facts to the project or another assignee."""
    evidence_items = list(evidence)
    by_ref = {_source_ref(item): item for item in evidence_items}
    transcript_order = [
        _source_ref(item) for item in evidence_items
        if _value(item, "source_type") == "TRANSCRIPT"
    ]
    issues: list[dict] = []

    def issue(location: list[Any], error_type: str) -> None:
        issues.append({"loc": location, "type": error_type})

    action_items = list(_value(summary, "action_items", ()))
    for index, action in enumerate(action_items):
        refs = list(_value(action, "source_refs", ()))
        cited = [by_ref[ref] for ref in refs if ref in by_ref]
        cited_texts = [str(_value(source, "text", "")) for source in cited]
        title = str(_value(action, "title", ""))
        if title and _claim_support_ratio(title, cited_texts) < 0.75:
            issue(["action_items", index, "title"], "unsupported_action_title")
        deadline = _value(action, "deadline")
        if deadline is not None and f"date:{deadline}" not in _action_deadline_signatures(action):
            issue(["action_items", index, "deadline"], "inconsistent_action_deadline")

    claims = []
    executive_summary = _value(summary, "executive_summary")
    if executive_summary:
        claims.extend(("executive_summary", sentence.strip(), list(_value(summary, "executive_summary_refs", ())))
                      for sentence in re.split(r"(?<=[.!?;])\s+", executive_summary) if sentence.strip())
    for field_name in ("key_points", "next_steps", "open_issues"):
        for index, item in enumerate(_value(summary, field_name, ())):
            claims.append((field_name, str(_value(item, "text", "")), list(_value(item, "source_refs", ())), index))
    for claim_data in claims:
        field_name, text, refs, *index_value = claim_data
        location = [field_name, index_value[0]] if index_value else [field_name]
        cited = [by_ref[ref] for ref in refs if ref in by_ref]
        cited_texts = [str(_value(source, "text", "")) for source in cited]
        signatures = _deadline_signatures(text)

        if field_name == "key_points" and _has_assignment_cue(text):
            issue(location + ["kind"], "assigned_task_misclassified")

        if _claim_is_project_deadline(text) and not any(
            _source_directly_supports_project_deadline(source_text, signatures)
            for source_text in cited_texts
        ):
            issue(location, "project_deadline_inferred_from_task")

        if _CONFIRMATION_CLAIM.search(_normalize(text)) and not any(
            _confirmed_decision(source_text) for source_text in cited_texts
        ):
            issue(location, "unsupported_summary_decision")

        for name in _claim_assignee_names(text):
            if not any(
                _named_assignment(source_text, name)
                or _normalize_identity(_explicit_single_token_assignee(source_text) or "") == _normalize_identity(name)
                for source_text in cited_texts
            ):
                issue(location, "unsupported_summary_assignee")

        uncertainty_supported = (
            field_name == "open_issues"
            and _is_supported_adjacent_date_uncertainty(text, refs, by_ref, transcript_order, action_items)
        )
        candidates = () if uncertainty_supported else action_items

        def matching_actions(claim: str) -> list[Any]:
            matches = []
            for action in candidates:
                assignee = _value(action, "assignee")
                title = str(_value(action, "title", ""))
                if (
                    (assignee is not None and _normalize_identity(assignee) in _normalize_identity(claim))
                    or _claim_support_ratio(title, [claim]) >= 0.75
                ):
                    matches.append(action)
            return matches

        related_actions = matching_actions(text)
        if signatures and related_actions:
            mismatch = False
            if len(related_actions) == 1:
                mismatch = not signatures.issubset(_action_deadline_signatures(related_actions[0]))
            else:
                # A sentence can summarize several tasks. Validate a date only
                # against the task in its own clearly separated clause; a date
                # supported by a different task cannot be borrowed.
                clauses = re.split(r";|\s+(?:và|and)\s+", text, flags=re.IGNORECASE)
                deadline_clauses = [clause for clause in clauses if _deadline_signatures(clause)]
                if not deadline_clauses:
                    mismatch = True
                else:
                    for clause in deadline_clauses:
                        clause_actions = matching_actions(clause)
                        clause_signatures = _deadline_signatures(clause)
                        if (
                            len(clause_actions) != 1
                            or not clause_signatures.issubset(_action_deadline_signatures(clause_actions[0]))
                        ):
                            mismatch = True
                            break
            if mismatch:
                issue(location, "summary_action_deadline_mismatch")

        if field_name in {"key_points", "next_steps", "open_issues"} and text:
            if not uncertainty_supported and _claim_support_ratio(text, cited_texts) < 0.95:
                issue(location, "unsupported_summary_claim")

        if field_name == "next_steps" and any(
            _claim_support_ratio(str(_value(action, "title", "")), [text]) >= 0.75
            for action in action_items
        ):
            issue(location, "action_item_duplicated_as_next_step")

    # Two identical tasks citing the same evidence are a duplicate extraction.
    seen_actions: set[tuple[str, tuple[str, ...]]] = set()
    for index, action in enumerate(action_items):
        key = (_normalize(str(_value(action, "title", ""))), tuple(sorted(_value(action, "source_refs", ()))))
        if key in seen_actions:
            issue(["action_items", index], "duplicate_action_item")
        seen_actions.add(key)

    return tuple(issues)


def _confirmed_decision(text: str) -> bool:
    normalized = _normalize(text)
    for match in _POSITIVE_DECISION.finditer(normalized):
        preceding = normalized[max(0, match.start() - 48):match.start()]
        if _is_negated(normalized, match.start(), text):
            continue
        # "họp để thống nhất", "sẽ thống nhất", and similar statements
        # describe an intention, not a completed agreement.
        if _DECISION_INTENT_PREFIX.search(preceding):
            continue
        return True
    return False


def _confirmed_proposal(text: str) -> bool:
    normalized = _normalize(text)
    return any(
        not _is_negated(normalized, match.start(), text)
        for match in _PROPOSAL_CUE.finditer(normalized)
    )


def _deadline_refs_are_linked(
    date_ref: str,
    assignment_refs: set[str],
    by_ref: dict[str, Any],
    transcript_order: list[str],
    *,
    text_feature_cache: dict[str, tuple[bool, str]] | None = None,
) -> bool:
    if date_ref in assignment_refs:
        return True
    if len(assignment_refs) != 1:
        return False
    date_item = by_ref[date_ref]
    date_text = str(_value(date_item, "text", ""))
    # A neighboring segment that starts another explicit assignment belongs
    # to that task; its date cannot be borrowed by the preceding assignment.
    if text_feature_cache is None:
        has_assignment = _has_assignment_cue(date_text)
        if has_assignment:
            return False
        normalized_date_text = _normalize(date_text)
    else:
        features = text_feature_cache.get(date_text)
        if features is None:
            has_assignment = _has_assignment_cue(date_text)
            normalized_date_text = (
                "" if has_assignment else _normalize(date_text)
            )
            features = (has_assignment, normalized_date_text)
            text_feature_cache[date_text] = features

        if features[0]:
            return False
        normalized_date_text = features[1]

    if (
        not _DEADLINE_CONTEXT.search(normalized_date_text)
        or not _ADJACENT_DEADLINE_CUE.search(normalized_date_text)
    ):
        return False
    try:
        date_index = transcript_order.index(date_ref)
    except ValueError:
        return False
    date_start = int(_value(date_item, "start_time_ms", 0) or 0)
    date_end = int(_value(date_item, "end_time_ms", date_start) or date_start)
    for assignment_ref in assignment_refs:
        try:
            assignment_index = transcript_order.index(assignment_ref)
        except ValueError:
            continue
        # The statement that supplies a deadline must follow the assignment.
        # A deadline span before the next task belongs to the preceding topic;
        # symmetric adjacency incorrectly lends it to the next assignee.
        if date_index != assignment_index + 1:
            continue
        assignment_item = by_ref[assignment_ref]
        assignment_start = int(_value(assignment_item, "start_time_ms", 0) or 0)
        assignment_end = int(_value(assignment_item, "end_time_ms", assignment_start) or assignment_start)
        gap_ms = max(0, max(date_start, assignment_start) - min(date_end, assignment_end))
        if gap_ms <= 5000:
            return True
    return False


def evidence_consistency_issues(summary: Any, evidence: Iterable[Any]) -> tuple[dict, ...]:
    """Return safe field-path/type diagnostics for unsupported semantic claims.

    The checks use assignment/approval cues, exact named-entity boundaries,
    explicit calendar-date parsing and timestamp adjacency. They intentionally
    do not infer a speaker's name from a speaker ID or resolve relative dates.
    """
    evidence_items = list(evidence)
    by_ref = {_source_ref(item): item for item in evidence_items}
    transcript_order = [
        _source_ref(item)
        for item in evidence_items
        if _value(item, "source_type") == "TRANSCRIPT"
    ]
    issues: list[dict] = []
    represented_assignment_refs: set[str] = set()

    # Cache lifetime is restricted to one evidence consistency call.
    deadline_text_features: dict[str, tuple[bool, str]] = {}

    def _linked_deadline_refs(
        date_ref: str,
        assignment_refs: set[str],
        by_ref: dict[str, Any],
        transcript_order: list[str],
    ) -> bool:
        return _deadline_refs_are_linked(
            date_ref,
            assignment_refs,
            by_ref,
            transcript_order,
            text_feature_cache=deadline_text_features,
        )

    def issue(location: list[Any], error_type: str) -> None:
        issues.append({"loc": location, "type": error_type})

    for index, item in enumerate(getattr(summary, "action_items", ())):
        refs = list(getattr(item, "source_refs", ()))
        cited = [by_ref[ref] for ref in refs if ref in by_ref]
        cited_texts = [str(_value(source, "text", "")) for source in cited]
        all_assignment_sources = [
            source for source in cited
            if _has_assignment_cue(str(_value(source, "text", "")))
        ]
        represented_assignment_refs.update(_source_ref(source) for source in all_assignment_sources)

        if not all_assignment_sources:
            issue(["action_items", index, "source_refs"], "unassigned_action_item")
        action_title = str(getattr(item, "title", ""))
        assignment_facts = [
            fact
            for source in all_assignment_sources
            for fact in extract_explicit_assignment_facts(
                str(_value(source, "text", "")), _source_ref(source)
            )
        ]
        matched_facts = []
        if assignment_facts:
            scored_facts = [
                (
                    _claim_support_ratio(action_title, [str(fact["title"])]),
                    fact,
                )
                for fact in assignment_facts
            ]
            best_score, best_fact = max(scored_facts, key=lambda pair: pair[0])
            if best_score >= 0.5:
                matched_facts = [best_fact]
        if matched_facts:
            assignment_task_texts = [str(fact["_evidence_text"]) for fact in matched_facts]
            assignment_refs = {ref for fact in matched_facts for ref in fact["source_refs"]}
        else:
            assignment_task_texts = [
                str(_value(source, "text", "")) for source in all_assignment_sources
            ]
            assignment_refs = {_source_ref(source) for source in all_assignment_sources}
        assignment_sources = [by_ref[ref] for ref in assignment_refs if ref in by_ref]

        assignee = getattr(item, "assignee", None)
        named_assignment_refs = {
            ref
            for ref, text in zip(
                [ref for fact in matched_facts for ref in fact["source_refs"]],
                assignment_task_texts,
            )
            if assignee is not None and _named_assignment(text, assignee)
        }
        if not matched_facts:
            named_assignment_refs = {
                _source_ref(source)
                for source in assignment_sources
                if assignee is not None
                and _named_assignment(str(_value(source, "text", "")), assignee)
            }
        if assignee is not None and not named_assignment_refs:
            issue(["action_items", index, "assignee"], "unsupported_assignee")
        explicit_subjects = {
            _normalize_identity(subject): subject
            for text in assignment_task_texts
            if (subject := _explicit_single_token_assignee(text))
        }
        if assignee is None and len(explicit_subjects) == 1:
            issue(["action_items", index, "assignee"], "missing_explicit_assignee")
        if assignee is not None and named_assignment_refs:
            assignment_refs = named_assignment_refs

        relevant_task_texts = assignment_task_texts

        relevant_text_by_ref = {
            _source_ref(source): str(_value(source, "text", ""))
            for source in cited
            if _source_ref(source) not in assignment_refs
            and _linked_deadline_refs(
                _source_ref(source), assignment_refs, by_ref, transcript_order
            )
        }
        for fact in matched_facts:
            for source_ref in fact["source_refs"]:
                relevant_text_by_ref[source_ref] = str(fact["_evidence_text"])
        relevant_texts = relevant_task_texts + list(relevant_text_by_ref.values())

        raw_deadline = getattr(item, "deadline_raw", None)
        if raw_deadline is not None and not any(
            _contains_phrase(text, raw_deadline) for text in relevant_texts
        ):
            issue(["action_items", index, "deadline_raw"], "unsupported_deadline_phrase")

        dates_by_ref = dict(relevant_text_by_ref)
        if assignment_sources:
            dates_by_ref.update({
                _source_ref(source): relevant_text_by_ref.get(
                    _source_ref(source), str(_value(source, "text", ""))
                )
                for source in assignment_sources
            })
        dates_by_ref = {ref: _explicit_deadline_dates(text) for ref, text in dates_by_ref.items()}
        linked_dates_by_ref = {
            _source_ref(source): _explicit_deadline_dates(str(_value(source, "text", "")))
            for source in evidence_items
            if _value(source, "source_type") == "TRANSCRIPT"
            and _source_ref(source) not in assignment_refs
            and _linked_deadline_refs(
                _source_ref(source), assignment_refs, by_ref, transcript_order
            )
        }
        explicit_dates = {
            value
            for ref, values in dates_by_ref.items()
            if _linked_deadline_refs(ref, assignment_refs, by_ref, transcript_order)
            for value in values
        }
        linked_dates = {
            value
            for values in linked_dates_by_ref.values()
            for value in values
        }
        uncited_linked_dates = linked_dates - explicit_dates
        linked_date_refs = {
            ref
            for ref, values in dates_by_ref.items()
            if values and _linked_deadline_refs(ref, assignment_refs, by_ref, transcript_order)
        }
        relative_evidence = any(_has_relative_deadline(text) for text in relevant_texts)
        deadline = getattr(item, "deadline", None)
        if deadline is not None:
            if deadline in uncited_linked_dates and not relative_evidence:
                # The date is supported by an adjacent transcript segment, but
                # the model omitted that segment from this claim's citations.
                # Keep rejecting the claim while identifying the actionable
                # problem as a missing source reference, not absent evidence.
                issue(["action_items", index, "source_refs"], "missing_deadline_source_ref")
            elif relative_evidence or deadline not in explicit_dates:
                issue(["action_items", index, "deadline"], "unsupported_absolute_deadline")
        elif explicit_dates and linked_date_refs:
            issue(["action_items", index, "deadline"], "missing_supported_absolute_deadline")

        if relative_evidence and deadline is not None:
            issue(["action_items", index, "deadline"], "relative_deadline_resolved")
        if relative_evidence and raw_deadline is None:
            issue(["action_items", index, "deadline_raw"], "missing_relative_deadline")

    # Catch clear assignment omissions as well as unsupported generated claims.
    # This coverage check is limited to affirmative assignment cues in cited
    # transcript/OCR evidence; it does not infer tasks from speaker or name matches.
    for source in evidence_items:
        if _value(source, "source_type") not in {"TRANSCRIPT", "SLIDE_OCR"}:
            continue
        source_ref = _source_ref(source)
        source_text = str(_value(source, "text", ""))
        if not _has_assignment_cue(source_text):
            continue
        source_actions = [
            item for item in getattr(summary, "action_items", ())
            if source_ref in getattr(item, "source_refs", ())
        ]
        extracted_facts = extract_explicit_assignment_facts(source_text, source_ref)
        if source_ref not in represented_assignment_refs or not source_actions:
            issue(["action_items"], "missing_explicit_assignment")
            continue
        if len(source_actions) < len(extracted_facts):
            for _ in range(len(extracted_facts) - len(source_actions)):
                issue(["action_items"], "missing_explicit_assignment")

    for index, item in enumerate(getattr(summary, "decisions", ())):
        refs = list(getattr(item, "source_refs", ()))
        texts = [str(_value(by_ref[ref], "text", "")) for ref in refs if ref in by_ref]
        if not any(_confirmed_decision(text) for text in texts):
            issue(["decisions", index, "source_refs"], "unconfirmed_decision")

    for index, item in enumerate(getattr(summary, "key_points", ())):
        if _has_assignment_cue(str(getattr(item, "text", ""))):
            issue(["key_points", index, "kind"], "assigned_task_misclassified")
        if getattr(item, "kind", None) != "PROPOSAL":
            continue
        refs = list(getattr(item, "source_refs", ()))
        texts = [str(_value(by_ref[ref], "text", "")) for ref in refs if ref in by_ref]
        if not any(_confirmed_proposal(text) for text in texts):
            issue(["key_points", index, "kind"], "unsupported_proposal")

    issues.extend(cross_field_consistency_issues(summary, evidence_items))
    return tuple(issues)
