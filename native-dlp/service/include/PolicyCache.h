#pragma once
#include <string>
#include <vector>
#include <shared_mutex>
#include <nlohmann/json.hpp>
#include "ContentScanner.h"

// A BLOCKED_PATH rule, resolved for fast case-insensitive substring matching —
// pathLower is pre-lowercased once at load time, not per write.
struct BlockedPathRule {
    std::string  ruleId;
    std::wstring pathLower;
};

// One policy as assigned from endpoint-manager, fully resolved from its rules —
// mirrors AssignedDlpPolicyWire in packages/shared/src/schemas/dlp.schema.ts.
// TRUSTED_PROCESS and FILE_EXTENSION rules don't need a ruleId here: they're pure
// gates (a match means "skip this policy entirely for this event, no trigger, no
// event"), never something that itself produces a DLP event.
struct PolicyEntry {
    std::string policyId;
    std::string enforcementMode; // "ALERT_ONLY" | "BLOCK"
    bool        removableMediaOnly = true;

    std::vector<ContentRule>     contentRules;      // CONTENT_KEYWORD / CONTENT_REGEX / CONTENT_PATTERN
    std::vector<BlockedPathRule> blockedPaths;       // BLOCKED_PATH
    std::vector<std::wstring>    trustedProcesses;   // TRUSTED_PROCESS — lowercase image names
    std::vector<std::wstring>    allowedExtensions;   // FILE_EXTENSION — lowercase, with leading dot; empty = no filter (applies to all extensions)
};

// Thread-safe local policy cache. Populated from the local dlp-policy.json file
// (written by the Node.js agent's dlpBridge.ts — see AgentBridge), not a network
// call. Pure data holder — main.cpp owns all evaluation/orchestration logic, since
// that needs the live write buffer (for content scanning) which doesn't belong here.
class PolicyCache {
public:
    PolicyCache();

    void Load(const nlohmann::json& policies); // array of AssignedDlpPolicyWire
    bool LoadFromDisk(const std::string& path);

    int Count() const { std::shared_lock lock(m_mutex); return (int)m_policies.size(); }

    // Thread-safe snapshot copy for a caller to iterate without holding the lock
    // across a (potentially slow) content scan.
    std::vector<PolicyEntry> Snapshot() const;

private:
    mutable std::shared_mutex m_mutex;
    std::vector<PolicyEntry>  m_policies;
};
