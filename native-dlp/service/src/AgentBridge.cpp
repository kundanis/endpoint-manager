#include "../include/AgentBridge.h"
#include <windows.h>
#include <fstream>
#include <sstream>
#include <iostream>

namespace {

const wchar_t* kPolicyFileName = L"dlp-policy.json";
const wchar_t* kEventsFileName = L"dlp-events.ndjson";

std::string WideToUtf8(const std::wstring& w)
{
    if (w.empty()) return {};
    int size = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string out(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), out.data(), size, nullptr, nullptr);
    return out;
}

std::string NowIso8601()
{
    SYSTEMTIME st;
    GetSystemTime(&st);
    char buf[32];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
             st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
    return buf;
}

std::wstring JoinPath(const std::wstring& dir, const wchar_t* name)
{
    if (dir.empty()) return name;
    wchar_t last = dir.back();
    return (last == L'\\' || last == L'/') ? (dir + name) : (dir + L"\\" + name);
}

} // namespace

AgentBridge::AgentBridge(std::wstring stateDir) : m_stateDir(std::move(stateDir)) {}

std::wstring AgentBridge::PolicyFilePath() const { return JoinPath(m_stateDir, kPolicyFileName); }
std::wstring AgentBridge::EventsFilePath() const { return JoinPath(m_stateDir, kEventsFileName); }

nlohmann::json AgentBridge::FetchPolicy() const
{
    try {
        std::ifstream f(PolicyFilePath());
        if (!f.is_open()) return nlohmann::json::array();

        std::ostringstream ss;
        ss << f.rdbuf();
        std::string raw = ss.str();
        // Defensive BOM strip — same reasoning as the Node agent's config.ts: don't
        // assume every writer omits a BOM, even though the Node agent's own writer
        // (fs.writeFile with "utf8") does not add one today.
        if (raw.size() >= 3 && (unsigned char)raw[0] == 0xEF && (unsigned char)raw[1] == 0xBB && (unsigned char)raw[2] == 0xBF)
            raw = raw.substr(3);
        if (raw.empty()) return nlohmann::json::array();

        auto parsed = nlohmann::json::parse(raw);
        return parsed.is_array() ? parsed : nlohmann::json::array();
    } catch (const std::exception& e) {
        std::cerr << "[AgentBridge] FetchPolicy failed: " << e.what() << '\n';
        return nlohmann::json::array();
    }
}

void AgentBridge::PostEvent(const std::string&              policyId,
                             const std::wstring&              filePath,
                             const std::wstring&              processPath,
                             bool                              destinationIsRemovable,
                             const std::string&                action,
                             const std::vector<RuleMatch>&    matches)
{
    nlohmann::json matchedRuleIds = nlohmann::json::array();
    nlohmann::json maskedSamples  = nlohmann::json::object();
    for (const auto& m : matches) {
        matchedRuleIds.push_back(m.ruleId);
        // Empty maskedSample means a non-content trigger (e.g. BLOCKED_PATH) — the
        // rule id is still recorded above, it just has no content preview.
        if (!m.maskedSample.empty())
            maskedSamples[m.ruleId] = nlohmann::json::array({ m.maskedSample });
    }

    // Process name only (not the full path) — matches DlpEventPayload.processName;
    // the full process image path isn't otherwise needed server-side.
    std::wstring processName = processPath;
    size_t sep = processName.find_last_of(L"\\/");
    if (sep != std::wstring::npos) processName = processName.substr(sep + 1);

    nlohmann::json ev = {
        { "policyId",               policyId },
        { "filePath",               WideToUtf8(filePath) },
        { "processName",            processName.empty() ? nlohmann::json(nullptr) : nlohmann::json(WideToUtf8(processName)) },
        { "destinationIsRemovable", destinationIsRemovable },
        { "action",                 action },
        { "matchedRuleIds",         matchedRuleIds },
        { "maskedSamples",          maskedSamples },
        { "occurredAt",             NowIso8601() },
    };

    std::lock_guard<std::mutex> lock(m_writeMutex);
    std::ofstream f(EventsFilePath(), std::ios::app | std::ios::binary);
    if (!f.is_open()) {
        std::cerr << "[AgentBridge] Failed to open events file for append\n";
        return;
    }
    f << ev.dump() << "\n";
}
