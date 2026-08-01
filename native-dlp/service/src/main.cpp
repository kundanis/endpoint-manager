// DLPService -- Endpoint sidecar for the DLPFilter minifilter, feeding Endpoint
// Pro's DLP module (Phase 2). Connects to DLPFilter.sys locally via Filter Manager
// comm port. Has NO network identity or server connection of its own — policy comes
// from, and events go to, two local files also read/written by the Node.js agent
// (packages/agent/src/dlpBridge.ts). See AgentBridge.h for that handoff's shape.
//
// Runs as a Windows service (DLPServiceSvc) or interactively from the console.
// Usage: DLPService.exe [--state-dir <path>]
//
// Adapted from E:\Claude-Projects\DLPAgent\service\src\main.cpp: dropped agent
// registration/heartbeat/Claude-escalation entirely (this build's PolicyCache is
// already deterministic — no LLM call ever sat in the real decision path), replaced
// ServerComm's HTTPS calls with AgentBridge's local-file reads/writes, and dropped
// the in-process event queue (each event is appended to disk immediately instead of
// batched for a network POST).

#include <windows.h>
#include <iostream>
#include <string>
#include <atomic>
#include <thread>
#include <mutex>
#include <chrono>
#include <fstream>
#include <cstdlib>
#include <algorithm>

#include "../include/FilterComm.h"
#include "../include/ContentScanner.h"
#include "../include/PolicyCache.h"
#include "../include/AgentBridge.h"

// ---- Simple file logger ----------------------------------------------------
static std::mutex g_logMutex;
static void Log(const std::string& msg)
{
    std::lock_guard<std::mutex> lk(g_logMutex);
    SYSTEMTIME st; GetLocalTime(&st);
    char ts[32];
    snprintf(ts, sizeof(ts), "%02d:%02d:%02d", st.wHour, st.wMinute, st.wSecond);
    std::string line = std::string("[") + ts + "] " + msg + "\n";
    for (const char* path : {"C:\\ProgramData\\EndpointPro\\dlp-service.log", "C:\\Windows\\Temp\\DLPService.log"}) {
        std::ofstream f(path, std::ios::app);
        if (f.is_open()) { f << line; f.flush(); }
    }
}

// ---- Globals -----------------------------------------------------------------
static std::atomic<bool>      g_running{true};
static SERVICE_STATUS_HANDLE  g_svcHandle = NULL;
static SERVICE_STATUS         g_svcStatus = {};
static std::wstring           g_stateDirOverride;

static const int POLICY_SYNC_INTERVAL_SEC = 60; // matches DEFAULT_DLP_POLICY_SYNC_INTERVAL_MS

// ---- Config: where dlp-policy.json / dlp-events.ndjson live -----------------
// MUST match the Node.js agent's own agentConfig.stateDir for this handoff to work.
// Resolution order: --state-dir arg > UEM_STATE_DIR env var > a fixed default that
// the install script is responsible for aligning with the Node agent's install.
static std::wstring ResolveStateDir()
{
    if (!g_stateDirOverride.empty()) return g_stateDirOverride;

    wchar_t envVal[MAX_PATH] = {};
    if (GetEnvironmentVariableW(L"UEM_STATE_DIR", envVal, MAX_PATH) > 0)
        return envVal;

    return L"C:\\ProgramData\\EndpointPro\\state";
}

// Resolves an NT-namespace path (e.g. "\Device\HarddiskVolume3\Users\...") to a
// drive letter via QueryDosDevice's reverse mapping, then checks GetDriveType.
// Rebuilt on every call rather than cached — USB insert/remove needs to be
// reflected immediately, and this only runs after a content match (not on every
// write), so the cost is acceptable.
static bool IsRemovableVolume(const std::wstring& ntPath)
{
    for (wchar_t letter = L'A'; letter <= L'Z'; letter++) {
        wchar_t drive[3] = { letter, L':', 0 };
        wchar_t target[MAX_PATH] = {};
        if (QueryDosDeviceW(drive, target, MAX_PATH) == 0) continue;

        size_t targetLen = wcslen(target);
        if (ntPath.size() > targetLen &&
            ntPath.compare(0, targetLen, target) == 0 &&
            (ntPath[targetLen] == L'\\' || ntPath[targetLen] == L'/')) {
            wchar_t root[4] = { letter, L':', L'\\', 0 };
            return GetDriveTypeW(root) == DRIVE_REMOVABLE;
        }
    }
    return false; // couldn't resolve to a drive letter — treat as non-removable (fail toward less enforcement, not more)
}

// ---- Windows Service SCM helpers --------------------------------------------
static void ReportSvcStatus(DWORD state, DWORD win32Exit = NO_ERROR, DWORD waitHint = 0)
{
    static DWORD cp = 1;
    g_svcStatus.dwCurrentState  = state;
    g_svcStatus.dwWin32ExitCode = win32Exit;
    g_svcStatus.dwWaitHint      = waitHint;
    g_svcStatus.dwControlsAccepted =
        (state == SERVICE_START_PENDING) ? 0 : SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN;
    g_svcStatus.dwCheckPoint =
        (state == SERVICE_RUNNING || state == SERVICE_STOPPED) ? 0 : cp++;
    if (g_svcHandle) SetServiceStatus(g_svcHandle, &g_svcStatus);
}

static void WINAPI SvcCtrlHandler(DWORD ctrl)
{
    if (ctrl == SERVICE_CONTROL_STOP || ctrl == SERVICE_CONTROL_SHUTDOWN) {
        ReportSvcStatus(SERVICE_STOP_PENDING, NO_ERROR, 5000);
        g_running = false;
    }
}

// ---- Core agent logic (shared by service and console modes) ----------------
static void RunAgent()
{
    Log("RunAgent started");

    std::wstring stateDir = ResolveStateDir();
    Log("State dir: " + std::string(stateDir.begin(), stateDir.end()));

    ContentScanner scanner;
    PolicyCache    policy;
    AgentBridge    bridge(stateDir);
    FilterComm     comm;

    // Load whatever policy is already on disk immediately — enforced from the
    // moment the driver connection is established, no need to wait on anything.
    if (policy.LoadFromDisk(std::string(stateDir.begin(), stateDir.end()) + "\\dlp-policy.json"))
        Log("Policy loaded from disk: " + std::to_string(policy.Count()) + " polic(y/ies)");
    else
        Log("No policy file on disk yet — enforcing nothing until the agent writes one");

    ReportSvcStatus(SERVICE_RUNNING);
    Log("SERVICE_RUNNING reported");

    // Event callback — only IRP_MJ_WRITE carries content and needs a verdict;
    // every other message type (create/read/rename/delete/process) is ignored
    // outright, since none of them are relevant to a write-time DLP decision.
    //
    // Per policy, in order: TRUSTED_PROCESS and FILE_EXTENSION are pure gates (a
    // match/mismatch skips this policy entirely, no event); removableMediaOnly is a
    // scope gate the same way; BLOCKED_PATH and the CONTENT_* rules (via
    // ContentScanner) are the actual triggers, and both are checked and combined
    // into a single event per policy rather than two separate ones.
    auto eventCallback = [&](const DLP_MSG_HEADER& hdr, const UCHAR* data, ULONG dataLen) -> bool {
        if (hdr.MsgType != DLP_MSG_FILE_WRITE) return false;

        std::wstring filePath(hdr.FilePath);
        std::wstring processPath(hdr.ProcessPath);

        std::wstring fileLower = filePath;
        std::transform(fileLower.begin(), fileLower.end(), fileLower.begin(), ::towlower);

        std::wstring procLower = processPath;
        std::transform(procLower.begin(), procLower.end(), procLower.begin(), ::towlower);
        size_t procSep = procLower.find_last_of(L"\\/");
        std::wstring procName = (procSep != std::wstring::npos) ? procLower.substr(procSep + 1) : procLower;

        std::wstring ext;
        size_t dot = fileLower.find_last_of(L'.');
        size_t sep = fileLower.find_last_of(L"\\/");
        if (dot != std::wstring::npos && (sep == std::wstring::npos || dot > sep)) ext = fileLower.substr(dot);

        // Computed once per event, lazily — most writes won't reach this point at
        // all (the driver's own fast pre-filters already skip tiny/system-path
        // writes), and among those that do, not every policy cares.
        bool removableChecked = false;
        bool isRemovable = false;
        auto destinationIsRemovable = [&]() -> bool {
            if (!removableChecked) { isRemovable = IsRemovableVolume(filePath); removableChecked = true; }
            return isRemovable;
        };

        bool block = false;
        for (const auto& p : policy.Snapshot()) {
            bool trusted = false;
            for (const auto& tp : p.trustedProcesses) if (procName == tp) { trusted = true; break; }
            if (trusted) continue;

            if (!p.allowedExtensions.empty()) {
                bool extMatches = false;
                for (const auto& allowed : p.allowedExtensions) if (ext == allowed) { extMatches = true; break; }
                if (!extMatches) continue;
            }

            if (p.removableMediaOnly && !destinationIsRemovable()) continue;

            std::vector<RuleMatch> matches;
            for (const auto& bp : p.blockedPaths)
                if (fileLower.find(bp.pathLower) != std::wstring::npos)
                    matches.push_back({ bp.ruleId, "" }); // no content sample — path-based trigger

            if (!p.contentRules.empty()) {
                ScanResult scan = scanner.Scan(data, dataLen, filePath, p.contentRules);
                for (const auto& m : scan.matches) matches.push_back(m);
            }

            if (matches.empty()) continue;

            std::string action = (p.enforcementMode == "BLOCK") ? "BLOCKED" : "ALERTED";
            bridge.PostEvent(p.policyId, filePath, processPath, destinationIsRemovable(), action, matches);
            if (action == "BLOCKED") block = true;

            Log("DLP event: " + action + " policy=" + p.policyId +
                " matches=" + std::to_string(matches.size()));
        }

        return block;
    };

    // Connect to the minifilter — reconnects automatically if the driver reloads.
    auto connectDriver = [&]() {
        while (g_running) {
            if (!comm.IsConnected()) {
                if (comm.Connect()) {
                    Log("FilterComm: connected to DLPFilter");
                    comm.Start(eventCallback);
                } else {
                    Log("FilterComm: waiting for DLPFilter driver...");
                    std::this_thread::sleep_for(std::chrono::seconds(10));
                }
            } else if (!comm.HasActiveWorkers()) {
                Log("FilterComm: workers exited — reconnecting in 5s");
                comm.Stop();
                std::this_thread::sleep_for(std::chrono::seconds(5));
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
            }
        }
    };
    std::thread driverConnThread(connectDriver);

    // Periodic policy re-sync — the Node.js agent refreshes dlp-policy.json on its
    // own interval (DEFAULT_DLP_POLICY_SYNC_INTERVAL_MS); this just re-reads
    // whatever is currently on disk, no network involved.
    std::thread policySyncThread([&]() {
        while (g_running) {
            std::this_thread::sleep_for(std::chrono::seconds(POLICY_SYNC_INTERVAL_SEC));
            if (!g_running) break;
            auto policies = bridge.FetchPolicy();
            policy.Load(policies);
        }
    });

    while (g_running)
        std::this_thread::sleep_for(std::chrono::milliseconds(500));

    comm.Stop();
    policySyncThread.join();
    if (driverConnThread.joinable()) driverConnThread.join();
}

// ---- Top-level SEH filter — keeps the service alive on access violations ---
static LONG WINAPI TopLevelFilter(EXCEPTION_POINTERS* ep)
{
    char msg[128];
    snprintf(msg, sizeof(msg), "[DLPService] SEH exception 0x%08lX — continuing\n",
             ep->ExceptionRecord->ExceptionCode);
    OutputDebugStringA(msg);
    return EXCEPTION_CONTINUE_EXECUTION;
}

// ---- Windows Service entry point --------------------------------------------
static void WINAPI ServiceMain(DWORD /*argc*/, LPWSTR* /*argv*/)
{
    Log("ServiceMain entered");
    g_svcHandle = RegisterServiceCtrlHandlerW(L"DLPServiceSvc", SvcCtrlHandler);
    if (!g_svcHandle) {
        Log("RegisterServiceCtrlHandlerW failed: " + std::to_string(GetLastError()));
        return;
    }

    g_svcStatus.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    ReportSvcStatus(SERVICE_START_PENDING, NO_ERROR, 10000);
    SetUnhandledExceptionFilter(TopLevelFilter);

    try {
        RunAgent();
    } catch (const std::exception& ex) {
        OutputDebugStringA(("[DLPService] Fatal: " + std::string(ex.what()) + "\n").c_str());
    } catch (...) {
        OutputDebugStringA("[DLPService] Fatal: unknown exception\n");
    }

    ReportSvcStatus(SERVICE_STOPPED);
}

// ---- Console Ctrl-C handler --------------------------------------------------
static BOOL WINAPI CtrlHandler(DWORD type)
{
    if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT || type == CTRL_CLOSE_EVENT) {
        g_running = false;
        return TRUE;
    }
    return FALSE;
}

// ---- main --------------------------------------------------------------------
int main(int argc, char* argv[])
{
    for (int i = 1; i < argc - 1; ++i) {
        if (std::string(argv[i]) == "--state-dir") {
            std::string arg = argv[i + 1];
            g_stateDirOverride = std::wstring(arg.begin(), arg.end());
        }
    }

    Log("main() started");

    SERVICE_TABLE_ENTRYW table[] = {
        { const_cast<LPWSTR>(L"DLPServiceSvc"), ServiceMain },
        { NULL, NULL }
    };

    if (!StartServiceCtrlDispatcherW(table)) {
        DWORD err = GetLastError();
        Log("StartServiceCtrlDispatcherW failed: " + std::to_string(err));
        // 1063 = not running as a service (interactive console mode) — still try to
        // run so behavior can be observed/diagnosed directly.
        SetConsoleCtrlHandler(CtrlHandler, TRUE);
        RunAgent();
    }
    Log("main() exiting");
    return 0;
}
