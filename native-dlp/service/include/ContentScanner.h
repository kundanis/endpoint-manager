#pragma once
#include <string>
#include <vector>
#include <cstdint>

// One admin-authored content rule to check for, resolved from PolicyCache — mirrors
// DlpRuleWire in packages/shared/src/schemas/dlp.schema.ts. Only the three CONTENT_*
// rule types are ever passed here; BLOCKED_PATH/TRUSTED_PROCESS/FILE_EXTENSION are
// handled entirely in main.cpp's orchestration, never reach the scanner.
struct ContentRule {
    std::string ruleId;
    std::string ruleType; // "CONTENT_KEYWORD" | "CONTENT_REGEX" | "CONTENT_PATTERN"
    std::string value;    // literal keyword, regex source, or a PII_PATTERN_KEYS key
};

// One matched rule, with a preview. For CONTENT_KEYWORD the "preview" is just the
// admin's own keyword (not masked — it's not sensitive user data, the admin already
// knows what they typed). For CONTENT_REGEX/CONTENT_PATTERN it's a masked preview of
// whatever was actually found in the file, never the raw value.
struct RuleMatch {
    std::string ruleId;
    std::string maskedSample;
};

struct ScanResult {
    std::vector<RuleMatch> matches;
    bool Sensitive() const { return !matches.empty(); }
};

// Fast local scan using compiled regex patterns — the hot path for a blocking
// IRP_MJ_WRITE, so this must stay cheap. Scans against whatever CONTENT_* rules the
// caller currently has assigned (dynamic, admin-authored), not a fixed global
// catalog — CONTENT_PATTERN rules resolve to the same built-in identifier catalog
// Data Discovery uses (packages/shared/src/data/piiPatterns.ts), just selected
// individually per rule rather than scanned as a whole regulation-scoped set.
class ContentScanner {
public:
    ContentScanner();

    // Scan raw bytes against the given rules; filePath used for extension-based
    // quick-reject.
    ScanResult Scan(const uint8_t* data, size_t len, const std::wstring& filePath,
                     const std::vector<ContentRule>& rules);

private:
    bool IsBinaryExtension(const std::wstring& filePath) const;
};
