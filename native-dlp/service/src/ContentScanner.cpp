#include "../include/ContentScanner.h"
#include <regex>
#include <algorithm>
#include <array>
#include <iostream>

ContentScanner::ContentScanner() = default;

// Extensions that are always binary — skip regex scan entirely.
bool ContentScanner::IsBinaryExtension(const std::wstring& filePath) const
{
    static const std::wstring skip[] = {
        L".exe", L".dll", L".sys", L".pdb", L".obj", L".lib",
        L".png", L".jpg", L".jpeg", L".gif", L".bmp", L".ico",
        L".mp3", L".mp4", L".avi", L".mkv", L".zip", L".gz",
        L".7z",  L".rar", L".iso", L".bin", L".db",  L".sqlite"
    };
    std::wstring lower = filePath;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::towlower);
    for (const auto& ext : skip) {
        if (lower.size() >= ext.size() &&
            lower.compare(lower.size() - ext.size(), ext.size(), ext) == 0)
            return true;
    }
    return false;
}

// Convert UTF-16 LE buffer to ASCII by dropping the null high bytes — not full
// Unicode, but sufficient for detecting ASCII-range patterns/keywords.
static std::string Utf16LeToAscii(const uint8_t* data, size_t len)
{
    std::string out;
    out.reserve(len / 2);
    for (size_t i = 0; i + 1 < len; i += 2) {
        uint16_t ch = (uint16_t)data[i] | ((uint16_t)data[i + 1] << 8);
        out += (ch < 0x80) ? (char)ch : '?';
    }
    return out;
}

static bool LuhnValid(const std::string& digitsOnly)
{
    int sum = 0;
    bool alternate = false;
    for (auto it = digitsOnly.rbegin(); it != digitsOnly.rend(); ++it) {
        int n = *it - '0';
        if (alternate) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alternate = !alternate;
    }
    return sum % 10 == 0;
}

static std::string DigitsOnly(const std::string& s)
{
    std::string out;
    for (char c : s) if (c >= '0' && c <= '9') out += c;
    return out;
}

static bool IsValidIpOctets(const std::string& s)
{
    int start = 0, dots = 0;
    for (int i = 0; i <= (int)s.size(); i++) {
        if (i == (int)s.size() || s[i] == '.') {
            std::string octet = s.substr(start, i - start);
            if (octet.empty() || octet.size() > 3) return false;
            int val = std::stoi(octet);
            if (val > 255) return false;
            start = i + 1;
            dots++;
        }
    }
    return dots == 4;
}

// Masks a matched value down to a preview — last few characters visible, rest
// blanked, preserving spaces/dashes so grouped formats (card numbers, Aadhaar) still
// read the same shape. Mirrors packages/agent/src/dataDiscoveryScanner.ts's
// maskMatch/maskGeneric so the C++ and TypeScript scanners produce previews in the
// same style.
static std::string MaskGeneric(const std::string& raw)
{
    size_t visibleCount = raw.size() <= 4 ? 1 : 4;
    size_t cut = raw.size() - visibleCount;

    // Bullet is U+2022 (UTF-8: E2 80 A2) — a multi-byte sequence, built per masked
    // character rather than assigned into a single char.
    std::string masked;
    for (char c : raw.substr(0, cut)) {
        if (c == ' ' || c == '-') masked += c;
        else masked += "\xE2\x80\xA2";
    }
    return masked + raw.substr(cut);
}

static std::string MaskPatternMatch(const std::string& patternKey, const std::string& raw)
{
    if (patternKey == "EMAIL") {
        auto at = raw.find('@');
        if (at == std::string::npos || at == 0) return MaskGeneric(raw);
        std::string local = raw.substr(0, at);
        std::string domain = raw.substr(at);
        std::string stars(std::max<size_t>(local.size() - 1, 3), '*');
        return local.substr(0, 1) + stars + domain;
    }
    if (patternKey == "IP_ADDRESS") {
        size_t lastDot = raw.rfind('.');
        if (lastDot != std::string::npos) return raw.substr(0, lastDot + 1) + "\xE2\x80\xA2";
    }
    return MaskGeneric(raw);
}

struct PatternDef {
    const char* key;
    const char* pattern;
    bool requiresLuhn;
    bool requiresIpOctetCheck;
};

// Same catalog as packages/shared/src/data/piiPatterns.ts, expressed with \b word
// boundaries instead of (?<!...)/(?!...) lookaround — std::regex's ECMAScript
// grammar does not reliably support lookbehind. \b is equivalent here since every
// pattern starts and ends on a word character (digit or letter). Looked up by key —
// a CONTENT_PATTERN rule names exactly one of these, not the whole catalog.
static const std::array<PatternDef, 11> kBuiltinPatterns = { {
    { "EMAIL",          R"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})",   false, false },
    { "PHONE_INDIA",    R"(\b(?:\+?91[-\s]?)?[6-9]\d{9}\b)",                    false, false },
    { "PHONE_GENERIC",  R"(\+\d{7,14}\b)",                                     false, false },
    { "CREDIT_CARD",    R"(\b(?:\d[ -]?){13,16}\b)",                           true,  false },
    { "IP_ADDRESS",     R"(\b(?:\d{1,3}\.){3}\d{1,3}\b)",                      false, true  },
    { "IBAN",           R"(\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b)",                 false, false },
    { "AADHAAR",        R"(\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b)",               false, false },
    { "PAN_INDIA",      R"(\b[A-Z]{5}\d{4}[A-Z]\b)",                          false, false },
    { "PASSPORT_INDIA", R"(\b[A-PR-WYa-pr-wy]\d{7}\b)",                       false, false },
    { "GSTIN",          R"(\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Zz][A-Z\d]\b)",        false, false },
    { "IFSC_CODE",      R"(\b[A-Z]{4}0[A-Z0-9]{6}\b)",                        false, false },
} };

static const PatternDef* FindBuiltinPattern(const std::string& key)
{
    for (const auto& p : kBuiltinPatterns)
        if (key == p.key) return &p;
    return nullptr;
}

static std::string ToLowerCopy(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

ScanResult ContentScanner::Scan(const uint8_t* data, size_t len, const std::wstring& filePath,
                                  const std::vector<ContentRule>& rules)
{
    ScanResult result;
    if (!data || len == 0)           return result;
    if (rules.empty())               return result;
    if (IsBinaryExtension(filePath)) return result;

    std::string text;
    bool isUtf16 = false;
    if (len >= 2 && data[0] == 0xFF && data[1] == 0xFE) {
        isUtf16 = true;
    } else if (len >= 8) {
        size_t nullOdd = 0, check = std::min(len & ~1ULL, (size_t)256);
        for (size_t i = 1; i < check; i += 2)
            if (data[i] == 0x00) nullOdd++;
        isUtf16 = (nullOdd * 100 / (check / 2)) > 60;
    }

    if (isUtf16) {
        size_t start = (data[0] == 0xFF && data[1] == 0xFE) ? 2 : 0;
        text = Utf16LeToAscii(data + start, len - start);
    } else {
        text.assign(reinterpret_cast<const char*>(data), len);
    }

    std::string textLower = ToLowerCopy(text);

    for (const auto& rule : rules) {
        if (rule.ruleType == "CONTENT_KEYWORD") {
            std::string keywordLower = ToLowerCopy(rule.value);
            if (!keywordLower.empty() && textLower.find(keywordLower) != std::string::npos)
                result.matches.push_back({ rule.ruleId, rule.value }); // not masked — admin's own known term
            continue;
        }

        if (rule.ruleType == "CONTENT_REGEX") {
            try {
                std::regex rx(rule.value);
                std::smatch m;
                if (std::regex_search(text, m, rx))
                    result.matches.push_back({ rule.ruleId, MaskGeneric(m.str()) });
            } catch (const std::regex_error& e) {
                std::cerr << "[ContentScanner] Invalid CONTENT_REGEX rule " << rule.ruleId << ": " << e.what() << '\n';
            }
            continue;
        }

        if (rule.ruleType == "CONTENT_PATTERN") {
            const PatternDef* def = FindBuiltinPattern(rule.value);
            if (!def) continue;

            std::regex rx(def->pattern);
            std::smatch m;
            if (!std::regex_search(text, m, rx)) continue;

            std::string raw = m.str();
            if (def->requiresLuhn && !LuhnValid(DigitsOnly(raw))) continue;
            if (def->requiresIpOctetCheck && !IsValidIpOctets(raw)) continue;

            result.matches.push_back({ rule.ruleId, MaskPatternMatch(def->key, raw) });
        }
    }

    return result;
}
