#pragma once
#include <string>
#include <vector>
#include <mutex>
#include <nlohmann/json.hpp>
#include "ContentScanner.h"

// Replaces ServerComm — this service has no network identity or connection of its
// own. It only reads policy from, and appends events to, two local files that the
// Node.js agent (packages/agent/src/dlpBridge.ts) also reads/writes:
//   dlp-policy.json  — written by the Node agent, read here (syncDlpPolicy)
//   dlp-events.ndjson — appended here one line per event, tailed+forwarded+rotated
//                       by the Node agent's flushDlpEvents
// One JSON object per line, matching dlpEventPayloadSchema in
// packages/shared/src/schemas/dlp.schema.ts exactly, so the Node agent can parse it
// with no translation. Appends are open-write-close per call, deliberately not a
// held-open handle — flushDlpEvents rotates the file via rename, and a long-lived
// handle here would fight that rename.
class AgentBridge {
public:
    explicit AgentBridge(std::wstring stateDir);

    // Reads dlp-policy.json; returns its parsed JSON array (empty array on any
    // read/parse failure — never throws, so a missing/corrupt file just means
    // "no policies active" rather than crashing the service).
    nlohmann::json FetchPolicy() const;

    // Appends one event line. Thread-safe (multiple FilterComm worker threads may
    // call this concurrently). `matches` may include entries with an empty
    // maskedSample (a BLOCKED_PATH trigger has no content sample) — those still
    // contribute their ruleId to matchedRuleIds, just no entry in maskedSamples.
    void PostEvent(const std::string&              policyId,
                   const std::wstring&              filePath,
                   const std::wstring&              processPath,
                   bool                              destinationIsRemovable,
                   const std::string&                action,
                   const std::vector<RuleMatch>&    matches);

private:
    std::wstring PolicyFilePath() const;
    std::wstring EventsFilePath() const;

    std::wstring m_stateDir;
    mutable std::mutex m_writeMutex;
};
