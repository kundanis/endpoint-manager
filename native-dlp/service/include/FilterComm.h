#pragma once
#include <windows.h>
#include <fltUser.h>
#include <functional>
#include <thread>
#include <vector>
#include <atomic>
#include "../../common/DLPProtocol.h"

// Manages the connection to the DLPFilter minifilter communication port.
// Runs multiple worker threads calling FilterGetMessage / FilterReplyMessage
// concurrently so the kernel queue drains fast enough to beat the send timeout.
class FilterComm {
public:
    // Called for every inbound event.
    // Return true  → block the operation (only meaningful for FILE_WRITE).
    // Return false → allow.
    using EventCallback = std::function<bool(const DLP_MSG_HEADER&, const UCHAR* data, ULONG dataLen)>;

    FilterComm();
    ~FilterComm();

    bool Connect();             // FilterConnectCommunicationPort
    void Start(EventCallback);  // spawn message-loop threads
    void Stop();

    // Send an action command to the kernel (e.g., kill a PID).
    bool SendAction(const DLP_ACTION_MSG& cmd);

    bool IsConnected() const { return m_port != INVALID_HANDLE_VALUE; }
    bool HasActiveWorkers() const { return m_activeWorkers > 0; }

private:
    void MessageLoop();

    static constexpr int WORKER_THREADS = 4;

    HANDLE                   m_port          = INVALID_HANDLE_VALUE;
    EventCallback            m_callback;
    std::vector<std::thread> m_threads;
    std::atomic<bool>        m_running{false};
    std::atomic<int>         m_activeWorkers{0};
};
