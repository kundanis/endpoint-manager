#include "../include/PolicyCache.h"
#include <windows.h>
#include <fstream>
#include <iostream>
#include <algorithm>

PolicyCache::PolicyCache() = default;

static std::wstring Utf8ToWide(const std::string& s)
{
    if (s.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    std::wstring out(size, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), out.data(), size);
    return out;
}

static std::wstring ToLowerCopy(std::wstring s)
{
    std::transform(s.begin(), s.end(), s.begin(), ::towlower);
    return s;
}

void PolicyCache::Load(const nlohmann::json& policies)
{
    if (!policies.is_array()) return;

    std::vector<PolicyEntry> next;
    for (const auto& p : policies) {
        PolicyEntry e;
        e.policyId           = p.value("policyId", "");
        e.enforcementMode    = p.value("enforcementMode", "ALERT_ONLY");
        e.removableMediaOnly = p.value("removableMediaOnly", true);
        if (e.policyId.empty()) continue;

        for (const auto& r : p.value("rules", nlohmann::json::array())) {
            std::string ruleId   = r.value("ruleId", "");
            std::string ruleType = r.value("ruleType", "");
            std::string value    = r.value("value", "");
            if (ruleId.empty() || value.empty()) continue;

            if (ruleType == "CONTENT_KEYWORD" || ruleType == "CONTENT_REGEX" || ruleType == "CONTENT_PATTERN") {
                e.contentRules.push_back({ ruleId, ruleType, value });
            } else if (ruleType == "BLOCKED_PATH") {
                e.blockedPaths.push_back({ ruleId, ToLowerCopy(Utf8ToWide(value)) });
            } else if (ruleType == "TRUSTED_PROCESS") {
                e.trustedProcesses.push_back(ToLowerCopy(Utf8ToWide(value)));
            } else if (ruleType == "FILE_EXTENSION") {
                e.allowedExtensions.push_back(ToLowerCopy(Utf8ToWide(value)));
            }
        }

        next.push_back(std::move(e));
    }

    std::unique_lock lock(m_mutex);
    m_policies = std::move(next);
    std::cout << "[PolicyCache] Loaded " << m_policies.size() << " policy(ies)\n";
}

bool PolicyCache::LoadFromDisk(const std::string& path)
{
    try {
        std::ifstream f(path);
        if (!f.is_open()) return false;
        auto policies = nlohmann::json::parse(f);
        Load(policies);
        return true;
    } catch (...) {
        return false;
    }
}

std::vector<PolicyEntry> PolicyCache::Snapshot() const
{
    std::shared_lock lock(m_mutex);
    return m_policies;
}
