#include "../include/FilterComm.h"
#include <iostream>
#include <stdexcept>

FilterComm::FilterComm()  = default;
FilterComm::~FilterComm() { Stop(); }

static void FcLog(const std::string& msg)
{
    SYSTEMTIME st; GetLocalTime(&st);
    char buf[512];
    snprintf(buf, sizeof(buf), "[%02d:%02d:%02d] %s\n",
             st.wHour, st.wMinute, st.wSecond, msg.c_str());
    HANDLE h = CreateFileA("C:\\DLPAgent\\agent.log",
                            FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE) {
        DWORD w; WriteFile(h, buf, (DWORD)strlen(buf), &w, NULL);
        CloseHandle(h);
    }
}

bool FilterComm::Connect()
{
    // Self-load the minifilter driver if it isn't running yet.
    // DLPAgentSvc runs as LocalSystem which always holds SeLoadDriverPrivilege.
    // Ignore failures — most common is "already loaded" which is fine.
    HRESULT hrLoad = FilterLoad(L"DLPFilter");
    if (SUCCEEDED(hrLoad)) {
        FcLog("FilterComm: loaded DLPFilter driver");
    }

    HRESULT hr = FilterConnectCommunicationPort(
        DLP_PORT_NAME, 0, nullptr, 0, nullptr, &m_port);
    if (FAILED(hr)) {
        char err[128];
        snprintf(err, sizeof(err), "FilterComm: Connect FAILED hr=0x%08lX", (unsigned long)hr);
        FcLog(err);
        return false;
    }
    FcLog("FilterComm: Connected to DLPFilter port");
    return true;
}

void FilterComm::Start(EventCallback cb)
{
    m_callback = std::move(cb);
    m_running  = true;
    m_threads.reserve(WORKER_THREADS);
    for (int i = 0; i < WORKER_THREADS; ++i)
        m_threads.emplace_back(&FilterComm::MessageLoop, this);
    char msg[64];
    snprintf(msg, sizeof(msg), "FilterComm: started %d worker threads", WORKER_THREADS);
    FcLog(msg);
}

void FilterComm::Stop()
{
    m_running = false;
    if (m_port != INVALID_HANDLE_VALUE) {
        CloseHandle(m_port);
        m_port = INVALID_HANDLE_VALUE;
    }
    for (auto& t : m_threads)
        if (t.joinable()) t.join();
    m_threads.clear();
    m_activeWorkers = 0;
}

bool FilterComm::SendAction(const DLP_ACTION_MSG& cmd)
{
    if (m_port == INVALID_HANDLE_VALUE) return false;
    DWORD bytesReturned = 0;
    HRESULT hr = FilterSendMessage(m_port,
                                    const_cast<DLP_ACTION_MSG*>(&cmd), sizeof(cmd),
                                    nullptr, 0, &bytesReturned);
    if (FAILED(hr)) {
        std::cerr << "[FilterComm] SendAction failed: 0x" << std::hex << hr << '\n';
        return false;
    }
    return true;
}

void FilterComm::MessageLoop()
{
    ++m_activeWorkers;

    // Buffer: sizeof(FILTER_MESSAGE_HEADER) prepended by FltMgr + full payload.
    // Add 64 bytes headroom to handle any sizeof(FILTER_MESSAGE_HEADER)
    // discrepancy between kernel-mode and user-mode struct packing.
    static const DWORD BUF_SIZE = sizeof(DLP_KERNEL_MESSAGE) + 64;
    alignas(FILTER_MESSAGE_HEADER) char buf[BUF_SIZE];
    auto* msg = reinterpret_cast<DLP_KERNEL_MESSAGE*>(buf);

    while (m_running) {
        ZeroMemory(buf, BUF_SIZE);

        HRESULT hr = FilterGetMessage(m_port, &msg->Header, BUF_SIZE, nullptr);
        if (FAILED(hr)) {
            if (m_running) {
                char err[128];
                snprintf(err, sizeof(err),
                         "FilterComm: GetMessage FAILED hr=0x%08lX — loop exiting",
                         (unsigned long)hr);
                FcLog(err);
            }
            break;
        }

        // Decide verdict
        bool block = false;
        if (m_callback) {
            const UCHAR* data    = nullptr;
            ULONG        dataLen = 0;

            if (msg->Generic.MsgType == DLP_MSG_FILE_WRITE ||
                msg->Generic.MsgType == DLP_MSG_FILE_READ) {
                data    = msg->FileIo.Data;
                dataLen = msg->FileIo.DataLength;
            }
            block = m_callback(msg->Generic, data, dataLen);
        }

        // Only blocking writes need a verdict reply — they have a live 30 s waiter.
        // Fire-and-forget messages (create, read, rename, delete, process events)
        // use a 1 ms kernel timeout; FltMgr marks them abandoned (MessageId = 0).
        // Calling FilterReplyMessage on those triggers ERROR_FLT_NO_WAITER and
        // corrupts the FltMgr port state, causing subsequent GetMessage calls to
        // return E_FAIL and killing all worker threads.
        bool needsVerdict = (msg->Generic.MsgType == DLP_MSG_FILE_WRITE);
        if (needsVerdict) {
            DLP_USER_REPLY reply   = {};
            reply.Header.MessageId = msg->Header.MessageId;
            reply.Header.Status    = 0; // STATUS_SUCCESS
            reply.Reply.Verdict    = block ? DLP_VERDICT_BLOCK : DLP_VERDICT_ALLOW;

            if (block) {
                char info[128];
                snprintf(info, sizeof(info),
                         "FilterComm: sending BLOCK verdict msgId=%llu",
                         (unsigned long long)msg->Header.MessageId);
                FcLog(info);
            }

            HRESULT hrReply = FilterReplyMessage(m_port, &reply.Header, sizeof(reply));
            if (FAILED(hrReply)) {
                char err[160];
                snprintf(err, sizeof(err),
                         "FilterComm: FilterReplyMessage FAILED hr=0x%08lX msgId=%llu",
                         (unsigned long)hrReply, (unsigned long long)msg->Header.MessageId);
                FcLog(err);
            }
        }
    }

    --m_activeWorkers;
}
